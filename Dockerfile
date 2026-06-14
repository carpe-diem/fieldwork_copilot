FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock backend/
RUN uv sync --project backend --frozen

COPY backend/ backend/
COPY corpus/ corpus/
COPY frontend/dist/ frontend/dist/

CMD cd backend && uv run python ingest.py && uv run uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
