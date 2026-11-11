#!/usr/bin/env python3
"""Visual bonuses: questions that come with a picture, and the picture for each one.

    # every imported folder (the ones importer/IMPORTED.md lists):
    python importer/visual_bonuses.py --sb "C:/Users/tobyw/Documents/scibowl-packets"
    # just some folders (other folders' questions already in the file are kept):
    python importer/visual_bonuses.py --sb ROOT --only "CLASH 2026" --only "MIT*"
    # a folder or zip anywhere, read as one tournament:
    python importer/visual_bonuses.py --comp sb PATH [PATH ...]

The packet reader leaves visual bonuses (and other questions that need a picture) out of the
bank. This finds each one's picture and writes the question to data/visual-bonuses.csv (the
bank's columns plus `image`) with the picture in data/visuals/<id>.webp. The site loads that
file next to the bank and shows the picture with the question when players have visual bonuses
turned on.

Where the picture comes from, in this order:
  1. a slide deck in the same folder (a .pptx whose name says visual / VB, e.g. "CLASH Visual
     Bonuses.pptx", "Round 12 VBs.pptx"). Slides are matched to questions by the labels on them
     or in their speaker notes ("Bonus 7 (Energy)", "DE8 Visual Bonus 2", "BSB Round 12: VB4
     Physics"): by question number when the numbers fit the packet, else by order within each
     subject, and with no labels at all by order. Each slide is drawn with LibreOffice, without
     its label and without repeated logo slides.
  2. the packet itself: pictures and drawings around the question (between the previous answer
     and the next question), cut from the page. Word files go through LibreOffice first.
Questions with no picture found (some public releases left them out) stay in the review queue
(review/queue.json); the ones found are taken out of it.

Also writes visual-report.html next to the output (--report), a page of every question with its
picture, to check the matches by eye.
Needs: pdfplumber, python-docx, python-pptx, Pillow, LibreOffice (soffice), node (for IDs).
"""
import argparse, collections, csv, hashlib, html, io, json, re, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import review_queue as rq   # noqa: E402

OUT_CSV = {'sb': ROOT / 'data' / 'visual-bonuses.csv', 'osb': ROOT / 'data' / 'osb-visual-bonuses.csv'}
IMG_DIR = ROOT / 'data' / 'visuals'
COLUMNS = ['id', 'set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format', 'question',
           'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes', 'subcategory', 'image']
MAX_W, MAX_H = 1400, 1400      # stored picture size limit (pixels)
DPI = 200                      # packet pictures are cut from the page at this resolution
SKIP_SUBJECTS = {'General Science'}   # hidden on the site anyway
MOVING = re.compile(r'\b(?:GIF|video|audio|animation|sound clip|recording)\b', re.I)   # a still picture won't do

HEAD = re.compile(r'^\s*(?:(?:VISUAL|VISHWAL|AUDITORY|AUDIO)\s+)?(?:BONUS|TOSS[\s-]*UP)\b|^\s*\d{1,2}\s*[).]', re.I)
ANS = rq.ANSWERISH
LEAD_IN = re.compile(r'^\s*(?:your\s+)?next\s+(?:bonus|toss-?up|question)\s+is\s+(?:a\s+)?visual(?:\s+(?:bonus|toss-?up))?\s*[.:!]?\s*', re.I)


# ── pictures in the packet ───────────────────────────────────────────────

def _key(im):
    return (round(im['x0'] / 4), round(im['top'] / 4), round((im['x1'] - im['x0']) / 4), round((im['bottom'] - im['top']) / 4))


def repeated_images(doc):
    """Images in the same place on several pages: logos in headers and footers, watermarks."""
    c = collections.Counter(_key(im) for page in doc.pdf.pages for im in page.images)
    n = len(doc.pdf.pages)
    return {k for k, v in c.items() if v >= 3 or (n >= 2 and v == n)}


def zones(doc, a, b):
    """Where the picture of the question whose text starts on line a and whose answer is on
    line b can be: before its text (after the previous answer), in its text, or after its answer
    (before the next question). {name: ((page, y), (page, y))}."""
    L = doc.lines
    prev = max([i for i in range(a) if ANS.match(L[i][3])] + [-1])
    if prev >= 0:
        pre_s = (L[prev][0], L[prev][2] + 1)
    else:   # first question: only from its header ("VISUAL BONUS") on
        hs = [i for i in range(a) if HEAD.match(L[i][3]) and L[i][0] >= L[a][0] - 1]
        pre_s = (L[hs[0]][0], L[hs[0]][1] - 2) if hs else (L[a][0], L[a][1] - 2)
    a_top = (L[a][0], L[a][1] - 2)
    b_bot = (L[b][0], L[b][2] + 1)
    nxt = next((i for i in range(b + 1, len(L)) if HEAD.match(L[i][3]) or ANS.match(L[i][3])), None)
    post_e = (L[nxt][0], L[nxt][1] - 1) if nxt is not None else (L[b][0] + 1, 1e9)
    if pre_s[0] < a_top[0] - 1:
        pre_s = (a_top[0] - 1, 0)

    def clip(s, e):   # at most two pages
        return (s, e if e[0] <= s[0] + 1 else (s[0] + 1, 1e9))
    return {'body': clip(a_top, b_bot), 'pre': clip(pre_s, a_top), 'post': clip(b_bot, post_e)}


def _text_lines(doc):
    """Boxes of the lines of question text (6+ words): (page, x0, top, x1, bottom)."""
    if not hasattr(doc, '_text_boxes'):
        by_line = collections.defaultdict(list)
        for w in doc.words:
            by_line[w['line']].append(w)
        doc._text_boxes = [(doc.lines[li][0], min(w['x0'] for w in ws), doc.lines[li][1], max(w['x1'] for w in ws), doc.lines[li][2])
                           for li, ws in by_line.items() if len(doc.lines[li][3].split()) >= 6]
    return doc._text_boxes


def _holds_text(doc, p, x0, top, x1, bottom, lines=2):
    """True when a box has lines of question text inside it: a frame, table cell or highlight
    around the question, or a background picture behind it, not a picture of its own."""
    n = 0
    for tp, a, t, b, bt in _text_lines(doc):
        if tp == p and a >= x0 - 4 and b <= x1 + 4 and top - 2 <= (t + bt) / 2 <= bottom + 2:
            n += 1
            if n >= lines:
                return True
    return False


def _highlights(doc, p, o):
    """True when a filled box sits behind a line of text (any length)."""
    for li, ln in enumerate(doc.lines):
        if ln[0] == p and o['top'] - 2 <= (ln[1] + ln[2]) / 2 <= o['bottom'] + 2:
            ws = [w for w in doc.words[ln[4]:ln[4] + 60] if w['line'] == li]
            if ws and min(w['x0'] for w in ws) >= o['x0'] - 4 and max(w['x1'] for w in ws) <= o['x1'] + 4:
                return True
    return False


def _objects(doc, s, e, rep):
    out = []
    for p in range(s[0], min(e[0], len(doc.pdf.pages) - 1) + 1):
        page = doc.pdf.pages[p]
        ytop = s[1] if p == s[0] else 0
        ybot = e[1] if p == e[0] else page.height
        for im in page.images:
            w, h = im['x1'] - im['x0'], im['bottom'] - im['top']
            if _key(im) not in rep and im['bottom'] > ytop + 2 and im['top'] < ybot - 2 and w > 12 and h > 12 \
                    and not _holds_text(doc, p, im['x0'], im['top'], im['x1'], im['bottom']):
                out.append((p, 'img', im['x0'], max(im['top'], ytop), im['x1'], min(im['bottom'], ybot)))
        for kind in ('rects', 'curves', 'lines'):
            for o in getattr(page, kind):
                if not (o['bottom'] > ytop and o['top'] < ybot):
                    continue
                w, h = o['x1'] - o['x0'], o['bottom'] - o['top']
                if (w > 0.85 * page.width and h > 0.5 * page.height) or (_is_rule((0, 0, 0, 0, w, h)) and max(w, h) > 0.6 * page.width):
                    continue   # page border, separator line, table border
                if _holds_text(doc, p, o['x0'], o['top'], o['x1'], o['bottom'], lines=1):
                    continue   # a box around the question
                if kind == 'rects' and o.get('fill') and not o.get('stroke') and h < 30 and _highlights(doc, p, o):
                    continue   # a highlighted line of text
                out.append((p, kind, o['x0'], max(o['top'], ytop), o['x1'], min(o['bottom'], ybot)))
    return out


def _is_rule(o):
    w, h = o[4] - o[2], o[5] - o[3]
    return (h < 2.5 and w > 30) or (w < 2.5 and h > 30) or (w < 2.5 and h < 2.5)


def _clusters(objs, gap=14):
    """Objects grouped by overlap of their boxes grown by gap."""
    objs, groups = list(objs), []
    while objs:
        g = [objs.pop()]
        box = list(g[0][2:6])
        grew = True
        while grew:
            grew = False
            for o in objs[:]:
                if o[2] <= box[2] + gap and o[4] >= box[0] - gap and o[3] <= box[3] + gap and o[5] >= box[1] - gap:
                    g.append(o); objs.remove(o); grew = True
                    box = [min(box[0], o[2]), min(box[1], o[3]), max(box[2], o[4]), max(box[3], o[5])]
        groups.append(g)
    return groups


def _boxes_in(doc, s, e, rep):
    by_page = collections.defaultdict(list)
    for o in _objects(doc, s, e, rep):
        by_page[o[0]].append(o)
    boxes = {}
    for p, objs in sorted(by_page.items()):
        for c in _clusters(objs):
            if not any(o[1] == 'img' for o in c) and ((all(_is_rule(o) for o in c) and len(c) < 8) or len(c) < 3):
                continue   # separator lines, underlines, a lone box
            x0, y0 = min(o[2] for o in c), min(o[3] for o in c)
            x1, y1 = max(o[4] for o in c), max(o[5] for o in c)
            if x1 - x0 < 30 or y1 - y0 < 30:
                continue
            m = boxes.get(p)   # several pictures on a page: one box around them all
            boxes[p] = (p, x0, y0, x1, y1) if not m else (p, min(m[1], x0), min(m[2], y0), max(m[3], x1), max(m[4], y1))
    return list(boxes.values())


def _grow_over_labels(doc, box, pad=28):
    """Grow a picture's box over nearby words that label it (axis titles, letters), but not over
    the question's own text: a line of 6+ words, a header or an ANSWER line."""
    p, x0, y0, x1, y1 = box
    by_line = collections.defaultdict(list)
    for w in doc.words:
        if w['page'] == p:
            by_line[w['line']].append(w)
    for _ in range(2):
        for li, ws in by_line.items():
            text = doc.lines[li][3]
            if HEAD.match(text) or ANS.match(text) or len(text.split()) >= 6:
                continue
            lx0, lx1 = min(v['x0'] for v in ws), max(v['x1'] for v in ws)
            if lx1 - lx0 > 0.6 * (x1 - x0) + 2 * pad and (lx0 < x0 - pad or lx1 > x1 + pad):
                continue
            for w in ws:
                cx, cy = (w['x0'] + w['x1']) / 2, (w['top'] + w['bottom']) / 2
                if x0 - pad <= cx <= x1 + pad and y0 - 4 <= cy <= y1 + pad:   # not upwards: that's the question
                    x0, y0, x1, y1 = min(x0, w['x0']), min(y0, w['top']), max(x1, w['x1']), max(y1, w['bottom'])
    return (p, x0, y0, x1, y1)


def packet_picture(doc, a, b, rep):
    """The picture for a question (PIL image) and which zone it came from, or (None, None)."""
    z = zones(doc, a, b)
    for k in ('body', 'pre', 'post'):
        (sp, sy), (ep, ey) = z[k]
        boxes = _boxes_in(doc, *z[k], rep)
        if boxes:
            parts = []
            for p, x0, y0, x1, y1 in (_grow_over_labels(doc, bx) for bx in boxes):
                page = doc.pdf.pages[p]
                lo = sy if p == sp else 0           # never past the zone: that's question text
                hi = ey if p == ep else page.height
                bb = (max(0, x0 - 2), max(0, y0 - 2, lo), min(page.width, x1 + 2), min(page.height, y1 + 2, hi))
                parts.append(page.crop(bb).to_image(resolution=DPI).original.convert('RGB'))
            return stack(parts), k
    return None, None


def stack(parts, gap=24):
    from PIL import Image
    parts = [p for p in parts if p is not None]
    if not parts:
        return None
    w = max(i.width for i in parts)
    im = Image.new('RGB', (w, sum(i.height for i in parts) + gap * (len(parts) - 1)), 'white')
    y = 0
    for i in parts:
        im.paste(i, ((w - i.width) // 2, y))
        y += i.height + gap
    return im


# ── slide decks ──────────────────────────────────────────────────────────

DECK_NAME = re.compile(r'visual|\bvbs?\b|\bimages?\b|\bpictures?\b', re.I)
SUBJECT_WORDS = [
    (r'earth\s*(?:&|and)\s*space|earth\s+science|\bess\b|\bastro', 'Earth and Space'),
    (r'\bbio(?:logy)?\b', 'Biology'), (r'\bchem(?:istry)?\b', 'Chemistry'), (r'\bphys(?:ics)?\b', 'Physics'),
    (r'\bmath(?:ematics|s)?\b', 'Mathematics'), (r'\benergy\b', 'Energy'),
    (r'\bduality\b|\btheme\b|general\s+science', 'General Science'),
]
ROUND_RE = re.compile(r'\b(?:(HS|MS)\s+)?(RR|DE|SE|Round|Finals?|Playoffs?|Prelims?|Seeding)\s*(\d+(?:\.\d+)?)?', re.I)
NUM_RE = re.compile(r'\b(?:VB|(?:visual\s+)?bonus)\s*#?\s*(\d{1,2})\b', re.I)


def subject_of(text):
    for pat, name in SUBJECT_WORDS:
        if re.search(pat, text, re.I):
            return name
    return None


def parse_label(text):
    """{'round', 'num', 'subject'} found in a slide's label text (any may be None)."""
    t = ' '.join(text.split())
    lab = {'round': None, 'num': None, 'subject': subject_of(t)}
    m = NUM_RE.search(t)
    if m:
        lab['num'] = int(m.group(1))
    for rm in ROUND_RE.finditer(NUM_RE.sub(' ', t)):   # "DE Round 10": the part with a number
        if rm.group(3) or re.match(r'finals?|seeding', rm.group(2), re.I):
            lab['round'] = ' '.join(x for x in rm.groups() if x)
            break
    return lab


def is_label_text(text):
    t = ' '.join(text.split())
    return bool(t) and len(t) <= 80 and bool(NUM_RE.search(t) or ROUND_RE.search(t) or re.search(r'visual\s+bonus', t, re.I))


def _shape_kind(sh):
    from pptx.enum.shapes import MSO_SHAPE_TYPE as T
    st = sh.shape_type
    if st == T.PICTURE or (st == T.PLACEHOLDER and sh.__class__.__name__ == 'PlaceholderPicture'):
        return 'picture'
    if st in (T.GROUP, T.CHART, T.TABLE, T.FREEFORM, T.LINE, T.MEDIA, T.EMBEDDED_OLE_OBJECT, T.LINKED_PICTURE, T.DIAGRAM) \
            or getattr(sh, 'has_chart', False) or getattr(sh, 'has_table', False):
        return 'drawing'
    if sh.has_text_frame and sh.text_frame.text.strip():
        return 'text'
    if st == T.AUTO_SHAPE:
        return 'drawing'   # arrows, circles... on a picture
    return 'empty'


def read_deck(name, data):
    """Entries of a deck: [{'slides': [i], 'round', 'num', 'subject', 'order'}], plus what to
    remove before drawing it: {slide index: [shape ids]} of labels and logos."""
    from pptx import Presentation
    prs = Presentation(io.BytesIO(data))
    slides = list(prs.slides)
    blob = lambda sh: hashlib.sha1(sh.image.blob).hexdigest()
    uses = collections.Counter()
    for s in slides:
        for sh in s.shapes:
            if _shape_kind(sh) == 'picture':
                try:
                    uses[blob(sh)] += 1
                except Exception:   # noqa: BLE001  (a linked picture)
                    pass
    # a logo between the questions: the same picture on many slides (a picture shown again on a
    # "favorites" slide at the end is not one)
    filler = {h for h, n in uses.items() if n >= 3 and n >= 0.2 * len(slides)}

    file_lab = parse_label(Path(name).stem)
    ctx = {'round': file_lab['round'], 'subject': None}
    entries, remove = [], collections.defaultdict(list)
    pending, prev_content = None, False
    for i, s in enumerate(slides):
        texts, content = [], False
        for sh in s.shapes:
            k = _shape_kind(sh)
            if k == 'picture':
                try:
                    is_filler = blob(sh) in filler
                except Exception:   # noqa: BLE001
                    is_filler = False
                if is_filler:
                    remove[i].append(sh.shape_id)
                else:
                    content = True
            elif k == 'drawing':
                content = True
            elif k == 'text':
                t = sh.text_frame.text
                if is_label_text(t) or (not content and len(' '.join(t.split())) <= 80 and sh.is_placeholder):
                    texts.append(t)
                    remove[i].append(sh.shape_id)
        notes = s.notes_slide.notes_text_frame.text if s.has_notes_slide and s.notes_slide.notes_text_frame else ''
        lab = parse_label(' '.join(texts))
        nlab = parse_label(notes) if notes.strip() and len(notes) < 200 else {'round': None, 'num': None, 'subject': None}
        for k2 in ('round', 'num', 'subject'):
            lab[k2] = lab[k2] or nlab[k2]
        if not content:
            prev_content = False
            if lab['num'] is not None:
                pending = lab          # "Bonus 7 (Energy)" on its own slide; the picture follows
            elif lab['round'] or lab['subject']:   # a section: "Round 10 Visual Bonuses", "Biology"
                if lab['round']:
                    ctx['round'] = lab['round']
                    if not lab['subject']:
                        ctx['subject'] = None
                if lab['subject']:
                    ctx['subject'] = lab['subject']
                if lab['round'] and lab['subject'] and pending is None:
                    pending = lab      # "MS Finals / Physics Bonus 5" without a number is still a label
            continue
        has_own = lab['num'] is not None or (lab['subject'] and lab['round'])
        use = lab if has_own else pending
        if use is None and prev_content and entries:
            entries[-1]['slides'].append(i)   # a second slide of the same picture
        else:
            use = use or {'round': None, 'num': None, 'subject': None}
            entries.append({'slides': [i], 'round': use.get('round') or ctx['round'], 'num': use.get('num'),
                            'subject': use.get('subject') or ctx['subject'], 'order': len(entries)})
        pending, prev_content = None, True
    return entries, dict(remove)


def _tokens(t):
    return re.findall(r'[a-z]+|\d+', (t or '').lower())


def _round_fit(round_text, q):
    """How well a deck's round name fits a question's packet file: 0..1."""
    rt = [t for t in _tokens(round_text) if t not in ('round', 'visual', 'bonuses', 'bonus')]
    if not rt:
        return 0
    ft = set(_tokens(q['file'] + ' ' + q['round']))
    if '1' not in ft and re.search(r'finals?$', q['round'], re.I):
        ft.add('1')   # a lone "Finals" packet
    digits = [t for t in rt if t.isdigit()]
    if digits and not all(d in ft for d in digits):
        return 0
    words = [t for t in rt if not t.isdigit()]
    return (sum(w.rstrip('s') in {x.rstrip('s') for x in ft} for w in words) + len(digits)) / len(rt)


def match_deck(entries, qs):
    """Pair deck entries with questions (dicts with file, round, num, subject, order).
    Returns {question index: entry}."""
    if not entries or not qs:
        return {}
    files = sorted({q['file'] for q in qs})
    merged = []   # sections: runs of entries with the same round name
    for e in entries:
        if merged and merged[-1]['round'] == e['round']:
            merged[-1]['entries'].append(e)
        else:
            merged.append({'round': e['round'], 'entries': [e]})
    by_file = collections.defaultdict(list)
    for qi, q in enumerate(qs):
        by_file[q['file']].append(qi)

    def compatible(e, q):
        return not e['subject'] or e['subject'] == q['subject']

    out, used = {}, set()
    for sec in merged:
        best, bscore = None, 0
        for f in files:
            fq = [qs[i] for i in by_file[f]]
            score = 50 * max((_round_fit(sec['round'], q) for q in fq[:1]), default=0)
            score += sum(10 for e in sec['entries'] if e['num'] is not None and any(q['num'] == e['num'] and compatible(e, q) for q in fq))
            score += sum(3 for e in sec['entries'] if e['subject'] and any(q['subject'] == e['subject'] for q in fq))
            if not any(e['round'] or e['num'] or e['subject'] for e in sec['entries']):
                score += 1 if len(files) == 1 else 0
            if score > bscore:
                best, bscore = f, score
        if best is None:
            continue
        cand = [i for i in by_file[best] if i not in used]
        es = sec['entries']
        numbered = [e for e in es if e['num'] is not None]
        fits = [e for e in numbered if any(qs[i]['num'] == e['num'] and compatible(e, qs[i]) for i in cand)]
        left = list(es)
        if numbered and len(fits) >= 0.6 * len(numbered):   # numbers are the packet's question numbers
            for e in fits:
                i = next((i for i in cand if qs[i]['num'] == e['num'] and compatible(e, qs[i]) and i not in used), None)
                if i is not None:
                    out[i] = e; used.add(i); left.remove(e)
        # by order within each subject, then whatever is left by order
        cand = sorted((i for i in by_file[best] if i not in used), key=lambda i: (qs[i]['num'] or 0, qs[i]['order']))
        for e in [e for e in left if e['subject']]:
            i = next((i for i in cand if qs[i]['subject'] == e['subject'] and i not in used), None)
            if i is not None:
                out[i] = e; used.add(i); left.remove(e)
        for e in [e for e in left if not e['subject']]:
            i = next((i for i in cand if i not in used), None)
            if i is not None:
                out[i] = e; used.add(i)
        for e in es:
            e['file'] = best
    # A slide left over (its label names the wrong round) goes to the round of the slides
    # around it, if that round has a question of its subject without a picture.
    taken = {id(e) for e in out.values()}
    for n, e in enumerate(entries):
        if id(e) in taken:
            continue
        near = [entries[m].get('file') for m in (n - 1, n + 1) if 0 <= m < len(entries) and id(entries[m]) in taken]
        for f in near:
            i = next((i for i in sorted(by_file.get(f, []), key=lambda i: qs[i]['num'] or 0)
                      if i not in used and compatible(e, qs[i])), None)
            if i is not None:
                out[i] = e; used.add(i); taken.add(id(e))
                break
    return out


def deck_pdf(data, remove):
    """The deck as a PDF (one page per slide, hidden ones too) without labels and logos."""
    from pptx import Presentation
    prs = Presentation(io.BytesIO(data))
    for i, s in enumerate(prs.slides):
        s._element.set('show', '1')
        for sh in list(s.shapes):
            if sh.shape_id in remove.get(i, ()):
                sh._element.getparent().remove(sh._element)
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / 'deck.pptx'
        prs.save(src)
        subprocess.run([rq.soffice(), '--headless', '--convert-to', 'pdf', '--outdir', d, str(src)],
                       capture_output=True, timeout=600)
        out = Path(d) / 'deck.pdf'
        return out.read_bytes() if out.exists() else None


def slide_image(pdf, i, width=1600):
    import pdfplumber
    page = pdf.pages[i]
    return trim(page.to_image(resolution=width / float(page.width) * 72).original.convert('RGB'))


def trim(im, pad=16):
    """Cut the plain background around a picture."""
    from PIL import ImageChops, Image
    bg = Image.new('RGB', im.size, im.getpixel((2, 2)))
    diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 24 else 0)
    box = diff.getbbox()
    if not box:
        return im
    x0, y0, x1, y1 = box
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


# ── one folder ───────────────────────────────────────────────────────────

def decks_in(files):
    return [(n, d) for n, d in files.items()
            if Path(n).suffix.lower() == '.pptx' and DECK_NAME.search(Path(n).stem) and not Path(n).name.startswith(('~$', '.'))]


def process(path, comp, bank, info, log=print):
    """[(queue item, PIL image, where it came from)] for the folder's questions that need a
    picture; image None when none was found."""
    keep = {}
    with tempfile.TemporaryDirectory() as tmp:
        items, _ = rq.process(path, comp, bank, info, Path(tmp), keep=keep)
    docs, files = keep.get('docs', {}), keep.get('files', {})
    vis = [it for it in items if it['reason'] in ('visual', 'image') and it['row']['subject'] not in SKIP_SUBJECTS
           and it['row']['question'].strip() and it['row']['answer'].strip()]
    found = {}
    # 1. decks
    qs = [{'file': it['source']['file'], 'round': str(it['source']['round']), 'subject': it['row']['subject'],
           'num': int(it['source']['num']) if str(it['source']['num']).isdigit() else None, 'order': k}
          for k, it in enumerate(vis)]
    for name, data in decks_in(files):
        entries, remove = read_deck(name, data)
        open_ = [k for k in range(len(qs)) if k not in found]
        pairs = {open_[i]: e for i, e in match_deck(entries, [qs[k] for k in open_]).items()}
        if not pairs:
            log(f'  {name}: {len(entries)} slides, none matched'); continue
        pdf_bytes = deck_pdf(data, remove)
        if not pdf_bytes:
            log(f'  {name}: LibreOffice could not draw it'); continue
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for k, e in pairs.items():
                if k in found or any(i >= len(pdf.pages) for i in e['slides']):
                    continue
                found[k] = (stack([slide_image(pdf, i) for i in e['slides']]),
                            f"{Path(name).name}, slide {', '.join(str(i + 1) for i in e['slides'])}")
        log(f'  {name}: {len(entries)} pictures, {len(pairs)} matched')
    # 2. the packet
    reps = {}
    for k, it in enumerate(vis):
        if k in found or not it.get('_loc'):
            continue
        f, a, b = it['_loc']
        doc = docs[f]
        if f not in reps:
            reps[f] = repeated_images(doc)
        im, zone = packet_picture(doc, a, b, reps[f])
        if im is not None:
            found[k] = (im, f'{Path(f).name}, {zone}')
    for d in docs.values():
        d.pdf.close()
    for k, it in enumerate(vis):
        if MOVING.search(it['row']['question']):
            found[k] = (None, 'needs a GIF, video or sound')
    return [(it, *(found.get(k) or (None, None))) for k, it in enumerate(vis)]


# ── output ───────────────────────────────────────────────────────────────

def save_image(im, path):
    from PIL import Image
    im = im.copy()
    im.thumbnail((MAX_W, MAX_H), Image.LANCZOS)
    px = im.resize((64, max(1, im.height * 64 // im.width))).tobytes()
    if all(abs(px[i] - px[i + 1]) < 10 and abs(px[i + 1] - px[i + 2]) < 10 for i in range(0, len(px), 3)):
        im = im.convert('L')   # no colour: smaller file
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, 'WEBP', quality=80, method=6)


def row_for(it):
    r = {c: it['row'].get(c, '') for c in COLUMNS}
    r['question'] = LEAD_IN.sub('', r['question']).strip()
    if r['type'] not in ('TOSS-UP', 'BONUS'):
        r['type'] = 'BONUS'
    r['id'] = ''
    return r


def read_csv(p):
    if not p.exists():
        return []
    with open(p, encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))


def write_csv(p, rows):
    with open(p, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, COLUMNS)
        w.writeheader()
        w.writerows(rows)


def assign_ids(path, rows):
    ids = subprocess.run(['node', str(HERE / 'ids.mjs'), str(path)], capture_output=True, text=True, check=True).stdout.split()
    assert len(ids) == len(rows), (len(ids), len(rows))
    used = {r['id'] for r in rows if r['id']}
    for r, d in zip(rows, ids):
        if not r['id']:
            nid, n = d, 1
            while nid in used:
                n += 1
                nid = f'{d}-{n}'
            r['id'] = nid
            used.add(nid)


def report(path, entries):
    """A page of every visual question and its picture, to check them by eye."""
    out = ['<!doctype html><meta charset="utf-8"><title>Visual bonuses</title><style>body{font:14px system-ui;margin:20px}'
           '.q{display:grid;grid-template-columns:420px 1fr;gap:16px;border-top:1px solid #ccc;padding:12px 0}'
           'img{max-width:420px;max-height:340px;border:1px solid #ddd}.miss{color:#b00}small{color:#666}</style>']
    for r, src, img in entries:
        pic = f'<img src="{html.escape(img)}" loading="lazy">' if img else '<p class="miss">no picture found</p>'
        out.append(f'<div class="q">{pic}<div><b>{html.escape(r["set"])} {html.escape(r["round"])} #{html.escape(str(r["num"]))}'
                   f' {html.escape(r["subject"])}</b> <small>{html.escape(src or "")}</small>'
                   f'<p>{html.escape(r["question"])}</p><p>ANSWER: {html.escape(r["answer"])}</p></div></div>')
    path.write_text('\n'.join(out), encoding='utf-8')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('paths', nargs='*', help='folders or zips to read, each one tournament (with --comp)')
    ap.add_argument('--sb', help='Science Bowl packet folder: reads every entry IMPORTED.md lists')
    ap.add_argument('--osb', help='Ocean Science Bowl packet folder (same)')
    ap.add_argument('--comp', choices=['sb', 'osb'], default='sb', help='competition of the PATHs')
    ap.add_argument('--only', action='append', default=[], help='only entries whose name matches (glob, repeatable)')
    ap.add_argument('--all', action='store_true', help='also read entries IMPORTED.md does not list or marks as skipped')
    ap.add_argument('--fresh', action='store_true', help="start the file over instead of keeping other folders' questions")
    ap.add_argument('--report', default=str(ROOT / 'visual-report.html'), help='page to check the pictures (blank: none)')
    ap.add_argument('--keep-queue', action='store_true', help="don't take the found questions out of review/queue.json")
    a = ap.parse_args(argv)
    jobs, _ = rq.find_jobs(a.sb, a.osb, a.paths, a.comp, a.only, a.all)
    if not jobs:
        ap.error('nothing to read: give --sb/--osb folders or paths')
    if not rq.soffice():
        print('WARNING: LibreOffice (soffice) not found: Word packets and slide decks are skipped')

    banks, results, sets_read = {}, collections.defaultdict(list), collections.defaultdict(set)
    for p, comp, info in jobs:
        if comp not in banks:
            print(f'loading the {comp} bank ...')
            banks[comp] = rq.Bank(rq.BANKS[comp][:1])   # the main bank only: visual questions already filed are re-done
        print(f'{comp}: {p.name}')
        try:
            res = process(p, comp, banks[comp], info)
        except Exception as e:   # noqa: BLE001
            print(f'  FAILED: {type(e).__name__}: {e}'); continue
        print(f"  {sum(1 for r in res if r[1] is not None)} of {len(res)} questions have a picture")
        results[comp] += [(rq.entry_name(p), *r) for r in res]
        sets_read[comp] |= {r[0]['row']['set'] for r in res}

    report_rows = []
    queue_drop = set()
    for comp in sets_read:
        res = results.get(comp, [])
        out = OUT_CSV[comp]
        old = [] if a.fresh else read_csv(out)
        old_by_key = {(r['set'], r['round'], r['num'], r['type'], rq.norm(r['question'])[:200]): r for r in old}
        # Rows from the folders just read replace their old rows (same set, round, number and text keep their id).
        keep_rows = [r for r in old if r['set'] not in sets_read[comp]]
        new_rows = []
        seen = {(rq.norm(r['question'])[:200], rq.norm(r['answer'])[:60]) for r in keep_rows}   # the same question from two folders: once
        for folder, it, im, src in res:
            if im is None:
                report_rows.append((row_for(it), f'{folder}: {it["source"]["file"]}' + (f' ({src})' if src else ''), None))
                continue
            r = row_for(it)
            k = (rq.norm(r['question'])[:200], rq.norm(r['answer'])[:60])
            if k in seen:
                queue_drop.add(it['rid']); continue
            seen.add(k)
            prev = old_by_key.get((r['set'], r['round'], r['num'], r['type'], rq.norm(r['question'])[:200]))
            if prev:
                r['id'], r['subcategory'] = prev['id'], prev.get('subcategory', '')
            r['_im'], r['_src'], r['_rid'] = im, f'{folder}: {src}', it['rid']
            new_rows.append(r)
        rows = keep_rows + sorted(new_rows, key=lambda r: (r['set'], rq.pr.natural_key(r['round']), int(r['num']) if str(r['num']).isdigit() else 0))
        plain = [{c: r.get(c, '') for c in COLUMNS} for r in rows]
        out.parent.mkdir(parents=True, exist_ok=True)
        write_csv(out, plain)
        assign_ids(out, plain)
        for r, pr_ in zip(rows, plain):
            r['id'] = pr_['id']
        for r in plain:
            r['image'] = f'data/visuals/{r["id"]}.webp'
        write_csv(out, plain)
        try:   # subcategories, learned from the whole bank (this file alone is too small to learn from)
            import tag_subcategories as ts
            bank_rows = read_csv(rq.BANKS[comp][0])
            labels, _ = ts.tag(bank_rows + plain, ts.RULES[comp])
            for i, r in enumerate(plain):
                r['subcategory'] = r['subcategory'] or labels.get(len(bank_rows) + i, '')
            write_csv(out, plain)
        except Exception as e:   # noqa: BLE001
            print(f'WARNING: subcategories not filled in ({type(e).__name__}: {e}); pip install scikit-learn')
        for r in rows:
            if '_im' in r:
                save_image(r['_im'], IMG_DIR / f'{r["id"]}.webp')
                report_rows.append((r, r['_src'], str(Path('data/visuals') / f'{r["id"]}.webp')))
                queue_drop.add(r['_rid'])
        # pictures of questions no longer in either file
        want = set()
        for c in OUT_CSV:
            want |= {f'{r["id"]}.webp' for r in read_csv(OUT_CSV[c])}
        if IMG_DIR.exists():
            for f in IMG_DIR.iterdir():
                if f.name not in want:
                    f.unlink()
        print(f'{out.relative_to(ROOT)}: {len(plain)} questions ({len(new_rows)} from the folders read)')

    if queue_drop and not a.keep_queue:
        qfile = ROOT / 'review' / 'queue.json'
        if qfile.exists():
            q = json.loads(qfile.read_text(encoding='utf-8'))
            before = len(q['items'])
            for it in q['items']:
                if it['rid'] in queue_drop and it.get('img'):
                    (ROOT / 'review' / it['img']).unlink(missing_ok=True)
            q['items'] = [it for it in q['items'] if it['rid'] not in queue_drop]
            qfile.write_text(json.dumps(q, ensure_ascii=False, indent=0), encoding='utf-8')
            print(f'review queue: {before} -> {len(q["items"])} questions')
    if a.report:
        report(Path(a.report), report_rows)
        print(f'check the pictures: {a.report}')


if __name__ == '__main__':
    main()
