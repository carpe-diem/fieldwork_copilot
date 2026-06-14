"""Fieldwork Copilot API.

Endpoints:
- GET  /api/companies          → distinct companies in the library
- GET  /api/chunks/{id}        → full source chunk (for the sources panel)
- POST /api/chat               → SSE stream; agentic loop with a search tool
- POST /api/compare            → structured comparison table with citations

Design notes:
- The chat is a light agentic loop, not fixed RAG: the model decides when to
  call `search_library`, with what query, and whether to filter by company.
  This handles follow-ups ("and what did Costco say about that?") for free.
- Citations: every retrieved chunk gets a global [n] label within the
  conversation turn. The model is instructed to cite [n]; the frontend maps
  those markers to source chips.
"""

import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import store
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel

CHAT_MODEL = os.environ.get("CHAT_MODEL", "gpt-4o-mini")
EMBED_MODEL = "text-embedding-3-small"
MAX_TOOL_ROUNDS = 4
COMPARE_CACHE_TTL = int(os.environ.get("COMPARE_CACHE_TTL", "86400"))

app = FastAPI(title="Fieldwork Copilot")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

client = OpenAI()
index = store.LibraryIndex()


@app.on_event("startup")
def _load():
    index.load()
    print(f"Library loaded: {len(index.chunks)} chunks, companies: {index.companies()}")


# ---------------------------------------------------------------- helpers

_embed_cache: dict[str, np.ndarray] = {}


def embed(text: str) -> np.ndarray:
    if text not in _embed_cache:
        resp = client.embeddings.create(model=EMBED_MODEL, input=[text])
        _embed_cache[text] = np.array(resp.data[0].embedding, dtype=np.float32)
    return _embed_cache[text]


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


SYSTEM_PROMPT = """You are Fieldwork Copilot, a research assistant for long-term \
fundamental investors. You answer questions using ONLY a private library of \
interview and call transcripts, which you access through the search_library tool.

Rules:
- Always search before answering a substantive question. Reformulate the user's \
question into a good search query; search more than once if the question has \
multiple parts or compares companies.
- Every factual claim must cite its source using the bracketed number of the \
supporting excerpt, e.g. [2]. Cite at the end of the sentence the claim appears in.
- If the library has no relevant material, say so plainly. Never fall back on \
general knowledge without explicitly flagging it as outside the library.
- Be concise and analytical. Write like a research note, not a summary of excerpts.
- Paraphrase; do not quote excerpts verbatim at length."""

SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_library",
        "description": "Semantic search over the transcript library. Returns the most relevant excerpts, each labeled with a citation number [n].",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query, phrased as the idea you want to find.",
                },
                "company": {
                    "type": "string",
                    "description": "Optional: restrict to one company.",
                },
            },
            "required": ["query"],
        },
    },
}


def run_search(
    args: dict, scope_company: str | None, counter: int, sources: list[dict]
):
    company = scope_company or args.get("company")
    results = index.search(embed(args["query"]), company=company, k=6)
    if not results:
        return "No relevant excerpts found in the library.", counter
    lines = []
    for r in results:
        counter += 1
        sources.append(
            {
                "n": counter,
                "chunk_id": r["chunk_id"],
                "company": r["company"],
                "title": r["title"],
                "date": r["date"],
                "text": r["text"],
                "source_url": r["source_url"],
            }
        )
        lines.append(
            f"[{counter}] {r['company']} — {r['title']} ({r['date']})\n{r['text']}"
        )
    return "\n\n---\n\n".join(lines), counter


# ---------------------------------------------------------------- endpoints


@app.get("/api/companies")
def companies():
    return {"companies": index.companies()}


@app.get("/api/chunks/{chunk_id}")
def get_chunk(chunk_id: int):
    chunk = index.get_chunk(chunk_id)
    if not chunk:
        raise HTTPException(404, "chunk not found")
    return chunk


class ChatRequest(BaseModel):
    messages: list[dict]  # [{role, content}]
    company: str | None = None  # optional scope filter


@app.post("/api/chat")
def chat(req: ChatRequest):
    def generate():
        convo: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        if req.company:
            convo.append(
                {
                    "role": "system",
                    "content": f"The user has scoped this conversation to {req.company}.",
                }
            )
        convo += req.messages

        sources: list[dict] = []
        counter = 0

        for _ in range(MAX_TOOL_ROUNDS):
            stream = client.chat.completions.create(
                model=CHAT_MODEL, messages=convo, tools=[SEARCH_TOOL], stream=True
            )
            tool_calls: dict[int, dict] = {}
            content_parts: list[str] = []
            finish = None

            for chunk in stream:
                choice = chunk.choices[0]
                delta = choice.delta
                if delta.content:
                    content_parts.append(delta.content)
                    yield sse({"type": "token", "text": delta.content})
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        entry = tool_calls.setdefault(
                            tc.index, {"id": "", "name": "", "args": ""}
                        )
                        if tc.id:
                            entry["id"] = tc.id
                        if tc.function and tc.function.name:
                            entry["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            entry["args"] += tc.function.arguments
                if choice.finish_reason:
                    finish = choice.finish_reason

            if finish != "tool_calls":
                break

            convo.append(
                {
                    "role": "assistant",
                    "content": "".join(content_parts) or None,
                    "tool_calls": [
                        {
                            "id": e["id"],
                            "type": "function",
                            "function": {"name": e["name"], "arguments": e["args"]},
                        }
                        for e in tool_calls.values()
                    ],
                }
            )
            for e in tool_calls.values():
                args = json.loads(e["args"] or "{}")
                yield sse(
                    {"type": "status", "text": f"Searching: {args.get('query', '')}"}
                )
                result_text, counter = run_search(args, req.company, counter, sources)
                convo.append(
                    {"role": "tool", "tool_call_id": e["id"], "content": result_text}
                )

        yield sse({"type": "sources", "sources": sources})
        yield sse({"type": "done"})

    return StreamingResponse(generate(), media_type="text/event-stream")


class CompareRequest(BaseModel):
    company_a: str
    company_b: str
    dimensions: list[str] | None = None


DEFAULT_DIMENSIONS = [
    "Competitive advantage",
    "Cost discipline",
    "Pricing power",
    "Key risks",
    "Capital allocation",
]

COMPARE_PROMPT = """You produce a structured comparison of two companies using ONLY \
the excerpts provided. Respond with a JSON object:
{"cells": [{"company": str, "dimension": str, "claim": str, "citations": [int], "confidence": "strong"|"weak"|"no_data"}]}
One cell per company per dimension. `claim` is 1-2 analytical sentences. `citations` \
lists the [n] numbers of supporting excerpts. If the excerpts contain nothing relevant \
for a cell, set confidence to "no_data" and claim to "No evidence in the library." \
Never invent. Output JSON only."""


def _compare_key(company_a: str, company_b: str, dimensions: list[str]) -> str:
    companies = "|".join(sorted([company_a.lower(), company_b.lower()]))
    dims = ",".join(sorted(d.lower() for d in dimensions))
    return f"{companies}|{dims}"


@app.post("/api/compare")
def compare(req: CompareRequest):
    dimensions = req.dimensions or DEFAULT_DIMENSIONS
    conn = store.connect()

    if COMPARE_CACHE_TTL:
        cached = store.get_compare_cache(
            conn,
            _compare_key(req.company_a, req.company_b, dimensions),
            COMPARE_CACHE_TTL,
        )
        if cached:
            return cached

    sources: list[dict] = []
    counter = 0
    blocks = []
    for company in (req.company_a, req.company_b):
        for dim in dimensions:
            text, counter = run_search(
                {"query": dim, "company": company}, None, counter, sources
            )
            blocks.append(f"### Excerpts for {company} / {dim}\n{text}")

    resp = client.chat.completions.create(
        model=CHAT_MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": COMPARE_PROMPT},
            {
                "role": "user",
                "content": f"Companies: {req.company_a} vs {req.company_b}\nDimensions: {dimensions}\n\n"
                + "\n\n".join(blocks),
            },
        ],
    )
    cells = json.loads(resp.choices[0].message.content).get("cells", [])
    result = {"dimensions": dimensions, "cells": cells, "sources": sources}

    if COMPARE_CACHE_TTL:
        store.set_compare_cache(
            conn, _compare_key(req.company_a, req.company_b, dimensions), result
        )

    return result


# Serve the Vite SPA build. Must come last so /api/* routes take precedence.
# This is only for simplidy the deploy for the demo, using just 1 server
_FRONTEND = Path(__file__).parent.parent / "frontend" / "dist"
if _FRONTEND.exists():
    app.mount("/", StaticFiles(directory=_FRONTEND, html=True), name="spa")
