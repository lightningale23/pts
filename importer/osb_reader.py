"""Rule-based reader for Ocean Science Bowl (NOSB) packets.

Handles the layouts NOSB question sets come in, and writes rows in the pts bank format:

  fields    "Question Type: Toss-Up / Question Format: Multiple Choice / Category: Biology /
            Question Text: ... / Answer W: ... / Correct Answer: W / Round: Round 01 / Pair: 1"
            (the official sample sets), and the older "Toss-up / Multiple Choice / Biological /
            Question: ... / Answer W: ... / Correct Answer: X" pages (often scans: OCR them first)
  numbered  "Toss-Up 1 (Biology): ... / W: ... / Answer: X / Bonus 1 (Biology): ... / Answer: ..."
            under "Round N" headings
  quizbowl  pyramidal tossups ("... (*) ... For 10 points, name ...") and "[10]" bonuses,
            with answers like "ANSWER: brown algae [or Phaeophyceae; prompt on kelps] <Biology>"

Usage
  python osb_reader.py FILE [FILE ...] --out DIR [--set NAME] [--year YYYY] [--layout fields|numbered|quizbowl]

FILE is a PDF with a text layer or a .txt (e.g. OCR output). The layout is detected unless given.
Writes one CSV per file plus report.json.
"""
import argparse, csv, json, re, subprocess, sys
from pathlib import Path

COLUMNS = ['id', 'set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format',
           'question', 'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes']

# NOSB categories -> the subjects pts shows for Ocean Science Bowl.
SUBJECTS = [
    (r'^bio', 'Biology'), (r'^chem', 'Chemistry'), (r'^geol', 'Geology'),
    (r'^phys', 'Physical Oceanography'), (r'^tech', 'Technology'), (r'^geog', 'Geography'),
    (r'^(social|marine policy|policy|history|economics|literature)', 'Social Sciences'),
    (r'^theme', 'Theme'),
]


def subject(cat):
    c = (cat or '').strip().lower()
    for pat, name in SUBJECTS:
        if re.search(pat, c):
            return name
    return cat.strip().title() if cat else 'Uncategorized'


def text_of(path):
    p = Path(path)
    if p.suffix.lower() == '.pdf':
        return subprocess.run(['pdftotext', '-layout', str(p), '-'], capture_output=True, text=True, check=True).stdout
    return p.read_text(encoding='utf-8', errors='replace')


def clean(s):
    s = s.replace('­', '').replace('​', '').replace('ﬁ', 'fi').replace('ﬂ', 'fl')
    s = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', s)  # words broken across lines
    return re.sub(r'\s+', ' ', s).strip()


def detect(text):
    if re.search(r'^\s*Question Type:', text, re.M) or len(re.findall(r'^\s*Correct Answer\s*:', text, re.M)) > 5:
        return 'fields'
    if re.search(r'^\s*Toss-?Up\s+\d+\s*\(', text, re.M | re.I):
        return 'numbered'
    if '(*)' in text or re.search(r'\bFor (?:10|ten) points\b', text, re.I):
        return 'quizbowl'
    return 'fields'


def row(**kw):
    r = {c: '' for c in COLUMNS}
    r.update({k: v for k, v in kw.items() if v is not None})
    return r


def mc_answer(letter, opts):
    letter = letter.upper()
    text = opts.get(letter, '')
    return f'{letter}) {text}'.strip()


# ── "fields" layout ──────────────────────────────────────────────────────────
FIELD_RE = re.compile(r'^\W{0,3}(Question Type|Question Format|Category|Question Text|Question|Answer [WXYZ]|Correct Answer|'
                      r'Question #|Competition|Round|Pair)\s*[:;.]\s*(.*)$', re.I)


def read_fields(text, meta, problems):
    lines = [l.rstrip() for l in text.splitlines()]
    recs, cur, key, page = [], None, None, 0

    def start():
        nonlocal cur, key
        if cur:
            recs.append(cur)
        cur, key = {'fields': {}, 'page': page}, None

    for raw in lines:
        l = raw.strip()
        if l == '=====PAGE=====':  # page break in OCR output
            page += 1; key = None; continue
        # OCR slips on scanned pages: stray marks before a label, "Gorrect Answers X", "Answer Zz:"
        l = re.sub(r'^[\W_]+(?=[A-Za-z])', '', l)
        l = re.sub(r'(?i)^[GC][oa]?(?:rr|m|rn|n)ect\s+answers?\s*[:;.,]?\s*', 'Correct Answer: ', l)
        l = re.sub(r'(?i)^Answer\s+([WXYZ])[zZ]?\s*[:;.,]\s*', lambda m: f'Answer {m.group(1).upper()}: ', l)
        l = re.sub(r'\s+[|_]+(?=\s|$)', '', l)
        if not l:
            continue
        if re.fullmatch(r'(19|20)\d\d Buzzer Question', l):
            start(); cur['year'] = l[:4]; continue
        # older pages: "Toss-up" / "Bonus" alone on a line, then format and category
        bare = re.fullmatch(r'(Toss[\s-]*up|Bonus)\b(?:\s*\S{1,8}){0,3}', l, re.I) if not re.search(r'[a-z]{3,}\s+[a-z]{3,}', l[6:]) else None
        if bare and (cur is None or 'Question Type' in cur['fields'] or cur['fields'].get('Correct Answer') or cur.get('bare')):
            start(); cur['bare'] = True
            cur['fields']['Question Type'] = bare.group(1); key = None; continue
        if cur is not None and cur.get('bare') and not cur['fields'].get('Question') and key is None:
            fm = re.fullmatch(r'\W{0,3}(Multiple Choice|Short Answer)\b.*', l, re.I)
            if fm and 'Question Format' not in cur['fields']:
                cur['fields']['Question Format'] = fm.group(1); continue
            if 'Question Format' in cur['fields'] and 'Category' not in cur['fields'] and re.fullmatch(r'\W{0,3}[A-Za-z][A-Za-z ]{2,30}\W{0,3}', l):
                cur['fields']['Category'] = re.sub(r'[^A-Za-z ]', '', l).strip(); continue
        m = FIELD_RE.match(l)
        if m:
            k = m.group(1).title().replace('Question Text', 'Question').replace('Answer W', 'Answer W')
            k = {'Question Type': 'Question Type', 'Question Format': 'Question Format'}.get(k, k)
            if k == 'Question Type' and cur is not None and 'Question Type' in cur['fields'] and not cur.get('year'):
                start()
            if cur is None:
                start()
            key = k
            cur['fields'][key] = m.group(2).strip()
            continue
        if re.fullmatch(r'page \d+', l, re.I):
            key = None; continue
        if cur is not None and key:
            cur['fields'][key] = (cur['fields'][key] + '\n' + l).strip()
    if cur:
        recs.append(cur)

    rows, pair_no = [], {}
    for rec in recs:
        f = {k.title(): v for k, v in rec['fields'].items()}
        q = clean(f.get('Question', ''))
        typ = 'BONUS' if f.get('Question Type', '').lower().startswith('b') else 'TOSS-UP'
        opts = {L: clean(f.get(f'Answer {L}', '')) for L in 'WXYZ'}
        is_mc = 'mult' in f.get('Question Format', '').lower() or any(opts.values())
        ans = clean(f.get('Correct Answer', ''))
        if not q:
            continue
        if not ans and 'short' in f.get('Question Format', '').lower() and opts['W'] and not any(opts[L] for L in 'XYZ'):
            ans, opts = opts['W'], {L: '' for L in 'WXYZ'}  # older short-answer pages print it as "Answer W:"
        if 'short' in f.get('Question Format', '').lower():
            opts = {L: '' for L in 'WXYZ'}
        if not ans:
            problems.append(f'{typ} "{q[:50]}": no correct answer'); continue
        if is_mc:
            # the letter, maybe with OCR noise after it ("Yo", "X00"); Z is often read as 2 or 7
            mm = re.match(r'^\(?([WXYZ]|2|7)(?:\b|(?=[a-z0-9]{1,3}\b))', ans)
            if mm and mm.group(1) in '27':
                mm = re.match(r'(Z)', 'Z')
            if not mm or not all(opts.values()):
                problems.append(f'{typ} "{q[:50]}": MC answer/options unreadable ({ans[:20]})'); continue
            answer = mc_answer(mm.group(1), opts)
        else:
            answer = ans
        rnd = clean(f.get('Round', ''))
        rnd = re.sub(r'^Round\s+0*(\d+)$', r'Round \1', rnd) or meta.get('round', '')
        num = re.sub(r'\D', '', f.get('Pair', ''))
        if not num and '=====PAGE=====' in text:  # scanned older sets: one toss-up/bonus pair per page
            first = min(r['page'] for r in recs if r['fields'].get('Question'))
            num = str(rec['page'] - first + 1)
        elif not num:  # otherwise pairs in order
            pair_no.setdefault('n', 0)
            if typ == 'TOSS-UP' or not pair_no.get('had_tossup'):
                pair_no['n'] += 1
            pair_no['had_tossup'] = typ == 'TOSS-UP'
            num = str(pair_no['n'])
        accept, notes, reject = '', '', ''
        if not is_mc:
            answer, accept, notes, reject = split_sa_answer(answer)
        cat = f.get('Category', '')
        if ' - ' in cat:
            notes = '; '.join(x for x in [notes, 'topic: ' + cat.split(' - ', 1)[1].strip()] if x)
        rows.append(row(set=meta['set'], year=rec.get('year') or meta.get('year', ''), level='HS', round=rnd,
                        num=num, type=typ, subject=subject(cat.split(' - ')[0]),
                        format='Multiple Choice' if is_mc else 'Short Answer', question=q,
                        w=opts['W'] if is_mc else '', x=opts['X'] if is_mc else '',
                        y=opts['Y'] if is_mc else '', z=opts['Z'] if is_mc else '',
                        answer=answer, accept=accept, reject=reject, notes=notes))
    return rows


def split_sa_answer(ans):
    """'Molting (ecdysis)' stays as printed (the checker treats parentheses as optional);
    '(also accept: X)' / '(Accept: X OR Y)' notes go to the accept list (via packet_reader's
    answer parser); 'NOAA Fisheries (National Marine Fisheries Service, NMFS)' gets the
    bracketed names as alternates. Returns (answer, accept, notes, reject)."""
    if re.search(r'(?i)\b(accept|do not accept|reject)\b', ans):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from packet_reader import parse_answer
        a, acc, rej, notes = parse_answer(ans)
        acc = [re.sub(r'(?i)^or\s+', '', x) for x in acc if re.search(r'[A-Za-z0-9]', x)]
        return a, '; '.join(acc), '; '.join(notes), '; '.join(rej)
    accept = []
    m = re.match(r'^(.*?)\s*\(([^()]*)\)\s*$', ans)
    if m and (',' in m.group(2) or re.search(r'\b(accept|also)\b', m.group(2), re.I)):
        body = re.sub(r'^\s*(?:also\s+)?accept\s*:?\s*', '', m.group(2), flags=re.I)
        accept = [a.strip() for a in re.split(r',|;|\bor\b', body) if a.strip()]
        ans = m.group(1).strip()
    return ans, '; '.join(accept), '', ''


# ── "numbered" layout ────────────────────────────────────────────────────────
NUM_HEAD = re.compile(r'^\s*(Toss-?Up|Bonus)\s+(\d+)\s*\(([^)]+)\)\s*:\s*(.*)$', re.I)


def read_numbered(text, meta, problems):
    rows, rnd, cur = [], meta.get('round', ''), None
    blocks = []
    for raw in text.splitlines():
        l = raw.strip()
        if not l:
            continue
        mr = re.fullmatch(r'Round\s+(\d+)', l, re.I)
        if mr:
            rnd = f'Round {mr.group(1)}'; continue
        m = NUM_HEAD.match(l)
        if m:
            cur = {'type': 'BONUS' if m.group(1).lower().startswith('b') else 'TOSS-UP', 'num': m.group(2),
                   'cat': m.group(3), 'q': [m.group(4)], 'opts': {}, 'ans': None, 'round': rnd, 'part': 'q'}
            blocks.append(cur); continue
        if cur is None:
            continue
        mo = re.match(r'^([WXYZ])\s*[:)]\s*(.*)$', l)
        ma = re.match(r'^Answers?\s*:\s*(.*)$', l, re.I)
        if ma:
            cur['ans'] = ma.group(1); cur['part'] = 'ans'
        elif mo and cur['part'] in ('q', 'opts'):
            cur['opts'][mo.group(1)] = mo.group(2); cur['part'] = 'opts'; cur['last'] = mo.group(1)
        elif cur['part'] == 'q':
            cur['q'].append(l)
        elif cur['part'] == 'opts':
            cur['opts'][cur['last']] += ' ' + l
        elif cur['part'] == 'ans':
            cur['ans'] += ' ' + l
    for b in blocks:
        q, ans = clean(' '.join(b['q'])), clean(b['ans'] or '')
        if not ans:
            problems.append(f"{b['round']} {b['type']} {b['num']}: no answer"); continue
        opts = {L: clean(b['opts'].get(L, '')) for L in 'WXYZ'}
        is_mc = all(opts.values())
        if is_mc:
            mm = re.match(r'^\(?([WXYZ])\b', ans)
            if not mm:
                problems.append(f"{b['round']} {b['type']} {b['num']}: MC answer {ans[:20]!r} has no letter"); continue
            answer, accept, notes, reject = mc_answer(mm.group(1), opts), '', '', ''
        else:
            answer, accept, notes, reject = split_sa_answer(ans)
        rows.append(row(set=meta['set'], year=meta.get('year', ''), level='HS', round=b['round'], num=b['num'],
                        type=b['type'], subject=subject(b['cat']), format='Multiple Choice' if is_mc else 'Short Answer',
                        question=q, w=opts['W'] if is_mc else '', x=opts['X'] if is_mc else '',
                        y=opts['Y'] if is_mc else '', z=opts['Z'] if is_mc else '',
                        answer=answer, accept=accept, reject=reject, notes='; '.join(x for x in [notes, meta.get('note', '')] if x)))
    return rows


# ── quizbowl layout ──────────────────────────────────────────────────────────
def qb_answer(raw):
    """'brown algae [or Phaeophyceae or Phaeophyta; prompt on kelps ...] <Biology>' ->
    (answer, accept, reject, notes, category)."""
    s = clean(raw)
    cat = ''
    m = re.search(r'<\s*([^<>]+?)\s*>\s*$', s)
    if m:
        cat, s = m.group(1), s[:m.start()].strip()
    notes = []
    accept, reject = [], []
    # bracketed directions; pronunciation guides ([rhymes with ...], [MOR-ee]) are dropped
    def directions(m):
        inner = m.group(1)
        if not re.search(r'\b(or|accept|prompt|reject|do not|don\'t|anti-prompt)\b', inner, re.I):
            return ' '  # a reading guide
        for part in re.split(r';', inner):
            p = part.strip()
            if not p:
                continue
            if re.match(r'(?i)(do not|don\'t|reject)', p):
                body = re.sub(r'(?i)^(?:do not|don\'t)\s+(?:accept\s+)?(?:or\s+prompt\s+on\s+)?|^reject\s+', '', p)
                reject.extend(_alts(body))
            elif re.match(r'(?i)(prompt|anti-prompt)', p):
                notes.append(p)
            else:
                body = re.sub(r'(?i)^(?:or|also accept|accept)\s+', '', p)
                accept.extend(_alts(body))
        return ' '
    s = re.sub(r'\[([^\[\]]*)\]', directions, s)
    # a worked solution after the answer: "20 meters per second (v = √(g * D) ...)"
    m = re.search(r'\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$', s)
    if m and (len(m.group(1)) > 25 or '=' in m.group(1)):
        notes.insert(0, 'solution: ' + m.group(1).strip())
        s = s[:m.start()]
    s = re.sub(r'\s+', ' ', s).strip().rstrip(';,.')
    # "exclusive economic zones or EEZs": the second name is an alternate
    main, *ors = re.split(r'\s+or\s+', s)
    accept = ors + accept
    return main.strip(), accept, reject, notes, cat


def _alts(body):
    body = re.sub(r'\s+(?:before|after|until)\s+[“"].*?[”"]', '', body)        # "accept X before 'kelps'"
    body = re.sub(r'\s+by asking.*$', '', body)
    body = re.sub(r'(?i)\bsubtypes such as\s+', '', body)
    out = []
    for a in re.split(r'\s+or\s+|,\s*', body):
        a = a.strip(' “”"\'.')
        a = re.sub(r'(?i)^(?:accept|or|prompt on)\s+', '', a)
        if a and not re.match(r'(?i)^(answers? indicating|any|equivalents?)\b', a):
            out.append(a)
    return out


def read_quizbowl(text, meta, problems):
    lines = [l.rstrip() for l in text.splitlines()]
    blocks, cur = [], None
    for raw in lines:
        l = raw.strip()
        m = re.match(r'^(\d{1,2})\.\s+(.*)$', l)
        if m and (cur is None or cur['answer']):
            body = m.group(2)
            bonus = body.startswith('[10]') or body.startswith('[')
            cur = {'num': m.group(1), 'type': 'BONUS' if bonus else 'TOSS-UP',
                   'q': [re.sub(r'^\[\d+\]\s*', '', body)], 'answer': [], 'part': 'q'}
            blocks.append(cur); continue
        if cur is None or not l:
            continue
        a = re.match(r'^ANSWER\s*:\s*(.*)$', l)
        if a:
            cur['answer'].append(a.group(1)); cur['part'] = 'a'; continue
        cur['answer' if cur['part'] == 'a' else 'q'].append(l)
    rows = []
    for b in blocks:
        q = clean(' '.join(b['q']))
        if not b['answer']:
            problems.append(f"#{b['num']} {b['type']}: no answer"); continue
        ans, acc, rej, notes, cat = qb_answer(' '.join(b['answer']))
        power = ''
        if '(*)' in q:
            power = 'power mark after: “' + q.split('(*)')[0].strip()[-40:] + '”'
            q = re.sub(r'\s*\(\*\)\s*', ' ', q)
        q = re.sub(r'\s+', ' ', q).strip()
        rows.append(row(set=meta['set'], year=meta.get('year', ''), level='HS', round=meta.get('round', 'Packet'),
                        num=b['num'], type=b['type'], subject=subject(cat), format='Short Answer',
                        question=q, answer=ans, accept='; '.join(acc), reject='; '.join(rej),
                        notes='; '.join(x for x in ['quizbowl format', power, *notes] if x)))
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('files', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--set', action='append', help='set name for each file, in order')
    ap.add_argument('--year', action='append')
    ap.add_argument('--layout', action='append')
    ap.add_argument('--note', action='append', help='note added to every row of the file')
    a = ap.parse_args(argv)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    report = []
    for i, f in enumerate(a.files):
        text = text_of(f)
        layout = (a.layout or [None] * len(a.files))[i] or detect(text)
        meta = {'set': (a.set or [None] * len(a.files))[i] or Path(f).stem,
                'year': (a.year or [''] * len(a.files))[i] or '',
                'note': (a.note or [''] * len(a.files))[i] or ''}
        problems = []
        rows = {'fields': read_fields, 'numbered': read_numbered, 'quizbowl': read_quizbowl}[layout](text, meta, problems)
        if meta['note'] and layout != 'numbered':
            for r in rows:
                r['notes'] = '; '.join(x for x in [r['notes'], meta['note']] if x)
        name = re.sub(r'[^A-Za-z0-9]+', '_', meta['set']).strip('_') + '.csv'
        with open(out / name, 'w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(fh, COLUMNS); w.writeheader(); w.writerows(rows)
        report.append({'file': str(f), 'layout': layout, 'set': meta['set'], 'csv': name, 'questions': len(rows),
                       'tossups': sum(r['type'] == 'TOSS-UP' for r in rows), 'problems': problems})
        print(f"{Path(f).name}: {layout}, {len(rows)} questions, {len(problems)} problems")
    (out / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
