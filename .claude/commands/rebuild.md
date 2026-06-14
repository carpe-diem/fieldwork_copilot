Rebuild `backend/library.db` from scratch by re-chunking and re-embedding all documents in the corpus.

This is required after:
- Adding a new document with `/add-doc`
- Editing an existing `.txt` file in `corpus/`
- Changing chunking parameters in `backend/ingest.py`

Run from the repo root:

```bash
cd backend && uv run --env-file .env python ingest.py
```

The ingest script will:
1. Delete the existing `library.db`
2. Re-read every document registered in `corpus/metadata.json`
3. Chunk each document (Q&A pairs for transcripts, paragraphs otherwise)
4. Embed each chunk with `text-embedding-3-small` via the OpenAI API
5. Save chunks + embeddings to `library.db`

Show the full output. When done, report the total chunk count and remind the user to **restart the backend** (`uvicorn main:app --port 8000 --reload`) so the new index is loaded into memory.

If the command fails with "OPENAI_API_KEY not set", verify that `backend/.env` exists and contains `OPENAI_API_KEY=sk-...`.
