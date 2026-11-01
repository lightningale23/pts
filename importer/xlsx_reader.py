"""Read packets kept as spreadsheets (one .xlsx per round) into bank rows.

Expected columns (header row, any order): Type, Category, Format, Question, W, X, Y, Z,
Answer, Accept, Do Not Accept, and optionally Writer. Rows with no question are skipped.

    python3 importer/xlsx_reader.py FOLDER --set "Name 2026" --year 2026 --out rows.csv
"""
import argparse, csv, re, sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).parent))
import packet_reader as pr

SUBJ = {'math': 'Mathematics', 'mathematics': 'Mathematics', 'earth and space': 'Earth and Space',
        'earth & space': 'Earth and Space', 'bio': 'Biology', 'chem': 'Chemistry'}


def cell(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return pr._clean(str(v)).strip()


def round_name(path):
    m = re.search(r'#\s*(\d+)', path.stem) or re.search(r'(\d+)\s*$', path.stem)
    return f'Packet {m.group(1)}' if m else path.stem.title()


def read_xlsx(path, set_name, year, level='HS'):
    """Rows and a list of problems for one spreadsheet."""
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    hdr = [cell(c).lower() for c in next(ws.iter_rows(max_row=1, values_only=True))]
    col = {h: i for i, h in enumerate(hdr) if h}
    col.setdefault('type', 0)  # (one sheet's header cell reads "p" instead of "Type")
    rows, problems, num = [], [], 0
    rnd = round_name(path)
    for raw in ws.iter_rows(min_row=2, values_only=True):
        g = lambda k: cell(raw[col[k]]) if k in col and col[k] < len(raw) else ''
        typ = 'TOSS-UP' if g('type').lower().startswith('toss') else 'BONUS'
        if typ == 'TOSS-UP':
            num += 1
        q = g('question')
        if not q:
            continue
        opts = {k: g(k) for k in 'wxyz'}
        # Some sheets say "Multiple Choice" for select-all questions with no options.
        fmt = 'Multiple Choice' if opts['w'] and opts['x'] else 'Short Answer'
        ans = g('answer')
        if fmt == 'Multiple Choice':
            m = re.match(r'^\(?([WXYZ])\)?(?:[\s.:)-]+(.*))?$', ans, re.I)
            if m:
                L = m.group(1).upper()
                ans = f'{L}) ' + (m.group(2) or opts[L.lower()]).upper()
            else:
                hit = [k for k, v in opts.items() if v and v.lower() == ans.lower()]
                if hit:
                    ans = f'{hit[0].upper()}) {opts[hit[0]].upper()}'
                else:
                    problems.append(f'{rnd} {typ} {num}: multiple-choice answer is not a letter: {ans!r}')
        cat = g('category')
        rows.append({'id': '', 'set': set_name, 'year': year, 'level': level, 'round': rnd, 'num': str(max(num, 1)),
                     'type': typ, 'subject': SUBJ.get(cat.lower(), cat), 'format': fmt, 'question': q,
                     **(opts if fmt == 'Multiple Choice' else {k: '' for k in 'wxyz'}),
                     'answer': ans, 'accept': g('accept'), 'reject': g('do not accept'),
                     'notes': ('writer: ' + g('writer')) if g('writer') else ''})
    return rows, problems


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder')
    ap.add_argument('--set', required=True)
    ap.add_argument('--year', default='')
    ap.add_argument('--out', default='xlsx_rows.csv')
    a = ap.parse_args(argv)
    files = sorted((f for f in Path(a.folder).glob('*.xlsx') if 'template' not in f.name.lower()),
                   key=lambda p: pr.natural_key(p.name))
    allrows = []
    for f in files:
        rows, problems = read_xlsx(f, a.set, a.year)
        allrows += rows
        print(f'{f.name}: {len(rows)} questions' + ''.join(f'\n  {p}' for p in problems))
    with open(a.out, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, pr.COLUMNS); w.writeheader(); w.writerows(allrows)


if __name__ == '__main__':
    main()
