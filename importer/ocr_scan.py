"""OCR for packets that are scanned images (no text layer), e.g. LOST2.

Turns each scanned PDF into a .txt file with the same name that packet_reader.py can read.
Small raised or lowered marks (Zn²⁺, H₂O, 10⁻³) are found from the ink itself, read again on
their own, and written as $Zn^{2+}$ / $H_{2}O$, since whole-line OCR turns them into stray
punctuation. Questions where a mark could not be read are listed in <name>.ocr.json so they can
be left out.

Usage
  python ocr_scan.py PDF [PDF ...] --out DIR

Requires: tesseract (with English data), pdfimages (poppler), Pillow, numpy, scipy.
"""
import argparse, json, re, subprocess, sys, tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from packet_reader import _math_join  # noqa: E402

XH = '{http://www.w3.org/1999/xhtml}'
DEBUG = __import__('os').environ.get('OCR_DEBUG')
SCALE = 3  # scans are about 96 dpi; tesseract reads them far better enlarged


def tess(img_path, *args):
    return subprocess.run(['tesseract', str(img_path), '-', *args], capture_output=True, text=True).stdout


def page_images(pdf, tmp):
    subprocess.run(['pdfimages', '-png', str(pdf), str(tmp / 'p')], check=True)
    return sorted(tmp.glob('p-*.png'))


def title_dict(t):
    out = {}
    for part in (t or '').split(';'):
        bits = part.split()
        if bits:
            out[bits[0]] = [float(b) for b in bits[1:]]
    return out


def read_blob(gray, labels, comp, xh, digits=False):
    """Read one glyph of a raised/lowered mark: shape first for + and −, OCR for the rest.
    A blob that is really two glyphs run together ("4" and the comma of "BaSO4;") is cut at
    its empty columns and each piece read; pieces too small to be a character are dropped."""
    x0, y0, x1, y1 = comp
    raw = gray[y0:y1, x0:x1] < 222
    if x1 - x0 > 0.6 * xh and raw.any():
        empty = ~raw.any(0)
        pieces, start = [], None
        for k, e in enumerate(list(empty) + [True]):
            if not e and start is None:
                start = k
            elif e and start is not None:
                pieces.append((start, k)); start = None
        if len(pieces) > 1:
            out = ''
            for a, b in pieces:
                rows = np.flatnonzero(raw[:, a:b].any(1))
                if (b - a) < 0.2 * xh or len(rows) == 0 or rows[-1] - rows[0] < 0.4 * xh:
                    continue
                if (b - a) < 0.35 * xh and rows[-1] - rows[0] < 0.6 * xh:
                    continue  # a comma or dot run into the mark
                sub = (x0 + a, y0 + rows[0], x0 + b, y0 + rows[-1] + 1)
                v = read_blob(gray, labels, sub, xh, digits)
                if v is None:
                    return None
                out += v
            return out or None
    ids, counts = np.unique(labels[y0:y1, x0:x1][labels[y0:y1, x0:x1] > 0], return_counts=True)
    if len(ids) == 0:
        return None
    m = labels[y0:y1, x0:x1] == ids[np.argmax(counts)]
    h, w = m.shape
    if digits:
        pass
    elif h <= 0.45 * w and w > 0.15 * xh:
        return '-'
    if not digits and h >= 4 and w >= 4 and 0.6 < h / w < 1.6:
        q = max(1, min(h, w) // 4)
        corners = sum(m[a, b].mean() for a, b in [(slice(0, q), slice(0, q)), (slice(0, q), slice(w - q, w)),
                                                  (slice(h - q, h), slice(0, q)), (slice(h - q, h), slice(w - q, w))]) / 4
        row, col = m[h // 2 - 1:h // 2 + 2, :].any(0).mean(), m[:, w // 2 - 1:w // 2 + 2].any(1).mean()
        if corners < 0.2 and row > 0.75 and col > 0.75:
            return '+'
    # Just this glyph's own pixels (others in its box whitened), scaled to a body-text size.
    pad = 3
    Y0, X0 = max(0, y0 - pad), max(0, x0 - pad)
    glyph = gray[Y0:y1 + pad, X0:x1 + pad].copy()
    lab = labels[Y0:y1 + pad, X0:x1 + pad]
    own = np.zeros_like(lab, bool)
    own[y0 - Y0:y0 - Y0 + h, x0 - X0:x0 - X0 + w] = m
    other = (lab > 0) & ~ndimage.binary_dilation(own, iterations=2)
    glyph[other] = 255
    outside = np.ones_like(own); outside[y0 - Y0:y0 - Y0 + h, x0 - X0:x0 - X0 + w] = False
    glyph[outside & ~ndimage.binary_dilation(own, iterations=pad)] = 255
    k = 64 / max(h, 1)
    im = Image.fromarray(glyph).resize((max(1, int(glyph.shape[1] * k)), max(1, int(glyph.shape[0] * k))), Image.LANCZOS)
    im = im.point(lambda v: 0 if v < 200 else 255)
    canvas = Image.new('L', (im.width + 60, im.height + 60), 255)
    canvas.paste(im, (30, 30))
    wl = '0123456789' if digits else '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ()'
    txt = ''
    with tempfile.NamedTemporaryFile(suffix='.png') as f:
        canvas.save(f.name)
        for psm in ('10', '7'):
            txt = tess(f.name, '--psm', psm, '-c', 'tessedit_char_whitelist=' + wl).strip()
            if re.fullmatch(r'[0-9A-Za-z()]', txt):
                break
    return txt if re.fullmatch(r'[0-9A-Za-z()]', txt) else None


def page_text(png):
    gray = np.array(Image.open(png).convert('L'))
    big = Image.fromarray(gray).resize((gray.shape[1] * SCALE, gray.shape[0] * SCALE), Image.LANCZOS)
    gray = np.array(big)
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / 'page.png'
        big.save(p)
        hocr = subprocess.run(['tesseract', str(p), str(Path(td) / 'out'), '--psm', '4',
                               '-c', 'hocr_char_boxes=1', 'hocr'], capture_output=True, text=True)
        root = ET.parse(Path(td) / 'out.hocr').getroot()
    # Light, blurry scans break strokes apart at a strict threshold; a loose one plus a small
    # closing keeps each glyph in one piece.
    ink = ndimage.binary_closing(gray < 222, structure=np.ones((3, 3)))
    labels, _ = ndimage.label(ink)
    objs = ndimage.find_objects(labels)
    comps = [(s[1].start, s[0].start, s[1].stop, s[0].stop) for s in objs if s is not None]  # x0 y0 x1 y1
    out_lines, doubts = [], []
    for line in root.iter(XH + 'span'):
        if line.get('class') != 'ocr_line':
            continue
        t = title_dict(line.get('title'))
        lx0, ly0, lx1, ly1 = t['bbox']
        slope, off = (t.get('baseline') or [0, 0])[:2]
        xs = (t.get('x_size') or [40])[0]
        base = lambda x: ly1 + off + slope * (x - lx0)
        # chars with their boxes, in reading order, with word breaks
        chars = []
        for w in line:
            if w.get('class') != 'ocrx_word':
                continue
            cs = [c for c in w if c.get('class') == 'ocrx_cinfo']
            if chars:
                chars.append({'t': ' ', 'box': None})
            for c in cs:
                b = title_dict(c.get('title')).get('x_bboxes')
                chars.append({'t': c.text or '', 'box': b})
        if not any(c['t'].strip() for c in chars):
            continue
        # ink blobs on this line
        # Blobs inside this line's box (tesseract's box already takes in raised marks).
        mine = [c for c in comps if c[0] >= lx0 - 2 and c[2] <= lx1 + 2 and c[1] >= ly0 - 4 and c[3] <= ly1 + 4]
        mine.sort()
        # x-height: tesseract's x_size is the whole line height, so measure it from the ink:
        # the commonest top edge among blobs that sit on the baseline is the x-height line.
        tops = [base((c[0] + c[2]) / 2) - c[1] for c in mine if abs(c[3] - base((c[0] + c[2]) / 2)) < 0.08 * xs]
        xh = float(np.median([t for t in tops if 0.3 * xs < t < 0.62 * xs])) if len(tops) > 5 else 0.55 * xs
        if not (0.3 * xs < xh < 0.7 * xs):
            xh = 0.55 * xs

        def kind(c):
            x0, y0, x1, y1 = c
            b = base((x0 + x1) / 2)
            h, w = y1 - y0, x1 - x0
            if y1 < b - 0.4 * xh and y0 < b - 0.85 * xh and h < 1.1 * xh and max(h, w) >= 0.4 * xh:
                return 'up'    # (smaller than that: a dot of ; : i)
            if y0 > b - 0.75 * xh and y1 > b + 0.25 * xh and h > 0.6 * xh and w > 0.35 * xh:
                return 'down'  # (narrower or shorter: a comma)
            return 'mid'

        # A raised or lowered mark touching the letter before it ("Zn²" printed close) comes out
        # as one blob: split off the columns at its right end that sit wholly above (or below)
        # the letters.
        split = []
        for c in mine:
            x0, y0, x1, y1 = c
            if x1 - x0 < 1.2 * xh:
                split.append(c); continue
            m = labels[y0:y1, x0:x1] > 0
            cols = [(np.flatnonzero(m[:, k]) + y0) if m[:, k].any() else None for k in range(x1 - x0)]
            for test in (lambda lo, hi, b: hi < b - 0.4 * xh,            # raised
                         lambda lo, hi, b: lo > b - 0.7 * xh and hi > b + 0.25 * xh):  # lowered
                k = len(cols)
                while k > 0 and (cols[k - 1] is None or test(cols[k - 1][0], cols[k - 1][-1], base(x0 + k))):
                    k -= 1
                tail = [col for col in cols[k:] if col is not None]
                body = [col for col in cols[max(0, k - int(0.3 * xh)):k] if col is not None]
                raised = test(0, 0, 1e9) is True  # the first test is the raised one
                ok = tail and body and (len(cols) - k) >= 0.3 * xh and k >= 0.5 * xh
                if ok and min(t[0] for t in tail) < base(x0 + k) - 1.15 * xh:
                    # raised: the tail rises above the x-height and the letter before it doesn't
                    ok = min(b_[0] for b_ in body) > base(x0 + k) - 1.15 * xh
                elif ok:
                    ok = max(t[-1] for t in tail) > base(x0 + k) + 0.25 * xh and min(t[0] for t in tail) > base(x0 + k) - 0.7 * xh \
                        and max(b_[-1] for b_ in body) < base(x0 + k) + 0.15 * xh
                if ok:  # only after a lowercase letter or digit: the right end of Y or P isn't a mark
                    before = [ch['t'] for ch in chars if ch['box'] and ch['box'][0] <= x0 + k - 2 <= ch['box'][2]]
                    ok = bool(before) and (before[-1].islower() or before[-1].isdigit())
                if ok:
                    split.append((x0, y0, x0 + k, y1))
                    split.append((x0 + k, min(t[0] for t in tail), x1, max(t[-1] for t in tail) + 1))
                    break
            else:
                split.append(c)
        mine = sorted(split)
        ks = [kind(c) for c in mine]
        # A dot or stroke above another blob (the dot of an i, the top of a colon) belongs to it.
        for n, c in enumerate(mine):
            if ks[n] != 'mid' and any(ks[m] == 'mid' and min(c[2], d[2]) - max(c[0], d[0]) > 0.4 * (c[2] - c[0])
                                      for m, d in enumerate(mine) if m != n):
                ks[n] = 'mid'
        if DEBUG and DEBUG in ''.join(c['t'] for c in chars):
            print('LINE', ''.join(c['t'] for c in chars), 'xs', xs, 'xh', xh, 'base', base(lx0))
            for c, k in zip(mine, ks):
                print('   ', c, k, 'b-y1', round(base((c[0]+c[2])/2) - c[3]), 'h', c[3]-c[1])
        regions = []
        i = 0
        while i < len(mine):
            if ks[i] == 'mid':
                i += 1; continue
            j = i
            while j + 1 < len(mine) and ks[j + 1] == ks[i] and mine[j + 1][0] - mine[j][2] < 0.8 * xh:
                j += 1
            run = mine[i:j + 1]
            box = (min(c[0] for c in run), min(c[1] for c in run), max(c[2] for c in run), max(c[3] for c in run))
            left = [c for k, c in zip(ks[:i], mine[:i]) if k == 'mid']
            right = [c for k, c in zip(ks[j + 1:], mine[j + 1:]) if k == 'mid']
            attached = left and box[0] - max(c[2] for c in left[-3:]) < 0.6 * xh
            # a mark followed straight away by a letter is an apostrophe ("Newton's"), not a script
            followed = right and right[0][0] - box[2] < 0.25 * xh and (right[0][3] - right[0][1]) > 0.8 * xh
            # where OCR already saw punctuation (a comma, the parts of a semicolon) it is right
            marks = ';:' if ks[i] == 'up' else ',;'
            # (a blob as big as a digit is a subscript even where OCR printed a comma: "BaSO,")
            comma_sized = ks[i] == 'up' or (box[2] - box[0] < 0.45 * xh and box[3] - box[1] < 0.75 * xh)
            punct = comma_sized and any(c['box'] and box[0] - 2 <= (c['box'][0] + c['box'][2]) / 2 <= box[2] + 2 and c['t'] in marks
                        for c in chars)
            if attached and not followed and not punct:
                regions.append({'kind': ks[i], 'box': box, 'blobs': run})
            i = j + 1
        # Rebuild the text: drop the stray characters OCR made of each mark and put the
        # mark itself in, as LaTeX, where it sits on the line.
        def raised_char(c, r):
            b = c['box']
            if not b:
                return False
            cx = (b[0] + b[2]) / 2
            inside = r['box'][0] - 3 <= cx <= r['box'][2] + 3
            if r['kind'] == 'up':
                return inside and (b[3] < base(cx) - 0.3 * xh or c['t'] in "’'*\"°^`‘“”")
            return inside and b[1] > base(cx) - 0.8 * xh
        for r in regions:
            before = [ch['t'] for ch in chars if ch['box'] and ch['box'][2] <= r['box'][0] + 3 and ch['t'].strip()]
            formula = r['kind'] == 'down' and bool(before) and (before[-1].isupper() or before[-1] in ')]')
            vals = [read_blob(gray, labels, c, xh, digits=formula) for c in r['blobs']]
            r['val'] = None if None in vals else ''.join(vals)
        keep = [c for c in chars if not any(raised_char(c, r) for r in regions)]
        text, pending = '', sorted(regions, key=lambda r: r['box'][0])
        def emit(text, r):
            if re.search(r'[,;:.]\s*$', text) and (r['val'] is None or r['kind'] == 'down'):
                return text  # a blob right after punctuation is part of it, not a script
            if r['val'] is None:
                doubts.append(text[-40:] + '[?]')
                val = '?'
            else:
                val = r['val']
            text = re.sub(r"[’'*\"°^`]+$", '', text)  # leftovers of the mark
            if r['kind'] == 'down':
                text = re.sub(r'(?<=[A-Za-z)])[;,:»]$', '', text)  # "BF;" + 3 -> BF_3
            spaced = text.endswith(' ')
            text = _math_join(text.rstrip(), 'sup' if r['kind'] == 'up' else 'sub', val)
            return text + ' ' if spaced else text
        for c in keep:
            b = c['box']
            while pending and b and (b[0] + b[2]) / 2 > pending[0]['box'][0]:
                text = emit(text, pending.pop(0))
            text += c['t']
        for r in pending:
            text = re.sub(r'[.,;:]+$', '', text) if False else text
            text = emit(text, r)
        out_lines.append((ly1, ' '.join(text.split())))
    out_lines.sort()
    return [l for _, l in out_lines], doubts


# Letters this scanner's OCR mixes up (e read as c most of all), tried on words it doesn't know.
CONFUSIONS = [('c', 'e'), ('t', 'f'), ('l', 't'), ('m', 'rn'), ('rn', 'm'), ('l', 'i'), ('i', 'l'),
              ('f', 't'), ('e', 'c'), ('h', 'b'), ('n', 'u'), ('u', 'n'), ('cl', 'd'), ('o', 'e')]
STEMS = [(r'^cl(?=ect)', 'el'), (r'^cq', 'eq'), (r'^cth', 'eth'), (r'^cuk', 'euk'), (r'^cn', 'en'), (r'^cx', 'ex')]


def fix_word(w):
    """'clectron' -> 'electron', 'Scicntists' -> 'Scientists', 'tollowing' -> 'following'."""
    try:
        from wordfreq import zipf_frequency
    except Exception:
        return w
    if len(w) < 3 or not re.search('[a-z]', w) or not w.isalpha():
        return w
    low = w.lower()
    z0 = zipf_frequency(low, 'en')
    if z0 >= 1.0:
        return w
    import itertools
    cands = set()
    cs = [i for i, ch in enumerate(low) if ch == 'c']
    for r in range(1, min(3, len(cs)) + 1):
        for combo in itertools.combinations(cs, r):
            cands.add(''.join('e' if i in combo else ch for i, ch in enumerate(low)))
    for a, b in CONFUSIONS:
        for m in re.finditer(re.escape(a), low):
            cands.add(low[:m.start()] + b + low[m.end():])
    for pat, rep in STEMS:
        if re.search(pat, low):
            fixed = re.sub(pat, rep, low)
            cands.add(fixed)
            cands |= {fixed[:i] + 'e' + fixed[i + 1:] for i, ch in enumerate(fixed) if ch == 'c'}
    best = max(cands, key=lambda c: zipf_frequency(c, 'en'), default=None)
    if not best or zipf_frequency(best, 'en') < max(1.5, z0 + 1):
        # a long technical word: trust the stem fix if it gives a known start ("clectrophilicity")
        for pat, rep in STEMS[:1]:
            if re.search(pat, low):
                best = re.sub(pat, rep, low)
                break
        else:
            return w
    if w.isupper():
        return best.upper()
    return best[0].upper() + best[1:] if w[0].isupper() else best


def fix_text(lines):
    """Common OCR slips in packet text."""
    out = []
    prev = ''
    for l in lines:
        l = l.replace('—', '–').replace('|', 'I') if not l.startswith('|') else l
        l = re.sub(r'^7\)\s', 'Z) ', l) if re.match(r'^Y\)', prev) else l  # "Z)" read as "7)"
        l = re.sub(r'^(?:\(?W\)|VW\)|Ww\))\s', 'W) ', l)
        l = re.sub(r'^ANSWER[.,;]\s*', 'ANSWER: ', l)
        l = re.sub(r'^ANSWER: 7\)', 'ANSWER: Z)', l)  # Z read as 7 again
        l = re.sub(r'^TOSS[-~ ]?UP$', 'TOSS-UP', l)
        # the ~~~~ divider under an answer, read as a run of tiny "words" ("83 etn ta nn tn en")
        l = re.sub(r'(?:\s+(?:[aeinrtsu]{1,4}|[-~_.]+)){4,}\s*$', '', l)
        if re.fullmatch(r'(?:[aeinrtsu~_.\-]{1,4}\s*){3,}', l.strip()):
            continue
        l = re.sub(r'(?<![\w\]])/([a-z][\w\-’\' ]*\])', r'[\1', l)  # "/zy-lem]" -> "[zy-lem]"
        # the digit 1 read as the letter I ("I to 2 to I", "ANSWER: I AND 2", "I mole")
        one = r'(?:to|and|or|mole|moles|gram|grams|meter|meters|kilogram|kilograms|second|seconds|unit|units|liter|liters|AND|OR|ONLY|TO)'
        l = re.sub(r'\bI(?=\s+' + one + r'\b)', '1', l)
        l = re.sub(r'\b(to|and|of|or|AND|OR|TO)\sI\b(?![’\'])', r'\1 1', l)
        l = re.sub(r'(?<=[,:=(]\s)I\b(?![’\'])|(?<=[,:=(])I\b(?![’\'])', '1', l)
        l = re.sub(r'^I\)', '1)', l)
        l = re.sub(r'(?<=\d)I\b|\bI(?=\d)', '1', l)
        if l.startswith('ANSWER:') and re.search(r'[A-Z0-9]', l[7:]):
            l = re.sub(r'(?<=[A-Z0-9)\]])(?:\s+[a-z]{1,4})+\s*$', '', l)  # trailing junk after an answer
        l = re.sub(r'\[([^\]]*)/(?=\s|$)', r'[\1]', l)             # "[epsilon naught/" -> "[...]"
        l = re.sub(r'\b(Physies|Chemisiry|Chcmistry|Biolugy|Encrgy)\b',
                   lambda m: {'Physies': 'Physics', 'Chemisiry': 'Chemistry', 'Chcmistry': 'Chemistry',
                              'Biolugy': 'Biology', 'Encrgy': 'Energy'}[m.group(1)], l)
        l = re.sub(r'£\.', 'E.', l)
        l = re.sub(r'\b(truc|Truc|TRUC)\b', lambda m: {'truc': 'true', 'Truc': 'True', 'TRUC': 'TRUE'}[m.group(1)], l)
        l = re.sub(r'\bdocs (?=[a-z]+ [a-z])', 'does ', l)
        l = re.sub(r'\bIf(the|x|a|an|angle|it|we)\b', r'If \1', l)
        # words outside $...$ only
        parts = re.split(r'(\$[^$]*\$)', l)
        l = ''.join(pt if pt.startswith('$') else re.sub(r'[A-Za-z]+', lambda m: fix_word(m.group(0)), pt) for pt in parts)
        out.append(l)
        prev = l
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdfs', nargs='+')
    ap.add_argument('--out', required=True)
    a = ap.parse_args(argv)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for pdf in map(Path, a.pdfs):
        with tempfile.TemporaryDirectory() as td:
            lines, doubts = [], []
            for png in page_images(pdf, Path(td)):
                ls, ds = page_text(png)
                lines += ls; doubts += ds
        (out / (pdf.stem + '.txt')).write_text('\n'.join(fix_text(lines)) + '\n', encoding='utf-8')
        (out / (pdf.stem + '.ocr.json')).write_text(json.dumps({'unread_marks': doubts}, indent=1, ensure_ascii=False), encoding='utf-8')
        print(f'{pdf.name}: {len(lines)} lines, {len(doubts)} marks not read')


if __name__ == '__main__':
    main()
