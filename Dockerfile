# Stage 1: build the Vite SPA
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python API + pre-built assets
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock backend/
RUN uv sync --project backend --frozen
COPY backend/ backend/
COPY corpus/ corpus/
COPY --from=frontend /app/frontend/dist/ frontend/dist/

CMD cd backend && uv run python ingest.py && uv run uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
