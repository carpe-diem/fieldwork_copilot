# Fieldwork Copilot

Chat with a private library of executive interviews and earnings call transcripts,
with verifiable citations. Built as a working sketch of an AI research assistant
for long-term fundamental investors.

Two modes, one retrieval engine:

- **Chat**: ask anything; an agent decides when and how to search the library,
  answers like a research note, and cites every claim with a clickable footnote
  that opens the original excerpt.
- **Compare**: pick two companies; the same engine fills a structured table
  (competitive advantage, cost discipline, pricing power, risks, capital allocation),
  cell by cell, each cell with its own citations or an honest "no evidence in the library".

The corpus ships with ten verified transcripts: Costco ×3, Walmart ×1,
Ryanair ×4, Wizz Air ×2 — two intra-sector pairs that also cross-compare.

## Architecture

```
[React SPA] ── HTTP / SSE ──> [FastAPI] ──> [SQLite + numpy index]   chunks, embeddings, metadata
   chat UI                       │
   citations panel               └─────────> [OpenAI API]             agentic chat loop, embeddings,
   compare table                                                       structured output (compare)
```

- **Ingestion** (`backend/ingest.py`, offline): reads `corpus/`, chunks each
  document, embeds the chunks, writes everything to a single SQLite file
  (`backend/library.db`).
- **API** (`backend/main.py`): `/api/chat` streams over SSE and runs a small
  tool-use loop — the model calls `search_library(query, company?)` as many
  times as it needs before answering. `/api/compare` runs targeted retrieval
  per company × dimension and asks the model for JSON with per-cell citations
  and a confidence field.
- **Frontend** (`frontend/`): Vite + React, no UI framework. Streaming via
  `fetch` + `ReadableStream`. `[n]` markers in the answer render as chips that
  open a source panel with the original excerpt.

## Setup

### Backend

```bash
cd backend
cp .env.example .env          # add your OPENAI_API_KEY
uv sync                       # installs deps from uv.lock
uv run python ingest.py       # builds library.db from ../corpus
uv run uvicorn main:app --port 8000 --reload
```

### Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 — proxies /api → :8000
```

## Corpus management

The corpus lives in `corpus/`. Each document is a `.txt` file with a matching
entry in `corpus/metadata.json`. To add a new one, copy the transcript text
(Motley Fool, company IR pages, Seeking Alpha) into a file and run:

```bash
# 1. Write corpus/<company>-<title>-<YYYY-MM-DD>.txt
# 2. Add entry to corpus/metadata.json
cd backend
python ingest.py              # re-chunks and re-embeds the full corpus
```

Use `/add-doc` inside Claude Code for a guided walkthrough.

## Decisions and tradeoffs

This is a demo built to anchor a conversation, not a production system.
Every shortcut below is deliberate — the goal was ~2 hours of build time
and something fully explainable in an interview.

---

### Storage: SQLite → PostgreSQL

**Demo**: a single `library.db` file. Zero ops, zero config, runs anywhere.

**Production**: PostgreSQL. Reasons: concurrent writes (ingestion jobs alongside
the live API), proper connection pooling, row-level locking, and — critically —
the `pgvector` extension, which makes the vector index part of the same DB and
eliminates the two-system problem (relational data in Postgres, vectors in a
separate store).

---

### Vector search: numpy brute-force → pgvector + HNSW

**Demo**: `store.LibraryIndex` loads all embeddings into a numpy matrix at
startup and computes cosine similarity in-process. At <5k chunks it's
sub-millisecond with zero infrastructure.

**Production**: pgvector with an HNSW index. HNSW is an approximate
nearest-neighbor algorithm with sub-linear query time — essential at 100k+
chunks. Because it lives in Postgres, filtering by company or date range is a
single query with no extra round-trip. The migration is intentionally contained
in `store.py`.

At larger scale (multi-tenant, millions of chunks): a dedicated vector store
(Pinecone, Weaviate) gives geo-distributed indexes, filtered ANN, and zero
operational burden at the cost of an additional service.

---

### Retrieval: embeddings only → hybrid BM25 + embeddings + RRF

**Demo**: semantic similarity only. Works well for conceptual queries ("how
does management think about pricing"). Recall degrades on proper nouns, ticker
symbols, and exact phrases where keyword search would win.

**Production**: hybrid retrieval. Run BM25 (keyword) and embedding (semantic)
searches in parallel, then merge ranked lists with Reciprocal Rank Fusion.
This fixes the "Wizz Air" / "WIZZ" / "W9Z" recall problem without
fine-tuning the embedding model. Also enables exact-quote lookup, which pure
vector search misses.

---

### LLM client: OpenAI SDK → LiteLLM (Or similar)

**Demo**: `openai.OpenAI()` called directly in `helpers.py`. Switching
providers means changing code.

**Production**: LiteLLM (Or similar) — a thin layer
that speaks the OpenAI API but routes to any provider (Anthropic, Gemini,
Azure, local Ollama). Benefits:
- **Model routing**: cheap model for simple queries, expensive model for
  complex multi-step reasoning.
- **Fallbacks**: if OpenAI is unavailable, route to Anthropic automatically.
- **Cost tracking** and per-tenant rate limiting without extra infrastructure.
- **A/B testing** of models with no code changes.

The swap is one line in `helpers.py`: `OpenAI()` → `litellm.completion()`.

---

### Database access: raw SQL → SQLAlchemy Core

**Demo**: `sqlite3` with hand-written SQL strings in `store.py`. Fine for a
single-table schema with a handful of known queries.

**Production**: SQLAlchemy Core (not the ORM — the query patterns here are
ad-hoc enough that full ORM abstraction adds noise). Benefits: parameterized
queries as a default (no SQL injection surface at boundaries), dialect-agnostic
code (same models work with SQLite in tests, Postgres in prod), and Alembic for
schema migrations without manual `ALTER TABLE`.
---

## Claude commands

These slash commands are available inside Claude Code (`/command-name`):

| Command | What it does |
|---|---|
| `/corpus` | Show all loaded documents, chunk counts, and DB size |
| `/add-doc [company]` | Guided walkthrough to add a new transcript |
| `/rebuild` | Re-chunk and re-embed the full corpus (`ingest.py`) |
| `/earnings [company]` | Check corpus coverage + generate analyst questions for the next call |
| `/cache` | Inspect and clear the compare cache in `library.db` |
