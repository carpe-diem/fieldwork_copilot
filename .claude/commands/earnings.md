Earnings call research assistant. Given a company name or ticker, check if it's in the corpus and generate targeted analytical questions for the next earnings call.

Target company: $ARGUMENTS

## Step 1 — Check corpus coverage

Read `corpus/metadata.json` and check if the company (or ticker) appears. Report:
- Documents found: company | title | date (newest first)
- If not found: suggest sources and the `/add-doc` command

```bash
python3 -c "
import json, sys
docs = json.load(open('corpus/metadata.json'))
target = '$ARGUMENTS'.lower().strip()
matches = [d for d in docs if target in d.get('company','').lower() or target in d.get('title','').lower()]
if matches:
    print(f'Found {len(matches)} document(s) in corpus:')
    for d in sorted(matches, key=lambda x: x.get('date',''), reverse=True):
        print(f'  • {d[\"company\"]} — {d[\"title\"]} ({d.get(\"date\",\"no date\")})')
else:
    print('Not in corpus.')
"
```

## Step 2 — Generate sector-specific analytical questions

Based on the company's sector (infer from name/ticker), propose **3 high-quality questions** in English an analyst should bring to the earnings call. Focus on what management controls vs. what is structural, and what the transcript evidence in the library supports or contradicts.

**Sector question templates:**

**Airlines / LCCs (Ryanair, Wizz Air, easyJet):**
1. How is CASK (cost per available seat kilometer) ex-fuel trending, and what's the driver?
2. What's the load factor and ancillary revenue per passenger guidance for the next quarter?
3. How is management characterizing the competitive dynamic with [main rival]?

**Retail / Warehouse clubs (Costco, Walmart, BJ's):**
1. What's the renewal rate trend for membership fees, and is a fee increase signaled?
2. How is gross margin behaving — is the low-markup model under any pressure?
3. What's management saying about the consumer health of their core demographic?

**Tech / SaaS:**
1. What's net revenue retention (NRR) and how is it trending by cohort?
2. What's the Rule of 40 score (growth + FCF margin) this quarter vs. guidance?
3. How is AI/automation affecting headcount and margins?

If the company doesn't fit these buckets, generate 3 sector-appropriate questions using first principles: unit economics, competitive positioning, and forward guidance. Always in English.

## Step 3 — Suggest the killer question

Based on what's in the corpus (if it is), identify the ONE tension or ambiguity in management's narrative that most warrants probing — the place where prior statements could be tested against this quarter's results. For example: "O'Leary said X in FY24; now that yield environment has changed, ask whether X still holds."
