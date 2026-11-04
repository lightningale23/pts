#!/usr/bin/env python3
"""Tidy the start of question text: things a packet printed before the question that aren't
part of it.

    python importer/clean_questions.py data/questions.csv [--write]

Without --write it lists what would change. merge_into_bank.py applies the same cleanup to
new rows.

What it removes (only at the very start of the question):
  - the round number in brackets on every question ("[11] What is ..." in Round 11)
  - empty brackets ("[] Order the ...")
  - a writer's initials already in the notes ("[AB] – Order ...")
  - a header the reader left in ("Tossup - Physics (EM) - Multiple Choice - ...", "MC: ...")
What it moves to the notes (they're instructions to the person reading):
  - "[read slowly]", "(Read carefully) –", "[read choices slowly]", "(READ SLOWLY)",
    "[Reader note: ...]", "(Replacement)-"
Kept: anything that is part of the question, like "[18]-annulene" or "(R)-carvone".
"""
import argparse, csv, re, sys

COLUMNS = ['id', 'set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format',
           'question', 'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes']
SEP = r'\s*(?:[-–—:]\s*)?'          # "[AB] – ", "(Replacement)- ", "(Read carefully) - "
READER = re.compile(r'^\s*[\[(]\s*((?:reader[’\']?s?\s+note\s*:\s*)?(?:read|pronounce)[^\])]{0,40}|reader[’\']?s?\s+note\s*:[^\])]{0,60})\s*[\])]' + SEP, re.I)
HEADER = re.compile(r'^\s*(?:toss[\s-]*up|bonus)\s*[-–—:]\s*[A-Za-z &/]+(?:\([^)]*\))?\s*[-–—:]\s*(?:short\s*answer|multiple\s*choice)\s*[-–—:]\s*', re.I)


def round_number(rnd):
    m = re.search(r'(\d+)\s*$', rnd or '')
    return m.group(1) if m else None


def clean(row):
    """Return (new question, notes to add) for one row."""
    q, notes = row['question'], []
    for _ in range(3):                                   # (a few can stack: "[11] [read slowly] ...")
        before = q
        m = re.match(r'^\s*\[(\d{1,2})\]\s+(?=\S)', q)    # the round number, with a space after (not "[18]-annulene")
        if m and m.group(1) == round_number(row['round']):
            q = q[m.end():]
        q = re.sub(r'^\s*\[\s*\]\s*', '', q)              # "[] "
        m = re.match(r'^\s*\[([A-Z][a-z]?[A-Z]{1,3})\]' + SEP, q)   # "[AB] – ": writer initials
        if m and m.group(1) in row['notes']:
            q = q[m.end():]
        m = READER.match(q)
        if m:
            notes.append('reader note: ' + re.sub(r'^reader[’\']?s?\s+note\s*:\s*', '', m.group(1).strip(), flags=re.I).lower())
            q = q[m.end():]
        m = re.match(r'^\s*\(\s*replacement\s*\)' + SEP, q, re.I)
        if m:
            notes.append('replacement question')
            q = q[m.end():]
        q = HEADER.sub('', q)
        q = re.sub(r'^\s*(?:MC|SA)\s*:\s*', '', q)
        if q == before:
            break
    return q.lstrip(), notes


def apply(row):
    q, notes = clean(row)
    if q == row['question'] and not notes:
        return False
    row['question'] = q
    if notes:
        row['notes'] = '; '.join(x for x in [row.get('notes', ''), *notes] if x)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('bank')
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    with open(a.bank, encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    changed = 0
    for r in rows:
        old = r['question']
        if apply(r):
            changed += 1
            if not a.write or changed <= 15:
                print(f"{r['set']} {r['round']} #{r['num']} {r['type']}: {old[:60]!r} -> {r['question'][:45]!r}")
    print(f'{changed} questions {"changed" if a.write else "would change"}', file=sys.stderr)
    if a.write:
        with open(a.bank, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, COLUMNS); w.writeheader(); w.writerows(rows)


if __name__ == '__main__':
    main()
