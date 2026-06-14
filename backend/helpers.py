import json

import numpy as np
import store
from config import EMBED_MODEL
from openai import OpenAI

client = OpenAI()

_embed_cache: dict[str, np.ndarray] = {}


def embed(text: str) -> np.ndarray:
    if text not in _embed_cache:
        resp = client.embeddings.create(model=EMBED_MODEL, input=[text])
        _embed_cache[text] = np.array(resp.data[0].embedding, dtype=np.float32)
    return _embed_cache[text]


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def run_search(
    args: dict,
    scope_company: str | None,
    counter: int,
    sources: list[dict],
    index: store.LibraryIndex,
) -> tuple[str, int]:
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
