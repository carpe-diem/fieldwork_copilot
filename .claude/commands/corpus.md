Show the current state of the Fieldwork Copilot corpus — what documents are loaded, how many chunks each produced, and the size of the vector store.

Run these shell commands from the repo root and present the results as a clean summary:

```bash
# 1. Document list from metadata.json
python3 -c "
import json, pathlib, sys
meta = next((p for p in [pathlib.Path('corpus/metadata.json'), pathlib.Path('../corpus/metadata.json')] if p.exists()), None)
if not meta:
    print('corpus/metadata.json not found'); exit()
docs = json.loads(meta.read_text())
print(f\"{'Company':<18} {'Title':<48} {'Date':<12}\")
print('-' * 80)
for d in docs:
    print(f\"{d.get('company','')[:17]:<18} {d.get('title','')[:47]:<48} {d.get('date','')[:11]:<12}\")
print(f'\nTotal documents: {len(docs)}')
"

# 2. Chunk counts per document from library.db
python3 -c "
import sqlite3, pathlib
db = next((p for p in [pathlib.Path('library.db'), pathlib.Path('backend/library.db')] if p.exists()), None)
if not db:
    print('library.db not found — run /rebuild first')
    exit()
con = sqlite3.connect(db)
rows = con.execute('''
    SELECT d.company, d.title, COUNT(c.id) as chunks
    FROM docs d JOIN chunks c ON c.doc_id = d.id
    GROUP BY d.id ORDER BY d.company, d.title
''').fetchall()
total = sum(r[2] for r in rows)
print(f'\n{'Company':<18} {'Title':<44} Chunks')
print('-' * 72)
for co, title, n in rows:
    print(f'{co[:17]:<18} {title[:43]:<44} {n:>5}')
print(f'\nTotal chunks: {total}')
size = db.stat().st_size / 1024
print(f'DB size: {size:.1f} KB')
"

Present the output as a clean table. If `library.db` is missing, tell the user to run `/rebuild`.
