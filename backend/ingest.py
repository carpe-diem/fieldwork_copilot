"""Ingest corpus/ into the library.

Chunking strategy (the interesting decision):
- Transcripts are conversational Q&A. The natural retrieval unit is the
  question+answer pair, because an answer without its question loses meaning.
- We detect speaker turns via a `SPEAKER:` label pattern and group each
  question with the answer(s) that follow it.
- If a document has no speaker structure (letters, essays), we fall back to
  merging paragraphs greedily up to ~1800 chars (~450 tokens).

Usage:
    OPENAI_API_KEY=... python ingest.py
Re-running wipes and rebuilds the DB (idempotent by reconstruction — fine for
a demo; production would do incremental ingestion keyed on doc hashes).
"""

import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import store
from openai import OpenAI

CORPUS_DIR = Path(__file__).parent.parent / "corpus"
EMBED_MODEL = "text-embedding-3-small"
MAX_CHUNK_CHARS = 2400
TARGET_CHUNK_CHARS = 1800

# Two real-world speaker formats:
#   "MICHAEL O'LEARY:" / "Michael O'Leary: ..."   (colon style)
#   "Michael O'Leary -- Group CEO"                 (Motley Fool style, own line)
SPEAKER_COLON = re.compile(r"^([A-Z][\w.'’\-]*(?: [A-Z(][\w.()'’\-]*){0,4}):\s*(.*)$")
SPEAKER_DASH = re.compile(
    r"^([A-Z][\w.'’\-]*(?: [\w.&()'’][\w.&()'’\-]*){0,5})\s+--\s+.{2,70}$"
)


def split_turns(text: str) -> list[tuple[str, str]] | None:
    """Return [(speaker, said), ...] if the doc looks like a transcript."""
    turns, current_speaker, buf = [], None, []

    def flush():
        said = " ".join(buf).strip()
        if current_speaker is not None and said:
            turns.append((current_speaker, said))

    for raw in text.splitlines():
        line = raw.strip()
        m = SPEAKER_COLON.match(line)
        d = None if m else SPEAKER_DASH.match(line)
        if m and len(m.group(1)) <= 40:
            flush()
            name = m.group(1)
            current_speaker = name.title() if name.isupper() else name
            buf = [m.group(2)]
        elif d:
            flush()
            current_speaker, buf = d.group(1), []
        elif current_speaker is not None:
            buf.append(line)
    flush()
    return turns if len(turns) >= 4 else None


def chunk_transcript(turns: list[tuple[str, str]]) -> list[str]:
    """Group turns into Q&A-pair chunks, splitting when too large."""
    chunks, buf = [], []
    for speaker, said in turns:
        line = f"{speaker}: {said}"
        # A turn ending in "?" starts a new Q&A chunk; size cap as a backstop.
        is_question = said.rstrip().endswith("?")
        buf_len = sum(len(b) for b in buf)
        if buf and (is_question or buf_len + len(line) > MAX_CHUNK_CHARS):
            chunks.append("\n".join(buf))
            buf = []
        buf.append(line)
    if buf:
        chunks.append("\n".join(buf))
    return chunks


def chunk_paragraphs(text: str) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, buf, size = [], [], 0
    for p in paras:
        if buf and size + len(p) > TARGET_CHUNK_CHARS:
            chunks.append("\n\n".join(buf))
            buf, size = [], 0
        buf.append(p)
        size += len(p)
    if buf:
        chunks.append("\n\n".join(buf))
    return chunks


def _hard_split(chunks: list[str]) -> list[str]:
    """Backstop: split any chunk that still exceeds MAX_CHUNK_CHARS (e.g. a long monologue)."""
    result = []
    for c in chunks:
        while len(c) > MAX_CHUNK_CHARS:
            result.append(c[:MAX_CHUNK_CHARS])
            c = c[MAX_CHUNK_CHARS:]
        result.append(c)
    return result


def chunk_document(text: str) -> list[str]:
    turns = split_turns(text)
    raw = chunk_transcript(turns) if turns else chunk_paragraphs(text)
    return _hard_split(raw)


def embed_batch(client: OpenAI, texts: list[str]) -> np.ndarray:
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return np.array([d.embedding for d in resp.data], dtype=np.float32)


def main():
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("Set OPENAI_API_KEY first.")
    client = OpenAI()

    if store.DB_PATH.exists():
        store.DB_PATH.unlink()
    conn = store.connect()

    metadata = json.loads((CORPUS_DIR / "metadata.json").read_text())
    total = 0
    for meta in metadata:
        path = CORPUS_DIR / meta["file"]
        if not path.exists():
            print(f"  ! missing {path}, skipping")
            continue
        chunks = chunk_document(path.read_text())
        # Prefix each chunk with light context: helps embedding quality a lot
        # for cheap ("contextual chunk headers").
        prefixed = [f"[{meta['company']} — {meta['title']}]\n{c}" for c in chunks]
        embeddings = embed_batch(client, prefixed)
        store.save_document(conn, meta, prefixed, embeddings)
        total += len(chunks)
        print(f"  ✓ {meta['company']}: {meta['title']} → {len(chunks)} chunks")

    print(f"Done. {total} chunks in {store.DB_PATH.name}")


if __name__ == "__main__":
    main()
