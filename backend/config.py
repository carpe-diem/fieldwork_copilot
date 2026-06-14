import os

CHAT_MODEL = os.environ.get("CHAT_MODEL", "gpt-4o-mini")
EMBED_MODEL = "text-embedding-3-small"  # changing this requires re-running ingest.py
MAX_TOOL_ROUNDS = 4
COMPARE_CACHE_TTL = int(os.environ.get("COMPARE_CACHE_TTL", "86400"))
