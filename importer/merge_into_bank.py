#!/usr/bin/env python3
"""Merge reader output CSVs into a bank file (data/questions.csv or data/osb-questions.csv).

    python importer/merge_into_bank.py --map batch.json [--fixes fixes.json] \
        [--bank data/questions.csv] [--out data/questions.csv]

batch.json maps each reader CSV to the set it belongs to:
    { "parsed/MIT_2025.csv": {"set": "MIT 2025", "year": "2025", "level": "HS"},
      "parsed/Texas.csv":    {"set": "Texas 2026", "year": "2026", "level": "HS",
                              "rounds": {"Round 6": "DE1"}} }      # optional round renames

fixes.json (optional) changes or drops single rows, keyed "set|round|num|type":
    { "MIT 2025|Round 3|12|BONUS": null,                          # drop it
      "MIT 2025|Round 4|7|TOSS-UP": {"accept": "MITOSIS; M PHASE"} }

What it does:
  - existing bank rows are kept exactly as they are
  - rows with no question or no answer are skipped
  - a row that repeats a question already in the bank (or earlier in this batch) is skipped;
    the key is the normalized question (first 400 chars) + answer (first 100)
  - a row printed as Short Answer but with W) X) Y) Z) lines and a lettered answer becomes
    Multiple Choice
  - the start of each question is tidied (importer/clean_questions.py): a round number in
    brackets, empty brackets, reader notes like "[read slowly]" (moved to the notes)
  - new rows get the ID the site derives (importer/ids.mjs); a collision gets a -2, -3 suffix
  - prints a table per set: read / added / repeats / empty / dropped
Use --out somewhere else first for a dry run, check it, then write the real bank.
"""
import argparse, collections, csv, json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clean_questions import apply as clean_start   # noqa: E402

HERE = Path(__file__).resolve().parent
COLUMNS = ['id', 'set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format',
           'question', 'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes']

norm = lambda t: re.sub(r'[^a-z0-9]', '', re.sub(r'\$|\\text|\\frac|[{}^_]', '', (t or '').lower()))
key = lambda r: norm(r['question'])[:400] + '|' + norm(r['answer'])[:100]
nat = lambda s: [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s or '')]
MC_IN_QUESTION = re.compile(r'(?s)(.*?)\n\s*W\)\s*(.+?)\n\s*X\)\s*(.+?)\n\s*Y\)\s*(.+?)\n\s*Z\)\s*(.+?)\s*$')


def read(p):
    with open(p, encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))


def write(p, rows):
    with open(p, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, COLUMNS); w.writeheader(); w.writerows(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--map', required=True)
    ap.add_argument('--fixes')
    ap.add_argument('--bank', default=str(HERE.parent / 'data' / 'questions.csv'))
    ap.add_argument('--out')
    a = ap.parse_args()
    out = Path(a.out or a.bank)
    batch = json.load(open(a.map))
    fixes = json.load(open(a.fixes)) if a.fixes else {}

    bank = read(a.bank)
    seen = {key(r) for r in bank}
    stats = collections.OrderedDict()
    added = []
    for path, target in batch.items():
        name = target['set']
        st = stats.setdefault(name, {'read': 0, 'added': 0, 'repeats': 0, 'empty': 0, 'dropped': 0, 'to_mc': 0})
        for r in read(path):
            st['read'] += 1
            r['round'] = target.get('rounds', {}).get(r['round'], r['round'])
            k4 = f"{name}|{r['round']}|{r['num']}|{r['type']}"
            if k4 in fixes:
                if fixes[k4] is None:
                    st['dropped'] += 1; continue
                r.update(fixes[k4])
            if not (r.get('question') or '').strip() or not (r.get('answer') or '').strip():
                st['empty'] += 1; continue
            clean_start(r)   # round numbers, reader notes etc. printed before the question
            k = key(r)
            to_mc = False
            if r.get('format') == 'Short Answer':
                m = MC_IN_QUESTION.match(r['question'])
                if m and re.match(r'^\(?[WXYZ]\)', r['answer'].strip()):
                    r['question'] = m.group(1).strip()
                    r['w'], r['x'], r['y'], r['z'] = (re.sub(r'\s+', ' ', g).strip() for g in m.groups()[1:])
                    r['format'] = 'Multiple Choice'
                    to_mc = True
            k2 = key(r)  # (a repeat may be in the bank in either shape)
            if k in seen or k2 in seen:
                st['repeats'] += 1; continue
            seen.update((k, k2))
            st['to_mc'] += to_mc
            r.update(set=name, year=target.get('year', ''), level=target.get('level', 'HS'), id='')
            added.append({c: r.get(c, '') for c in COLUMNS})
            st['added'] += 1

    added.sort(key=lambda r: (r['set'], nat(r['round']), int(r['num']) if str(r['num']).isdigit() else 0, r['type'] != 'TOSS-UP'))
    rows = bank + added
    write(out, rows)
    ids = subprocess.run(['node', str(HERE / 'ids.mjs'), str(out)], capture_output=True, text=True, check=True).stdout.split()
    assert len(ids) == len(rows), (len(ids), len(rows))
    used = {r['id'] for r in rows if r['id']}
    for r, d in zip(rows, ids):
        if not r['id']:
            nid, n = d, 1
            while nid in used:
                n += 1; nid = f'{d}-{n}'
            r['id'] = nid; used.add(nid)
    assert len({r['id'] for r in rows}) == len(rows)
    write(out, rows)
    for k, v in stats.items():
        print(f"{k:30} read {v['read']:5}  added {v['added']:5}  repeats {v['repeats']:4}  empty {v['empty']:3}  dropped {v['dropped']:3}  to MC {v['to_mc']}")
    print(f'bank before {len(bank)}, after {len(rows)} -> {out}')


if __name__ == '__main__':
    main()
