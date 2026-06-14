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

## Claude commands

These slash commands are available inside Claude Code (`/command-name`):

| Command | What it does |
|---|---|
| `/corpus` | Show all loaded documents, chunk counts, and DB size |
| `/add-doc [company]` | Guided walkthrough to add a new transcript |
| `/rebuild` | Re-chunk and re-embed the full corpus (`ingest.py`) |
| `/earnings [company]` | Check corpus coverage + generate analyst questions for the next call |
| `/cache` | Inspect and clear the compare cache in `library.db` |
