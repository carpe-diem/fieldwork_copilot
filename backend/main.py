"""Fieldwork Copilot API.

Endpoints:
- GET  /api/health             → liveness probe
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
from pathlib import Path
from typing import Any

import store
from config import CHAT_MODEL, COMPARE_CACHE_TTL, MAX_TOOL_ROUNDS
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from helpers import client, run_search, sse
from prompts import COMPARE_PROMPT, DEFAULT_DIMENSIONS, SEARCH_TOOL, SYSTEM_PROMPT
from schemas import ChatRequest, CompareRequest

app = FastAPI(title="Fieldwork Copilot")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

index = store.LibraryIndex()


@app.on_event("startup")
def _load():
    index.load()
    print(f"Library loaded: {len(index.chunks)} chunks, companies: {index.companies()}")


# ---------------------------------------------------------------- endpoints


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/companies")
def companies():
    return {"companies": index.companies()}


@app.get("/api/chunks/{chunk_id}")
def get_chunk(chunk_id: int):
    chunk = index.get_chunk(chunk_id)
    if not chunk:
        raise HTTPException(404, "chunk not found")
    return chunk


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
                result_text, counter = run_search(
                    args, req.company, counter, sources, index
                )
                convo.append(
                    {"role": "tool", "tool_call_id": e["id"], "content": result_text}
                )

        yield sse({"type": "sources", "sources": sources})
        yield sse({"type": "done"})

    return StreamingResponse(generate(), media_type="text/event-stream")


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
                {"query": dim, "company": company}, None, counter, sources, index
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
_FRONTEND = Path(__file__).parent.parent / "frontend" / "dist"
if _FRONTEND.exists():
    app.mount("/", StaticFiles(directory=_FRONTEND, html=True), name="spa")
