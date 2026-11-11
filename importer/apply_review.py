#!/usr/bin/env python3
"""Put the questions approved on dev.html's Review tab into the banks.

    python importer/apply_review.py [--dry-run]

review/decisions.json (written by the Review tab) holds one decision per queue item:
    { "<rid>": {"action": "add", "comp": "sb", "row": {set, year, ..., notes}, "at": "..."},
      "<rid>": {"action": "dismiss", "note": "...", "at": "..."} }
Each "add" that isn't in review/applied.json yet is merged into data/questions.csv or
data/osb-questions.csv with merge_into_bank.py (cleanup, LaTeX fixes, ID, subcategory; an exact
repeat of a bank question is not added twice), then recorded in review/applied.json:
    { "<rid>": {"id": "<bank id>", "at": "2026-11-11"} }   or   {"repeat": true, ...}
Dismissals need nothing here. A changelog entry is added when questions were added, and the
commit message is written to review/.commit-msg (the GitHub Action uses it).

The GitHub Action .github/workflows/apply-review.yml runs this on every push that changes
review/decisions.json, so pressing Save on the Review tab is all it takes.
"""
import argparse, collections, csv, datetime, json, re, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from merge_into_bank import COLUMNS, key, read   # noqa: E402
from clean_questions import apply as clean_start   # noqa: E402
from fix_latex import apply as fix_latex           # noqa: E402

BANKS = {'sb': ROOT / 'data' / 'questions.csv', 'osb': ROOT / 'data' / 'osb-questions.csv'}
REVIEW = ROOT / 'review'
TYPES = {'TOSS-UP', 'BONUS'}
FORMATS = {'Short Answer', 'Multiple Choice'}


def problems(row):
    """Why a row can't go into the bank as it is (empty list = fine)."""
    out = []
    for f in ('set', 'round', 'num', 'subject', 'question', 'answer'):
        if not str(row.get(f) or '').strip():
            out.append(f'no {f}')
    if row.get('type') not in TYPES:
        out.append(f"type {row.get('type')!r}")
    if row.get('format') not in FORMATS:
        out.append(f"format {row.get('format')!r}")
    if row.get('format') == 'Multiple Choice':
        if not all(str(row.get(c) or '').strip() for c in 'wxyz'):
            out.append('multiple choice needs all of W, X, Y, Z')
        if not re.match(r'^[WXYZ]\)', str(row.get('answer') or '').strip()):
            out.append('multiple choice answer must start with its letter, like "X) TEXT"')
    for f in ('accept', 'reject'):
        if '|' in str(row.get(f) or ''):
            out.append(f'"|" in {f} (it separates alternates)')
    return out


def today():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat()
    except Exception:   # noqa: BLE001
        return datetime.date.today().isoformat()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--review', default=str(REVIEW))
    ap.add_argument('--bank', action='append', default=[], metavar='COMP=CSV', help='use another bank file (testing)')
    ap.add_argument('--changelog', default=str(ROOT / 'data' / 'changelog.json'))
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args(argv)
    for b in a.bank:
        c, f = b.split('=', 1); BANKS[c] = Path(f)
    rv = Path(a.review)
    dfile, afile = rv / 'decisions.json', rv / 'applied.json'
    decisions = json.loads(dfile.read_text(encoding='utf-8')) if dfile.exists() else {}
    applied = json.loads(afile.read_text(encoding='utf-8')) if afile.exists() else {}
    date = today()

    todo = collections.defaultdict(list)   # comp -> [(rid, row)]
    for rid, d in decisions.items():
        if d.get('action') != 'add' or rid in applied:
            continue
        row = {c: str((d.get('row') or {}).get(c, '') or '').strip() for c in COLUMNS if c not in ('id', 'subcategory')}
        row['question'] = str((d.get('row') or {}).get('question', '')).strip()
        bad = problems(row)
        comp = d.get('comp', 'sb')
        if comp not in BANKS:
            bad.append(f'unknown competition {comp!r}')
        if bad:
            print(f'skip {rid}: ' + '; '.join(bad))
            continue
        todo[comp].append((rid, row))
    if not todo:
        print('nothing to add')
        return 0

    added_sets = collections.Counter()
    total = 0
    for comp, items in todo.items():
        bank = BANKS[comp]
        before = read(bank)
        old_ids = {r['id'] for r in before}
        with tempfile.TemporaryDirectory() as d:
            batch, groups = {}, collections.defaultdict(list)
            for rid, row in items:
                groups[(row['set'], row['year'], row['level'] or 'HS')].append(row)
            for i, ((s, y, lv), rows) in enumerate(groups.items()):
                p = Path(d) / f'review{i}.csv'
                with open(p, 'w', newline='', encoding='utf-8') as f:
                    w = csv.DictWriter(f, COLUMNS); w.writeheader()
                    w.writerows({c: r.get(c, '') for c in COLUMNS} for r in rows)
                batch[str(p)] = {'set': s, 'year': y, 'level': lv}
            (Path(d) / 'batch.json').write_text(json.dumps(batch), encoding='utf-8')
            out = Path(d) / 'bank.csv' if a.dry_run else bank
            res = subprocess.run([sys.executable, str(HERE / 'merge_into_bank.py'), '--map', str(Path(d) / 'batch.json'),
                                  '--bank', str(bank), '--out', str(out)], capture_output=True, text=True)
            print(res.stdout.strip())
            if res.returncode:
                print(res.stderr, file=sys.stderr)
                return 1
            after = read(out)
        new = {key(r): r for r in after if r['id'] not in old_ids}
        for rid, row in items:
            r = dict(row)
            clean_start(r); fix_latex(r)   # what merge_into_bank stored
            b = new.get(key(r))
            if b:
                applied[rid] = {'id': b['id'], 'at': date}
                added_sets[b['set']] += 1
                total += 1
                print(f"added {rid} -> {b['id']}  {b['set']} {b['round']} #{b['num']} {b['type']}")
            else:
                applied[rid] = {'repeat': True, 'at': date}
                print(f'{rid}: already in the bank, not added again')

    if a.dry_run:
        print(f'dry run: would add {total}')
        return 0
    afile.write_text(json.dumps(applied, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    msg = 'Add reviewed questions'
    if total:
        sets = ', '.join(s for s, _ in added_sets.most_common())
        entry = f"{total} more question{'s' if total != 1 else ''} ({sets}), fixed up by hand from questions the packet reader had left out."
        cl = Path(a.changelog)
        days = json.loads(cl.read_text(encoding='utf-8'))
        if days and days[0]['date'] == date:
            days[0]['items'].insert(0, entry)
        else:
            days.insert(0, {'date': date, 'items': [entry]})
        cl.write_text(json.dumps(days, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        msg = f"Add {total} reviewed question{'s' if total != 1 else ''} ({sets})\n\nChangelog: {entry}"
    (rv / '.commit-msg').write_text(msg + '\n', encoding='utf-8')
    print(msg)
    return 0


if __name__ == '__main__':
    sys.exit(main())
