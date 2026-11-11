#!/usr/bin/env python3
"""Build the review queue: questions in the packets that are NOT in the bank, with a
screenshot of each one cut from its packet. dev.html's Review tab shows the queue, lets the
owner fix a question and add it (importer/apply_review.py puts it in the bank).

    # every imported folder (the ones listed in importer/IMPORTED.md):
    python importer/review_queue.py --sb "C:/Users/tobyw/Documents/scibowl-packets" \\
                                    --osb "C:/Users/tobyw/Documents/NOSB packets"
    # just some folders (others already in the queue are kept):
    python importer/review_queue.py --sb ROOT --only "LOST3" --only "MIT*"
    # a folder or zip anywhere, read as one tournament:
    python importer/review_queue.py --comp sb PATH [PATH ...]

What goes in the queue (review/queue.json, screenshots in review/img/):
  - questions the reader skips: visual bonuses, image questions
  - questions the reader read that aren't in the bank: dropped during an import (an equation
    that was a picture, no ANSWER line, garbled text...) or never fixed up
  - for packets the reader only partly read: each ANSWER line no question was found for
A question counts as in the bank when its text (or text and answer) closely matches any bank
row of that competition, so repeats and hand-fixed questions don't show up.

Screenshots: PDFs are cropped from the page around the question; Word files are turned into
PDFs with LibreOffice first (soffice on PATH or in Program Files), else they get none.
Needs: pdfplumber, python-docx, Pillow (comes with pdfplumber).
"""
import argparse, collections, csv, datetime, difflib, fnmatch, hashlib, io, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import packet_reader as pr                        # noqa: E402
from clean_questions import apply as clean_start  # noqa: E402
from fix_latex import apply as fix_latex          # noqa: E402

BANKS = {'sb': ROOT / 'data' / 'questions.csv', 'osb': ROOT / 'data' / 'osb-questions.csv'}
FIELDS = ['set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format', 'question',
          'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes']
DPI = 110

REASONS = {   # code: label shown on the Review tab
    'visual': 'Visual bonus (needs the image)',
    'image': 'Image question',
    'picture-math': 'Equation or diagram was a picture',
    'no-answer': 'No ANSWER line found',
    'empty': 'Empty question text',
    'mc-options': 'Multiple choice without options',
    'letter': 'Answer letter and text disagree',
    'long-answer': 'Very long answer',
    'unread': "Reader couldn't read it",
    'dropped': 'Left out during import',
}
PICTURE_MATH_RE = re.compile(
    r'(?:equation|expression|formula|function|graph|reaction|structure|figure|diagram|matrix)\s*[.,:;?]'
    r'|\b(?:shown|pictured|depicted|below|above)\b|\b(?:given by|equal to|defined as)\s*[.,;?]|\s[.,]\s*[.,]', re.I)


# ── matching against the bank ────────────────────────────────────────────

def norm(t):
    t = re.sub(r'\\(?:text|frac|mathrm|sqrt|left|right|cdot|times)|[${}^_\\]', ' ', t or '')
    return re.sub(r'[^a-z0-9]', '', t.lower())


def words(t):
    t = re.sub(r'\\[a-z]+|[${}^_\\]', ' ', (t or '').lower())
    return {w for w in re.findall(r'[a-z0-9]{4,}', t)}


class Bank:
    """All rows of one bank, indexed by rare words so a reader row can be matched fuzzily."""
    def __init__(self, path):
        with open(path, encoding='utf-8', newline='') as f:
            self.rows = list(csv.DictReader(f))
        self.q = [norm(r['question'])[:400] for r in self.rows]
        self.a = [norm(r['answer'])[:60] for r in self.rows]
        self.exact = collections.defaultdict(list)
        for i, x in enumerate(self.q):
            self.exact[x].append(i)
        self.index = collections.defaultdict(list)
        for i, r in enumerate(self.rows):
            for w in words(r['question']):
                self.index[w].append(i)

    def find(self, row):
        """Index of the bank row this question is, or None."""
        q, a = norm(row['question'])[:400], norm(row['answer'])[:60]
        if not q:
            return None
        same = self.exact.get(q, [])
        if same:   # same text: the same question unless the answer is plainly different
            return next((i for i in same if not a or not self.a[i] or a[:12] == self.a[i][:12] or a in self.a[i] or self.a[i] in a), same[0] if len(q) >= 40 else None)
        if len(q) < 12:
            return None
        ws = sorted(words(row['question']), key=lambda w: len(self.index.get(w, ())))
        ws = [w for w in ws if w in self.index][:10]
        n_rows = len(self.rows)
        hits = collections.Counter()
        for w in ws:   # rare words count for more
            idf = __import__('math').log(n_rows / len(self.index[w]))
            for i in self.index[w]:
                hits[i] += idf
        best, bscore = None, 0
        for i, _ in hits.most_common(80):
            sm = difflib.SequenceMatcher(None, q, self.q[i], autojunk=False)
            if sm.quick_ratio() < 0.6:
                continue
            r = sm.ratio()
            if a and self.a[i] and (a in self.a[i] or self.a[i] in a):
                r += 0.1   # same answer: a looser match on the text is enough
            if r > bscore:
                best, bscore = i, r
        return best if bscore >= 0.78 else None


def tidy(row):
    """The question as merge_into_bank.py would store it (for matching and for the editor)."""
    r = dict(row)
    clean_start(r)
    fix_latex(r)
    return r


# ── IMPORTED.md: which folder became which set ───────────────────────────

def imported_folders():
    out = {}
    comp = None
    for line in (HERE / 'IMPORTED.md').read_text(encoding='utf-8').splitlines():
        if line.startswith('## '):
            comp = 'osb' if 'Ocean' in line else 'sb'
        m = re.match(r'^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$', line)
        if not m or m.group(1) in ('Folder or zip', 'Folder or file') or set(m.group(1)) <= set('-'):
            continue
        cell, sets = m.group(1).replace('`', ''), m.group(2)
        skip = bool(re.search(r'removed|not imported|not packets|nothing new|all repeats', sets, re.I))
        names = {n.strip() for n in cell.split(' / ')} | {re.sub(r'\s*\(.*$', '', n).strip() for n in cell.split(' / ')}
        set_names = [re.sub(r'\s*\((?:MS|first batch)\)|\*', '', s).strip() for s in re.split(r',\s*(?![^()]*\))', re.sub(r'\(rounds named.*?\)', '', sets))]
        for n in names:
            if not n:
                continue
            k = (comp, n.lower())
            if k in out:   # one name, several rows ("Packets (BASH)", "Packets (TJSBT 2025)"...): any of their sets
                out[k] = {'sets': out[k]['sets'] + [s for s in set_names if s], 'skip': out[k]['skip'] and skip}
            else:
                out[k] = {'sets': [s for s in set_names if s], 'skip': skip}
    return out


def entry_name(p):
    """Folder or zip name without .zip and Google Drive's download suffix (-20261101T062603Z-1-001)."""
    n = re.sub(r'\.zip$', '', Path(p).name, flags=re.I)
    return re.sub(r'\s*-\d{8}T\d{6}Z-\d+-\d+$', '', n).strip()


def lookup(known, comp, name):
    """IMPORTED.md row for a folder: exact name, else a listed name it starts with
    ("ICSBT1 Packets [PUBLIC RELEASE]" for the row "ICSBT1 / ICSBT2 / ICSBT3 Packets ...")."""
    n = name.lower()
    if (comp, n) in known:
        return known[(comp, n)]
    hits = [k for (c, k) in known if c == comp and len(k) >= 4 and n.startswith(k + ' ')]
    return known[(comp, max(hits, key=len))] if hits else None


# ── finding a question on the page ───────────────────────────────────────

HEADERISH = re.compile(r'^\s*(?:(?:VISUAL\s+)?BONUS|TOSS[\s-]*UP|Toss[\s-]*up|Bonus)\b|^\s*\d{1,2}\s*[).]')
ANSWERISH = re.compile(r'^\s*(?:Correct\s+)?(?:ANSWER|ANS|Answer)\s*[:.;]')
OSB_SKIP = re.compile(r'written test|answer key|team challenge|\bTCQ\b', re.I)   # not buzzer questions


class Doc:
    """Words of a PDF with positions, as one searchable string of normalized text."""
    def __init__(self, pdf_bytes):
        import pdfplumber
        self.pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
        self.words, self.lines = [], []     # lines: (page, top, bottom, text, first word index)
        self.s, self.pos = '', []           # normalized text; pos[i] = index of the word char i is in
        self.box = []                       # per page (x0, x1) of the text and pictures
        for pi, page in enumerate(self.pdf.pages):
            ws = page.extract_words(keep_blank_chars=False, use_text_flow=False)
            xs = [(w['x0'], w['x1']) for w in ws] + [(im['x0'], im['x1']) for im in page.images]
            self.box.append((max(0, min(x for x, _ in xs) - 14), min(page.width, max(x for _, x in xs) + 14)) if xs else (0, page.width))
            ws.sort(key=lambda w: (round(w['bottom']), w['x0']))
            cur = None
            for w in ws:
                w['page'] = pi
                if cur is None or abs(w['bottom'] - cur[2]) > 3:
                    cur = [pi, w['top'], w['bottom'], w['text'], len(self.words)]
                    self.lines.append(cur)
                else:
                    cur[1] = min(cur[1], w['top']); cur[3] += ' ' + w['text']
                w['line'] = len(self.lines) - 1
                n = norm(w['text'])
                self.pos += [len(self.words)] * len(n)
                self.s += n
                self.words.append(w)

    def find(self, text, start_word=0):
        """Word index where text starts (searching from start_word), or None."""
        n = norm(text)
        if not n:
            return None
        lo = next((i for i, p in enumerate(self.pos) if p >= start_word), len(self.s)) if start_word else 0
        for a, b in ((0, 50), (0, 28), (12, 40), (30, 58)):
            needle = n[a:b]
            if len(needle) < 14:
                continue
            for frm in (lo, 0):
                i = self.s.find(needle, frm)
                if i >= 0:
                    return self.pos[max(0, i - a)] if a == 0 else self._back(self.pos[i], n[:a])
        return None

    def _back(self, wi, prefix):
        """Step back from word wi over the words that make up prefix."""
        k = len(prefix)
        while wi > 0 and k > 0:
            wi -= 1
            k -= len(norm(self.words[wi]['text']))
        return wi

    def answer_after(self, wi, limit=400):
        for j in range(wi, min(len(self.words), wi + limit)):
            if j > wi and ANSWERISH.match(self.lines[self.words[j]['line']][3]) and self.words[j]['x0'] - self.box[self.words[j]['page']][0] < 60:
                return self.words[j]['line']
        return None

    def region(self, first_line, answer_line):
        """[(page, top, bottom)] from the question's header to the end of its answer."""
        L = self.lines
        a = first_line
        for _ in range(2):   # "TOSS-UP" / "VISUAL BONUS" printed on the line(s) above
            p = a - 1
            if p >= 0 and L[p][0] == L[a][0] and L[a][1] - L[p][2] < 30 and HEADERISH.match(L[p][3]) and not ANSWERISH.match(L[p][3]):
                a = p
            else:
                break
        b = answer_line
        h = max(L[b][2] - L[b][1], 8)
        for _ in range(4):   # an answer that runs on, until the next question
            n = b + 1
            if n < len(L) and L[n][0] == L[b][0] and L[n][1] - L[b][2] < 1.2 * h and not HEADERISH.match(L[n][3]) and not ANSWERISH.match(L[n][3]):
                b = n
            else:
                break
        pa, pb = L[a][0], L[b][0]
        prev = [l[2] for l in L[:a] if l[0] == pa]
        pad = min(6, max(1, (L[a][1] - prev[-1]) / 2)) if prev else 6   # don't show the line above
        if pa == pb:
            return [(pa, L[a][1] - pad, L[b][2] + 6)]
        out = []
        for p in range(pa, min(pb, pa + 2) + 1):
            ls = [l for l in L if l[0] == p]
            top = L[a][1] - pad if p == pa else min(l[1] for l in ls) - 6
            bot = L[b][2] + 6 if p == pb else max(l[2] for l in ls) + 6
            out.append((p, top, bot))
        return out

    def text(self, region):
        return '\n'.join(l[3] for l in self.lines if any(l[0] == p and t - 1 <= l[1] and l[2] <= b + 1 for p, t, b in region))

    def image(self, region, path):
        from PIL import Image
        parts = []
        for p, top, bot in region:
            page = self.pdf.pages[p]
            x0, x1 = self.box[p]
            top, bot = max(0, top), min(page.height, bot)
            if bot - top < 4:
                continue
            parts.append(page.crop((x0, top, x1, bot)).to_image(resolution=DPI).original.convert('RGB'))
        if not parts:
            return False
        w = max(i.width for i in parts)
        gap = 10 if len(parts) > 1 else 0
        im = Image.new('RGB', (w, sum(i.height for i in parts) + gap * (len(parts) - 1)), 'white')
        y = 0
        for i in parts:
            im.paste(i, (0, y)); y += i.height + gap
        px = im.resize((64, max(1, im.height * 64 // w))).tobytes()
        if all(abs(px[i] - px[i + 1]) < 12 and abs(px[i + 1] - px[i + 2]) < 12 for i in range(0, len(px), 3)):
            im = im.convert('L')   # no colour: smaller file
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, 'WEBP', quality=72, method=6)
        return True


def soffice():
    for c in (shutil.which('soffice'), shutil.which('libreoffice'),
              r'C:\Program Files\LibreOffice\program\soffice.exe', r'C:\Program Files (x86)\LibreOffice\program\soffice.exe',
              '/Applications/LibreOffice.app/Contents/MacOS/soffice'):
        if c and Path(c).exists():
            return c
    return None


def to_pdf(name, data):
    """PDF bytes for a packet file, or None if there's no way to render it."""
    ext = Path(name).suffix.lower()
    if ext == '.pdf':
        return data
    if ext == '.docx' and soffice():
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / ('packet' + ext)
            src.write_bytes(data)
            subprocess.run([soffice(), '--headless', '--convert-to', 'pdf', '--outdir', d, str(src)],
                           capture_output=True, timeout=180)
            out = Path(d) / 'packet.pdf'
            return out.read_bytes() if out.exists() else None
    return None


# ── building the queue ───────────────────────────────────────────────────

def reason_for(row, problems):
    if row.get('skip_reason'):
        return 'visual' if 'visual' in row['skip_reason'] else 'image'
    text = ' '.join(problems)
    if not (row.get('question') or '').strip():
        return 'empty'
    if not (row.get('answer') or '').strip() or 'no ANSWER line' in text:
        return 'no-answer'
    if PICTURE_MATH_RE.search(row['question']):
        return 'picture-math'
    if 'no W/X/Y/Z options' in text:
        return 'mc-options'
    if 'answer letter' in text or 'matches no option' in text:
        return 'letter'
    if 'very long answer' in text:
        return 'long-answer'
    return 'dropped'


def rid_for(comp, folder, file, kind, row):
    k = f"{comp}|{folder}|{file}|{kind}|{row.get('round')}|{row.get('num')}|{row.get('type')}|{norm(row.get('question'))[:60]}"
    return hashlib.sha1(k.encode()).hexdigest()[:10]


def read_osb(path):
    """Ocean Science Bowl: PDFs with a text layer through osb_reader.py (its layouts are different
    from Science Bowl packets). Word files and scans were imported by hand and are not re-read."""
    import osb_reader as osb
    t = {'rows': [], 'skipped_rows': [], 'packets': []}
    for name, data in pr.iter_container(path):
        if Path(name).suffix.lower() != '.pdf' or OSB_SKIP.search(name):
            continue
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(data)
        try:
            text = osb.text_of(f.name)
        finally:
            os.unlink(f.name)
        if len(text.split()) < 50:
            continue   # a scan: imported by hand (OCR) or skipped on purpose
        problems = []
        meta = {'set': Path(name).stem, 'year': '', 'note': ''}
        rows = {'fields': osb.read_fields, 'numbered': osb.read_numbered, 'quizbowl': osb.read_quizbowl}[osb.detect(text)](text, meta, problems)
        for r in rows:
            r['file'] = name
            r.setdefault('level', 'HS')
        t['rows'] += rows
        t['packets'].append({'file': name, 'status': 'ok with warnings' if problems else 'ok', 'problems': problems})
    return t


def process(path, comp, bank, info, img_dir, images=True, log=print):
    folder = entry_name(path)
    t = read_osb(path) if comp == 'osb' else pr.read_tournament(path, keep_skipped=True)
    files = {name: data for name, data in pr.iter_container(path)}
    probs = collections.defaultdict(list)   # "round #num TYPE" -> problems
    for pk in t['packets']:
        for p in pk['problems']:
            m = re.match(r'^(.+? #\d+ \S+): (.*)$', p)
            if m:
                probs[(pk['file'], m.group(1))].append(m.group(2))

    # Which bank set/round each file's questions went to, from the ones that are in the bank.
    placed = collections.defaultdict(collections.Counter)
    own = set((info or {}).get('sets') or [])   # the sets this folder became (IMPORTED.md)
    candidates = []
    for r in t['rows']:
        tr = tidy(r)
        i = bank.find(tr)
        if i is None:
            candidates.append(('row', r))
        else:
            b = bank.rows[i]
            if not own or b['set'] in own:   # a repeat filed under another tournament says nothing
                placed[r['file']][(b['set'], b['year'], b['level'], b['round'])] += 1
    candidates += [('skipped', r) for r in t['skipped_rows'] if bank.find(tidy(r)) is None]
    by_folder = collections.Counter()
    for c in placed.values():
        by_folder.update({k[:3]: n for k, n in c.items()})

    def place(r):
        if placed.get(r['file']):
            s, y, lv, rnd = placed[r['file']].most_common(1)[0][0]
            return {'set': s, 'year': y, 'level': lv, 'round': rnd}
        if by_folder:
            s, y, lv = by_folder.most_common(1)[0][0]
            return {'set': s, 'year': y, 'level': lv, 'round': r['round']}
        sets = (info or {}).get('sets') or []
        return {'set': sets[0] if sets else r['set'], 'year': r['year'], 'level': r['level'], 'round': r['round']}

    # Locate every question of each file in its PDF (also the ones in the bank, so the
    # ANSWER lines nothing claims can be found in partly read packets).
    docs, items = {}, []
    order = collections.defaultdict(list)
    for r in t['rows']:
        order[r['file']].append(('row', r))
    for r in t['skipped_rows']:
        order[r['file']].append(('skipped', r))
    want = {id(r) for _, r in candidates}
    located = {}
    for file, rs in order.items():
        if images and not any(id(r) in want for _, r in rs) and not any(pk['file'] == file and pk['status'] == 'partial' for pk in t['packets']):
            continue
        pdf = to_pdf(file, files[file]) if images else None
        if not pdf:
            continue
        try:
            doc = Doc(pdf)
        except Exception as e:   # noqa: BLE001
            log(f'  {file}: no screenshot ({type(e).__name__}: {e})'); continue
        docs[file] = doc
        cursor = 0
        nvis = 0
        vis_lines = [l for l in doc.lines if re.search(r'\bVISUAL\b', l[3], re.I)]
        for kind, r in rs:   # read questions in packet order, then skipped ones
            wi = None
            q = r.get('question') or ''
            if len(norm(q)) >= 14:
                wi = doc.find(q, cursor)
            if wi is None and kind == 'skipped' and nvis < len(vis_lines):
                wi = vis_lines[nvis][4]
            if kind == 'skipped':
                nvis += 1
            if wi is None:
                continue
            al = doc.answer_after(wi)
            if al is None:
                continue
            located[id(r)] = (file, doc.region(doc.words[wi]['line'], al), al)
            cursor = wi

    def item(kind, r, reason, region_info, problems):
        tr = tidy(r) if kind != 'unread' else dict(r)
        pl = place(r)
        row = {f: str(tr.get(f, '') if tr.get(f) is not None else '') for f in FIELDS}
        row.update({k: str(v) for k, v in pl.items()})
        if kind == 'skipped' and row['type'] == 'VISUAL':
            row['type'] = 'BONUS'
        rid = rid_for(comp, folder, r.get('file', ''), kind, r)
        it = {'rid': rid, 'comp': comp, 'reason': reason, 'problems': problems,
              'source': {'folder': folder, 'file': r.get('file', ''), 'round': r.get('round', ''), 'num': r.get('num', ''),
                         'type': r.get('type', '')},
              'row': row, 'img': None, 'text': ''}
        if region_info:
            file, region, _ = region_info
            doc = docs[file]
            it['source']['pages'] = sorted({p + 1 for p, _, _ in region})
            it['text'] = doc.text(region)
            if doc.image(region, img_dir / f'{rid}.webp'):
                it['img'] = f'img/{rid}.webp'
        return it

    for kind, r in candidates:
        problems = probs.get((r['file'], f"{r['round']} #{r['num']} {r['type']}"), []) + r.get('problems', [])
        it = item(kind, r, reason_for(r, problems), located.get(id(r)), problems)
        if it['img'] or it['row']['question'].strip() or it['row']['answer'].strip():   # else nothing to go on
            items.append(it)

    # ANSWER lines no question was found for, in partly read packets.
    for pk in t['packets']:
        doc = docs.get(pk['file'])
        if pk['status'] != 'partial' or not doc:
            continue
        claimed = {v[2] for v in located.values() if v[0] == pk['file']}
        ends = sorted(claimed)
        for li, l in enumerate(doc.lines):
            if li in claimed or not ANSWERISH.match(l[3]):
                continue
            prev = max([e for e in ends if e < li] + [a for a, L in enumerate(doc.lines[:li]) if ANSWERISH.match(L[3])] + [-1])
            first = max(prev + 1, li - 30)
            while first < li and not HEADERISH.match(doc.lines[first][3]):
                first += 1   # start at the first header-like line after the previous answer
            if first == li:
                first = max(prev + 1, li - 8)
            region = doc.region(first, li)
            text = doc.text(region)
            body = [x for x in text.splitlines() if not ANSWERISH.match(x)]
            while body and re.fullmatch(r'\s*(?:VISUAL\s+)?(?:BONUS|TOSS[\s-]*UP)\S*\s*\d*\s*', body[0], re.I):
                body.pop(0)   # a header on its own line
            if body:
                body[0] = re.sub(r'^\s*\d{1,2}\s*[).:]?\s+', '', body[0])
            ans = ANSWERISH.sub('', next((x for x in text.splitlines() if ANSWERISH.match(x)), '')).strip()
            r = {'file': pk['file'], 'round': pr.round_label(pk['file']), 'num': '', 'type': 'TOSS-UP',
                 'question': '\n'.join(body), 'answer': ans, 'subject': '', 'format': 'Short Answer'}
            items.append(item('unread', r, 'unread', (pk['file'], region, li), ['the reader found no question for this ANSWER line']))

    packets = [{'comp': comp, 'folder': folder, 'file': pk['file'], 'status': pk['status'], 'problems': pk['problems'][:6]}
               for pk in t['packets'] if pk['status'] in ('failed', 'partial')]
    for d in docs.values():
        d.pdf.close()
    return items, packets


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('paths', nargs='*', help='folders or zips to read, each one tournament (with --comp)')
    ap.add_argument('--sb', help='Science Bowl packet folder: reads every entry IMPORTED.md lists')
    ap.add_argument('--osb', help='Ocean Science Bowl packet folder (same)')
    ap.add_argument('--comp', choices=['sb', 'osb'], default='sb', help='competition of the PATHs')
    ap.add_argument('--only', action='append', default=[], help='only entries whose name matches (glob, repeatable)')
    ap.add_argument('--all', action='store_true', help='also read entries IMPORTED.md does not list or marks as skipped')
    ap.add_argument('--out', default=str(ROOT / 'review'))
    ap.add_argument('--no-images', action='store_true')
    ap.add_argument('--bank', action='append', default=[], metavar='COMP=CSV', help='use another bank file (testing)')
    ap.add_argument('--fresh', action='store_true', help='start a new queue instead of keeping other folders\' items')
    a = ap.parse_args(argv)

    out = Path(a.out)
    img_dir = out / 'img'
    known = imported_folders()
    jobs, ignored = [], []
    for comp, root in (('sb', a.sb), ('osb', a.osb)):
        if not root:
            continue
        for p in sorted(Path(root).iterdir(), key=lambda p: p.name.lower()):
            name = entry_name(p)
            if p.name.startswith('.') or (p.is_file() and p.suffix.lower() not in ('.zip', '.pdf', '.docx', '.txt', '.ibp')):
                continue
            if a.only and not any(fnmatch.fnmatch(name.lower(), g.lower()) for g in a.only):
                continue
            info = lookup(known, comp, name) or lookup(known, comp, p.name)
            if comp == 'osb' and info is None:
                info = {'sets': [], 'skip': False}   # the OSB table describes folders loosely
            if not a.all and (info is None or info['skip']):
                ignored.append(f'{comp}: {p.name}' + (' (IMPORTED.md: not imported)' if info else ' (not in IMPORTED.md)'))
                continue
            jobs.append((p, comp, info))
    given = {entry_name(p) for p in a.paths}
    ignored = [s for s in ignored if not any(s.startswith(f'sb: {g}') or s.startswith(f'osb: {g}') or g in s for g in given)]
    for p in a.paths:
        jobs.append((Path(p), a.comp, lookup(known, a.comp, entry_name(p))))
    if not jobs:
        ap.error('nothing to read: give --sb/--osb folders or paths')

    for b in a.bank:
        c, f = b.split('=', 1); BANKS[c] = Path(f)
    banks = {}
    old = {}
    qfile = out / 'queue.json'
    if qfile.exists() and not a.fresh:
        old = json.loads(qfile.read_text(encoding='utf-8'))
    done_folders = {(c, entry_name(p)) for p, c, _ in jobs}
    items = [it for it in old.get('items', []) if (it['comp'], it['source']['folder']) not in done_folders]
    packets = [pk for pk in old.get('packets', []) if (pk['comp'], pk['folder']) not in done_folders]
    for p, comp, info in jobs:
        if comp not in banks:
            print(f'loading {BANKS[comp].name} ...'); banks[comp] = Bank(BANKS[comp])
        print(f'{comp}: {p.name}')
        try:
            its, pks = process(p, comp, banks[comp], info, img_dir, images=not a.no_images)
        except Exception as e:   # noqa: BLE001
            print(f'  FAILED: {type(e).__name__}: {e}'); continue
        counts = collections.Counter(i['reason'] for i in its)
        print('  ' + (', '.join(f'{n} {k}' for k, n in counts.most_common()) or 'nothing left out')
              + f"  ({sum(1 for i in its if i['img'])} screenshots)")
        items += its
        packets += pks

    # The same question from two folders (shared rounds): keep one.
    seen, uniq = set(), []
    for it in items:
        k = (it['comp'], norm(it['row']['question'])[:200], norm(it['row']['answer'])[:60])
        if k in seen and k[1]:
            continue
        seen.add(k); uniq.append(it)
    keep = {it['img'] for it in uniq if it['img']}
    if img_dir.exists():
        for f in img_dir.iterdir():
            if f'img/{f.name}' not in keep:
                f.unlink()
    uniq.sort(key=lambda it: (it['comp'], it['row']['set'], pr.natural_key(it['row']['round']), pr.natural_key(str(it['row']['num'])), it['row']['type']))
    out.mkdir(parents=True, exist_ok=True)
    q = {'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
         'reasons': REASONS, 'items': uniq, 'packets': packets}
    qfile.write_text(json.dumps(q, ensure_ascii=False, indent=0), encoding='utf-8')
    size = sum(f.stat().st_size for f in img_dir.iterdir()) if img_dir.exists() else 0
    print(f'\n{len(uniq)} questions in {qfile} ({len(keep)} screenshots, {size / 1e6:.1f} MB)')
    for s in ignored:
        print('  not read: ' + s)


if __name__ == '__main__':
    main()
