"""Storage layer: SQLite for persistence, numpy in memory for vector search.

Deliberate tradeoff: at demo scale (<5k chunks) brute-force cosine over a
normalized matrix is instant and needs zero infra. At production scale this
becomes pgvector + HNSW and hybrid search (BM25 + embeddings).
"""

import json
import sqlite3
import time
from pathlib import Path

import numpy as np

DB_PATH = Path(__file__).parent / "library.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT,
    source_url TEXT
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    doc_id INTEGER NOT NULL REFERENCES docs(id),
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS compare_cache (
    key        TEXT PRIMARY KEY,
    result     TEXT NOT NULL,
    created_at REAL NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


class LibraryIndex:
    """Loads all chunk embeddings into memory and serves cosine search."""

    def __init__(self):
        self.matrix = None  # (n_chunks, dim) L2-normalized float32
        self.chunks = []  # list of dicts aligned with matrix rows

    def load(self):
        conn = connect()
        rows = conn.execute(
            """SELECT c.id, c.doc_id, c.idx, c.text, c.embedding,
                      d.company, d.title, d.date, d.source_url
               FROM chunks c JOIN docs d ON d.id = c.doc_id
               ORDER BY c.id"""
        ).fetchall()
        conn.close()

        self.chunks = []
        vectors = []
        for r in rows:
            vectors.append(np.frombuffer(r["embedding"], dtype=np.float32))
            self.chunks.append(
                {
                    "chunk_id": r["id"],
                    "doc_id": r["doc_id"],
                    "chunk_index": r["idx"],
                    "text": r["text"],
                    "company": r["company"],
                    "title": r["title"],
                    "date": r["date"],
                    "source_url": r["source_url"],
                }
            )
        if vectors:
            m = np.vstack(vectors)
            self.matrix = m / np.linalg.norm(m, axis=1, keepdims=True)
        else:
            self.matrix = None

    def companies(self) -> list[str]:
        return sorted({c["company"] for c in self.chunks})

    def get_chunk(self, chunk_id: int) -> dict | None:
        return next((c for c in self.chunks if c["chunk_id"] == chunk_id), None)

    def search(
        self, query_vec: np.ndarray, company: str | None = None, k: int = 8
    ) -> list[dict]:
        if self.matrix is None:
            return []
        q = query_vec.astype(np.float32)
        q = q / np.linalg.norm(q)
        scores = self.matrix @ q
        order = np.argsort(-scores)
        out = []
        for i in order:
            c = self.chunks[int(i)]
            if company and c["company"].lower() != company.lower():
                continue
            out.append({**c, "score": float(scores[int(i)])})
            if len(out) >= k:
                break
        return out


def get_compare_cache(conn, key: str, ttl: int) -> dict | None:
    row = conn.execute(
        "SELECT result, created_at FROM compare_cache WHERE key = ?", (key,)
    ).fetchone()
    if row and (time.time() - row["created_at"]) < ttl:
        return json.loads(row["result"])
    return None


def set_compare_cache(conn, key: str, result: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO compare_cache (key, result, created_at) VALUES (?, ?, ?)",
        (key, json.dumps(result, ensure_ascii=False), time.time()),
    )
    conn.commit()


def save_document(conn, meta: dict, chunk_texts: list[str], embeddings: np.ndarray):
    cur = conn.execute(
        "INSERT INTO docs (company, title, date, source_url) VALUES (?, ?, ?, ?)",
        (meta["company"], meta["title"], meta.get("date"), meta.get("source_url")),
    )
    doc_id = cur.lastrowid
    for i, (text, vec) in enumerate(zip(chunk_texts, embeddings)):
        conn.execute(
            "INSERT INTO chunks (doc_id, idx, text, embedding) VALUES (?, ?, ?, ?)",
            (doc_id, i, text, np.asarray(vec, dtype=np.float32).tobytes()),
        )
    conn.commit()
    return doc_id
