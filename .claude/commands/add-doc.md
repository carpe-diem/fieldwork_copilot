Guide the user through adding a new transcript or document to the Fieldwork Copilot corpus.

The argument (if provided) is the company name: $ARGUMENTS

## Step 1 — Get the text

Ask the user:
1. What company and document is this? (e.g. "Amazon Q1 2025 earnings call")
2. Ask them to paste the full transcript text.

Good sources to copy from:
- **Motley Fool**: `https://www.fool.com/earnings/call-transcripts/`
- **Seeking Alpha**: requires login
- **Company IR pages**: usually PDF — copy the text out manually

## Step 2 — Write the file

1. Determine a safe filename: `corpus/<company_lowercase>-<title_slug>-<YYYY-MM-DD>.txt` (hyphens, no spaces).
2. Write the pasted text to that file.
3. Read `corpus/metadata.json` and add an entry:
```json
{
  "file": "corpus/<filename>.txt",
  "company": "<Company>",
  "title": "<Title>",
  "date": "<YYYY-MM-DD>",
  "source_url": "<URL or empty string>"
}
```

## Step 3 — Rebuild the index

```bash
cd backend && python ingest.py
```

Show the output and confirm the new document's chunk count.

## Step 4 — Restart the backend

Remind the user to restart uvicorn so the new index loads into memory:
```bash
uvicorn main:app --port 8000 --reload
```
(Or if already running with `--reload`, just wait a moment for it to auto-reload.)
