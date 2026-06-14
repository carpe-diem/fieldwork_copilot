Inspect and manage the compare cache in `backend/library.db`.

The compare cache stores LLM-generated comparison tables so that repeated Ryanair vs Costco requests don't burn API credits. Cache keys are sorted and normalized: `company_a|company_b|dim1,dim2,...`.

**Step 1 — show current cache state:**

```bash
python3 -c "
import sqlite3, json, time, pathlib, os

db = next((p for p in [pathlib.Path('library.db'), pathlib.Path('backend/library.db')] if p.exists()), pathlib.Path('library.db'))
if not db.exists():
    print('library.db not found — run /rebuild first')
    exit()

ttl = int(os.environ.get('COMPARE_CACHE_TTL', 86400))
now = time.time()
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row

rows = con.execute('SELECT key, created_at FROM compare_cache ORDER BY created_at DESC').fetchall()
if not rows:
    print('Cache is empty.')
else:
    print(f'TTL: {ttl}s ({ttl//3600}h)  |  {len(rows)} entr{\"y\" if len(rows)==1 else \"ies\"}\n')
    print(f'  # {\"Key\":<55} {\"Age\":>8}  Status')
    print('  ' + '-'*75)
    for i, r in enumerate(rows, 1):
        age_s = now - r[\"created_at\"]
        age_h = age_s / 3600
        status = \"VALID\" if age_s < ttl else \"EXPIRED\"
        key_display = r[\"key\"][:54]
        print(f'  {i} {key_display:<55} {age_h:>6.1f}h  {status}')
"
```

**Step 2 — ask the user** what they want to do:
- **Clear all** expired entries
- **Clear all** entries (including valid ones)
- **Clear one entry** (they provide the companies)
- **Do nothing**

Then execute their choice:

```bash
# Clear all expired:
python3 -c "
import sqlite3, time, pathlib, os
db = next((str(p) for p in [pathlib.Path('library.db'), pathlib.Path('backend/library.db')] if p.exists()), 'library.db')
ttl = int(os.environ.get('COMPARE_CACHE_TTL', 86400))
con = sqlite3.connect(db)
cutoff = time.time() - ttl
n = con.execute('DELETE FROM compare_cache WHERE created_at < ?', (cutoff,)).rowcount
con.commit()
print(f'Deleted {n} expired entr{\"y\" if n==1 else \"ies\"}.')
"

# Clear all:
python3 -c "
import sqlite3, pathlib
db = next((str(p) for p in [pathlib.Path('library.db'), pathlib.Path('backend/library.db')] if p.exists()), 'library.db')
con = sqlite3.connect(db)
n = con.execute('DELETE FROM compare_cache').rowcount
con.commit()
print(f'Deleted {n} entr{\"y\" if n==1 else \"ies\"}.')
"
```

If clearing a specific entry, construct the normalized key the same way the backend does:
`sorted([a.lower(), b.lower()])` joined with `|`, then the sorted dimensions joined with `,`.
