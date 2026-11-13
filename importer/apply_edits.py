#!/usr/bin/env python3
"""Apply the bank edits made on dev.html's Edit tab.

    python importer/apply_edits.py [--dry-run]

review/edits.json (written by the Edit tab) holds one entry per edited question, keyed by its
bank ID:
    { "<id>": {"action": "edit", "file": "data/questions.csv",
               "changes": {"answer": {"from": "OLD", "to": "NEW"}, ...},
               "note": "...", "closes": [12], "at": "2026-11-12T..."},
      "<id>": {"action": "remove", "file": "...", "note": "...", "at": "..."} }
An entry whose `at` differs from review/edits-applied.json is applied to its file in place: the
row keeps its ID, and only the fields in `changes` change. When a field no longer holds `from`
(someone changed it since) and doesn't already hold `to`, the whole entry is left alone and
recorded as a conflict. A changed subject with no subcategory picked gets a new subcategory
(tag_subcategories.py, trained on the whole bank). "remove" deletes the row (and a visual bonus's
picture). Each entry is recorded in review/edits-applied.json:
    { "<id>": {"at": "<entry at>", "status": "applied" | "removed" | "conflict" | "missing" | "invalid",
               "date": "2026-11-12", "detail": "..."} }
Writes the commit message to review/.commit-msg and the question reports to close to
review/.close-issues.tsv (issue number, tab, comment); the GitHub Action
.github/workflows/apply-edits.yml commits and closes them.
"""
import argparse, collections, csv, datetime, json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from apply_review import problems, today   # noqa: E402

FILES = {'data/questions.csv': 'sb', 'data/osb-questions.csv': 'osb', 'data/visual-bonuses.csv': 'sb'}
MAIN = {'sb': 'data/questions.csv', 'osb': 'data/osb-questions.csv'}
EDITABLE = ['set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format', 'question',
            'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes', 'subcategory']


def read(path):
    with open(path, encoding='utf-8', newline='') as f:
        rd = csv.DictReader(f)
        return list(rd), list(rd.fieldnames or [])


def write(path, rows, fields):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fields)
        w.writeheader()
        w.writerows(rows)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', default=str(ROOT))
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-tag', action='store_true', help='skip subcategory tagging (tests)')
    a = ap.parse_args(argv)
    root = Path(a.root)
    rv = root / 'review'
    efile, dfile = rv / 'edits.json', rv / 'edits-applied.json'
    edits = json.loads(efile.read_text(encoding='utf-8')) if efile.exists() else {}
    done = json.loads(dfile.read_text(encoding='utf-8')) if dfile.exists() else {}
    date = today()

    banks = {}   # file -> (rows, fields)
    def bank(f):
        if f not in banks:
            banks[f] = read(root / f)
        return banks[f]

    fixed_sets, removed_sets = collections.Counter(), collections.Counter()
    retag = collections.defaultdict(list)   # comp -> rows
    closes = []
    touched = set()
    for qid, e in edits.items():
        if done.get(qid, {}).get('at') == e.get('at'):
            continue
        f = e.get('file', '')
        rec = {'at': e.get('at'), 'date': date}
        if f not in FILES:
            done[qid] = {**rec, 'status': 'invalid', 'detail': f'unknown file {f!r}'}
            print(f'skip {qid}: unknown file {f!r}')
            continue
        rows, fields = bank(f)
        at = next((i for i, r in enumerate(rows) if r['id'] == qid), None)
        if at is None:
            done[qid] = {**rec, 'status': 'missing', 'detail': f'no question {qid} in {f}'}
            print(f'skip {qid}: not in {f}')
            continue
        row = rows[at]
        if e.get('action') == 'remove':
            img = row.get('image', '')
            del rows[at]
            if img.startswith('data/visuals/') and (root / img).exists() and not a.dry_run:
                (root / img).unlink()
            done[qid] = {**rec, 'status': 'removed'}
            removed_sets[row['set']] += 1
            touched.add(f)
            print(f"removed {qid}  {row['set']} {row['round']} #{row['num']}")
        else:
            changes = {k: v for k, v in (e.get('changes') or {}).items() if k in EDITABLE}
            clash = [k for k, v in changes.items() if row.get(k, '') not in (v.get('from', ''), v.get('to', ''))]
            if clash:
                done[qid] = {**rec, 'status': 'conflict', 'detail': 'changed since it was edited: ' + ', '.join(clash)}
                print(f'conflict {qid}: {", ".join(clash)}')
                continue
            new = dict(row)
            for k, v in changes.items():
                new[k] = str(v.get('to', ''))
            if new['format'] != 'Multiple Choice':
                for c in 'wxyz':
                    new[c] = ''
            bad = problems(new)
            if bad:
                done[qid] = {**rec, 'status': 'invalid', 'detail': '; '.join(bad)}
                print(f'skip {qid}: ' + '; '.join(bad))
                continue
            if 'subject' in changes and 'subcategory' not in changes:
                new['subcategory'] = ''
                retag[FILES[f]].append(new)
            rows[at] = new
            done[qid] = {**rec, 'status': 'applied'}
            fixed_sets[new['set']] += 1
            touched.add(f)
            print(f"edited {qid}  {new['set']} {new['round']} #{new['num']}: {', '.join(changes)}")
        for n in e.get('closes') or []:
            what = 'Removed this question from the bank' if e.get('action') == 'remove' else \
                f"Fixed ({', '.join(sorted((e.get('changes') or {}).keys())) or 'no change'})"
            closes.append((int(n), f"{what} on the dev page's Edit tab.{(' ' + e['note']) if e.get('note') else ''}"))

    # New subcategories for questions whose subject changed, learned from the whole bank.
    if retag and not a.no_tag:
        try:
            import tag_subcategories as ts
            for comp, items in retag.items():
                base = bank(MAIN[comp])[0]
                labels, _ = ts.tag(base + items, ts.RULES[comp])
                for i, r in enumerate(items):
                    r['subcategory'] = labels.get(len(base) + i, '')
        except Exception as ex:   # noqa: BLE001
            print(f'WARNING: subcategories not filled in ({type(ex).__name__}: {ex})')

    total, gone = sum(fixed_sets.values()), sum(removed_sets.values())
    if a.dry_run:
        print(f'dry run: would edit {total}, remove {gone}')
        return 0
    for f in touched:
        rows, fields = banks[f]
        write(root / f, rows, fields)
    dfile.write_text(json.dumps(done, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    if not (total or gone):
        print('nothing applied')
        (rv / '.commit-msg').write_text('Record bank edits\n', encoding='utf-8')
        return 0
    parts = []
    if total:
        parts.append(f"Fixed {total} question{'s' if total != 1 else ''} ({', '.join(s for s, _ in fixed_sets.most_common())})")
    if gone:
        parts.append(f"removed {gone} broken question{'s' if gone != 1 else ''} ({', '.join(s for s, _ in removed_sets.most_common())})")
    entry = '; '.join(parts) + '.'
    entry = entry[0].upper() + entry[1:]
    cl = root / 'data' / 'changelog.json'
    days = json.loads(cl.read_text(encoding='utf-8'))
    if days and days[0]['date'] == date:
        days[0]['items'].insert(0, entry)
    else:
        days.insert(0, {'date': date, 'items': [entry]})
    cl.write_text(json.dumps(days, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    title = entry.rstrip('.')
    (rv / '.commit-msg').write_text(f'{title}\n\nChangelog: {entry}\n', encoding='utf-8')
    if closes:
        (rv / '.close-issues.tsv').write_text(''.join(f'{n}\t{c}\n' for n, c in closes), encoding='utf-8')
    print(entry)
    return 0


if __name__ == '__main__':
    sys.exit(main())
