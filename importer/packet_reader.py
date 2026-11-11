#!/usr/bin/env python3
"""Rule-based Science Bowl packet reader (no API).

Turns packet PDFs / Word files (loose, or inside .zip archives) into rows in the
pts question-sheet format:

    id,set,year,level,round,num,type,subject,format,question,w,x,y,z,answer,accept,reject,notes

How it works
  1. Text is rebuilt from character positions (pdfplumber), not a plain text dump,
     so word spacing survives justified layouts and small raised/lowered digits
     become LaTeX: superscripts -> $16^{16}$, subscripts -> $CH_{4}$, stacked
     fractions -> $\\frac{3}{4}$.
  2. Lines that repeat on most pages (running headers, footers, page numbers) are dropped.
  3. Questions are found by their printed structure:
        TOSS-UP / BONUS / VISUAL BONUS
        12) PHYSICS - Multiple Choice  <stem>  W) ... X) ... Y) ... Z) ...
        ANSWER: ...
  4. Each row is checked (MC options present, answer letter/text agree with the option,
     numbering complete, toss-up/bonus pairs) and problems go into the report.

Usage
  python packet_reader.py PATH [PATH ...] --out OUTDIR
PATH can be a .zip, .pdf, .docx, .txt, .ibp or a folder of them. Each zip (or folder) is
treated as one tournament. Writes one CSV per tournament, all.csv, and report.json.

Requires: pdfplumber, python-docx. Optional: wordfreq (better line-end de-hyphenation).
"""
import argparse, collections, csv, io, json, os, re, statistics, sys, unicodedata, zipfile
from pathlib import Path

import pdfplumber

try:
    from wordfreq import zipf_frequency
except Exception:  # pragma: no cover
    zipf_frequency = None

COLUMNS = ['id', 'set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format',
           'question', 'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes']

SUBJECTS = [
    ('EARTH AND SPACE SCIENCE', 'Earth and Space'), ('EARTH AND SPACE', 'Earth and Space'),
    ('EARTH & SPACE', 'Earth and Space'), ('EARTH SCIENCE', 'Earth and Space'),
    ('BIOLOGY', 'Biology'), ('LIFE SCIENCE', 'Biology'), ('CHEMISTRY', 'Chemistry'),
    ('PHYSICS', 'Physics'), ('PHYSICAL SCIENCE', 'Physics'), ('MATHEMATICS', 'Mathematics'),
    ('MATH', 'Mathematics'), ('ENERGY', 'Energy'), ('GENERAL SCIENCE', 'General Science'),
    ('ASTRONOMY', 'Astronomy'), ('COMPUTER SCIENCE', 'Computer Science'),
    ('EARTH/SPACE', 'Earth and Space'), ('ESS', 'Earth and Space'), ('ES', 'Earth and Space'),
    ('MATH AND CS', 'Mathematics'), ('MATH & CS', 'Mathematics'), ('MATH/CS', 'Mathematics'),
    ('ASTRO', 'Astronomy'), ('BIO', 'Biology'), ('CHEM', 'Chemistry'), ('PHYS', 'Physics'),
    ('E&S', 'Earth and Space'), ('EARTH & SPACE SCIENCE', 'Earth and Space'),
    ('SPACE SCIENCE', 'Earth and Space'),
    # Sub-fields used as categories by single-subject tournaments (NCB, Lexington Biology Bowl)
    ('GENERAL CHEMISTRY', 'Chemistry'), ('ORGANIC CHEMISTRY', 'Chemistry'), ('INORGANIC CHEMISTRY', 'Chemistry'),
    ('PHYSICAL CHEMISTRY', 'Chemistry'), ('ANALYTICAL CHEMISTRY', 'Chemistry'), ('NUCLEAR CHEMISTRY', 'Chemistry'),
    ('ANATOMY & PHYSIOLOGY', 'Biology'), ('ANATOMY AND PHYSIOLOGY', 'Biology'), ('BIOSYSTEMATICS', 'Biology'),
    ('CELL BIOLOGY & BIOCHEMISTRY', 'Biology'), ('CELL BIOLOGY AND BIOCHEMISTRY', 'Biology'),
    ('ECOLOGY & ETHOLOGY', 'Biology'), ('ECOLOGY AND ETHOLOGY', 'Biology'),
    ('GENETICS & EVOLUTION', 'Biology'), ('GENETICS AND EVOLUTION', 'Biology'), ('PLANTS', 'Biology'),
]
# Longest first so "MATH AND CS" wins over "MATH" and "ESS" over "ES".
SUBJECTS.sort(key=lambda t: -len(t[0]))
SUBJ_RE = '|'.join(re.escape(s).replace(r'\ ', r'\s+') for s, _ in SUBJECTS)
SUBJ_MAP = {re.sub(r'\s+', ' ', s): v for s, v in SUBJECTS}
KNOWN_SUBJECTS = set(SUBJ_MAP.values())

# Headers are printed in capitals on their own line ("TOSS-UP", "TOSSUP 1") or directly
# before "12) ...". Case-sensitive on purpose: "bonus that awards 18 points" isn't a header.
HEADER_RE = re.compile(r'^\s*((?:VISUAL|VISHWAL|AUDITORY|AUDIO)\s+(?:BONUS|TOSS[\s-]*UP)|TOSS[\s-]*UPS?|Toss[\s-]*[Uu]p|BONUS|Bonus)\b[\s:.#]*(\d{1,2})?[A-D]?[\s:.]*(?:\([^)]{0,60}\)\s*|\[[^\]]{0,60}\]\s*|[-–—]\s*[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)?\s*|[→`]\s*)?((?:\d{1,2}\s*\.?\s*[).].*)?)$')
_FMT = r'((?i:Short\s*Answer|Mul\s?tiple\s*Choice))'
_NUM = r'(?:(\d{1,2}|#)\s*\.?\s*[).:]\s*)'          # "12)", "12.", "5.)", "2 )", "#)"
_QUAL = r'(?:\s*[\[(][^\])]{0,25}[\])])?'           # "Biology [Early RR]", "Physics (Modern)", "Biology [3]"
# "12) PHYSICS - Multiple Choice ...", "1. Biology: Short Answer: ...", "PHYSICS, SHORT ANSWER ..."
QSTART_RE = re.compile(
    r'^\s*' + _NUM + r'?(' + SUBJ_RE + r')(?![A-Za-z])' + _QUAL + r'\s*[-–—:,]{0,2}\s*' + _FMT + r'\s*[:.\-–—,]?\s*(.*)$', re.I)
# Format left out: "22) Physics - Two masses of 2 kg ..." (only accepted right after a TOSS-UP/BONUS header)
QSTART_NOFMT_RE = re.compile(r'^\s*' + _NUM + r'?(' + SUBJ_RE + r')(?![A-Za-z])' + _QUAL + r'\s*[-–—:,]\s*(.*)$', re.I)
# A category this list doesn't know ("BUMS Special", "Y-Risk"), when the number and format are printed.
QSTART_OTHER_RE = re.compile(r'^\s*(\d{1,2})\s*\.?\s*[).]\s*([A-Z][A-Za-z!-]+(?:\s+[A-Z][A-Za-z!-]+){0,2}?)' + _QUAL + r'\s*[-–—:,]?\s*' + _FMT + r'\s*[:.\-–—,]?\s*(.*)$')
QSTART_TYPE_ONLY_RE = re.compile(r'^\s*(\d{1,2})\s*\.?\s*[).]\s*(TOSS[\s-]*UP|BONUS)\s*[-–—:]\s*(.+)$', re.I)  # subject left out
QSTART_OTHER_NONUM_RE = re.compile(r'^\s*([A-Z][A-Z!-]+(?:\s+[A-Z][A-Z!-]+){0,2})' + _QUAL + r'\s*[-–—:,]\s*' + _FMT + r'\s*[:.\-–—,]?\s*(.*)$')
# A sheet of spare questions for one subject: heading "Replacements - Biology", then lines like
# "MS RR1 TOSSUP, MULTIPLE CHOICE ..." naming the round each one replaces.
SUBJECT_HEADING_RE = re.compile(r'^\s*(?:Replacements?|Extra|Spare|Backup)(?:\s+Questions)?\s*[-–—:]\s*([A-Z][A-Za-z&/ ]{1,30}?)\s*$', re.I)
QSTART_REPL_RE = re.compile(r'^\s*((?:[A-Z]{2,3}\s+)?(?:RR|DE|SW|SE|FINALS?|PLAYOFFS?)\s*\d*)?\s*(TOSS[\s-]*UPS?|BONUS)\s*[-–—:,]\s*' + _FMT + r'\s*[-–—:,.]?\s*(.*)$', re.I)
VISUAL_LINE_RE = re.compile(r'^\s*(?:(\d{1,2})\s*[).]\s*)?VISUAL\s+BONUS\b\s*(?:\d{1,2})?\s*[-–—:,]?\s*(?:' + SUBJ_RE + r')\s*[-–—:,]?\s*$', re.I)
# Type, subject and format on one line: "Tossup Chemistry Short Answer",
# "1) Tossup - Biology - Short Answer - Identify ...", "2 )Tossup – Chemistry – Multiple Choice – ..."
QSTART_COMBO_RE = re.compile(
    r'^\s*(?:(\d{1,2})\s*\.?\s*[).]?\s*)?(VISUAL\s+BONUS|TOSS[\s-]*UPS?|BONUS)\s*(\d{1,2})?\s*[-–—:,.)]*\s*(' + SUBJ_RE + r')(?![A-Za-z])'
    + _QUAL + r'\s*[-–—:,]?\s*' + _FMT + r'?\s*[-–—:,.]?\s*(.*)$', re.I)
ANSWER_RE = re.compile(r'^\s*(?:ANSWER|ANS)\s*[:.;]\s*(.*)$', re.I)

LIGATURES = {'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', '​': '', '­': '', '﻿': ''}


# ---------------------------------------------------------------------------
# 1. Text extraction with sub/superscripts and fractions
# ---------------------------------------------------------------------------

SPACING_ACCENTS = {'¨': '\u0308', '´': '\u0301', 'ˆ': '\u0302', '˜': '\u0303', 'ˇ': '\u030c'}


# Some exporters leave f-ligatures unmapped as '\x00' ('di\x00erence', '\x00rst', 'o\x00en').
# Which ligature it was is worked out per word: the spelling that makes the most common word.
_NUL_CANDS = ['ff', 'fi', 'fl', 'ffi', 'ffl', 'ft']


def fix_nul_ligatures(s):
    if '\x00' not in s:
        return s
    def word(m):
        w = m.group(0)
        if zipf_frequency is None:
            return w.replace('\x00', 'fi')
        L, _, R = w.partition('\x00')
        whole = {c: zipf_frequency((L + c + R).lower(), 'en') for c in _NUL_CANDS}
        best = max(_NUL_CANDS, key=whole.get)
        if whole[best] == 0 and len(R) >= 4:  # a compound: 'hepta' + 'fluoride'
            right = {c: zipf_frequency((c + R).lower(), 'en') for c in _NUL_CANDS}
            best = max(_NUL_CANDS, key=right.get) if max(right.values()) > 0 else 'fi'
        elif whole[best] == 0:
            best = 'fi'
        return w.replace('\x00', best)
    return re.sub(r'[A-Za-z]*\x00[A-Za-z]*', word, s).replace('\x00', '')


def _clean(s):
    s = fix_nul_ligatures(s)
    for a, b in LIGATURES.items():
        s = s.replace(a, b)
    s = re.sub('[\ue000-\uf8ff]', ' ', s)  # private-use glyphs (pieces of tall brackets in Symbol fonts)
    s = re.sub(r'\\\((.+?)\\\)', lambda m: '$' + m.group(1).strip() + '$', s)  # LaTeX typed as \( ... \)
    # Mathematical italic/bold letters (𝑛, 𝑥) -> plain letters
    s = ''.join(unicodedata.normalize('NFKC', ch) if 0x1D400 <= ord(ch) <= 0x1D7FF else ch for ch in s)
    return s


def _compose_accents(s):
    """LaTeX PDFs often store 'ö' as 'o' + spacing '¨' (or the other way round)."""
    acc = ''.join(SPACING_ACCENTS)
    s = re.sub(f'([A-Za-z])([{acc}])', lambda m: m.group(1) + SPACING_ACCENTS[m.group(2)], s)
    s = re.sub(f'([{acc}])([A-Za-z])', lambda m: m.group(2) + SPACING_ACCENTS[m.group(1)], s)
    return unicodedata.normalize('NFC', s)


def _math_join(left, kind, a, b=''):
    """Attach a script/fraction to the end of `left`, returning the new string."""
    a = a.replace('−', '-').strip()
    b = b.replace('−', '-').strip()
    if kind == 'frac':
        m = re.search(r'([-−])$', left)  # a minus sign right before the fraction
        sign = ''
        if m:
            left, sign = left[:-1], '-'
        return left + f'${sign}\\frac{{{a}}}{{{b}}}$'
    op = '^' if kind == 'sup' else '_'
    # Merge into a math run we just closed: "$CH_{3}$" + "OH"... keep it simple: only
    # extend when the text ends with a closing $ immediately (e.g. two scripts in a row).
    m = re.search(r'([A-Za-z0-9.]+|\$[^$]*\$[A-Za-z0-9.]*)$', left)
    base = m.group(1) if m else ''
    if not base and left.endswith(')') and '(' in left:  # "(RT)" + sup 2 -> $(RT)^{2}$
        depth, k = 0, len(left) - 1
        while k >= 0:
            depth += {')': 1, '(': -1}.get(left[k], 0)
            if depth == 0:
                break
            k -= 1
        if k >= 0 and '$' not in left[k:]:
            grp = re.sub(r'\s+\)', ')', left[k:])
            return left[:k] + f'${grp}{op}{{{_texscript(a)}}}$'
    left = left[:len(left) - len(base)]
    if base.startswith('$'):
        inner, tail = re.match(r'\$([^$]*)\$(.*)', base).groups()
        base_tex = inner + _texword(tail)
    else:
        base_tex = _texword(base)
    return left + f'${base_tex}{op}{{{_texscript(a)}}}$'


def _texword(w):
    if not w:
        return ''
    if re.fullmatch(r'[A-Za-z]{2,}', w):
        return f'\\text{{{w}}}'
    m = re.fullmatch(r'([0-9.]*)([A-Za-z]{2,})', w)
    if m:
        return f'{m.group(1)}\\text{{{m.group(2)}}}'
    return w


def _texscript(s):
    s = s.replace('◦', '\\circ').replace('°', '\\circ').replace('∗', '*')
    if re.fullmatch(r'[A-Za-z]{2,}', s):
        return f'\\text{{{s}}}'
    return s


def _is_black(col):
    if col is None:
        return False
    if isinstance(col, (int, float)):
        col = (col,)
    col = tuple(col)
    return (len(col) in (1, 3) and all(v <= 0.05 for v in col)) or (len(col) == 4 and col[3] >= 0.95)


def page_lines(page):
    # Text hidden under solid black boxes (redactions) is not real packet text.
    boxes = [r for r in page.rects if r.get('fill') and _is_black(r.get('non_stroking_color'))
             and r['width'] > 20 and 4 < r['height'] < 40]
    inside = lambda c: any(b['x0'] - 1 <= c['x0'] and c['x1'] <= b['x1'] + 1 and b['top'] - 1 <= c['top'] and c['bottom'] <= b['bottom'] + 1 for b in boxes)
    chars = [c for c in page.chars if c['text'].strip() and c.get('upright', True) and not inside(c)]
    # Fonts without a Unicode map come out as "(cid:90)". In the common TrueType (Mac) glyph
    # order glyph n is the character with code n + 29 (177-179 are dashes). Decode those on pages
    # where unmapped glyphs are common; a stray math symbol elsewhere (TeX fonts) is left alone.
    cids = sum(c['text'].startswith('(cid:') for c in chars)
    for c in (chars if cids > 0.05 * max(len(chars), 1) else []):  # only pages that are mostly unmapped
        m = re.fullmatch(r'\(cid:(\d+)\)', c['text'])
        if m:
            n = int(m.group(1))
            c['text'] = chr(n + 29) if 33 <= n + 29 < 127 else ('–' if 177 <= n <= 179 else '')
    chars = [c for c in chars if c['text']]
    # Text typed into the PDF as comment boxes (used for corrections, e.g. a replaced question).
    notes = []
    for a in page.annots or []:
        if 'FreeText' in str((a.get('data') or {}).get('Subtype')) and (a.get('contents') or '').strip():
            notes.append((a['top'], ' '.join(_clean(a['contents']).split())))
    lines = _lines_from_chars(page, chars) if chars else []
    if notes:
        # Fold each comment into the line it sits beside (same band), else insert by position.
        for y, text in notes:
            lines.append((y, text))
        lines.sort(key=lambda t: t[0])
    return [s for _, s in lines if s.strip()]


def _lines_from_chars(page, chars):
    body = statistics.mode(round(c['size']) for c in chars) or 11
    main = [c for c in chars if c['size'] >= 0.8 * body]
    small = [c for c in chars if c['size'] < 0.8 * body]

    # Cluster main-size chars into lines by bottom edge.
    main.sort(key=lambda c: (c['bottom'], c['x0']))
    lines = []
    for c in main:
        if lines and abs(c['bottom'] - lines[-1]['bottom']) <= 0.3 * body:
            L = lines[-1]
        else:
            L = {'bottom': c['bottom'], 'chars': []}
            lines.append(L)
        L['chars'].append(c)
    # A lone math symbol (√, ∑, a tall bracket) sits higher than its line: fold it into the
    # vertically overlapping line where it has a neighbour touching it and nothing on top of it.
    def span(L):
        return min(c['top'] for c in L['chars']), max(c['bottom'] for c in L['chars'])
    for L in list(lines):
        if len(L['chars']) > 3 or any(c['text'].isalnum() for c in L['chars']):
            continue
        t0, b0 = span(L)
        x0, x1 = min(c['x0'] for c in L['chars']), max(c['x1'] for c in L['chars'])
        best, bscore = None, None
        for M in lines:
            if M is L:
                continue
            t1, b1 = span(M)
            if min(b0, b1) - max(t0, t1) <= 0:
                continue
            if any(min(x1, c['x1']) - max(x0, c['x0']) > 0.5 for c in M['chars']):
                continue  # something already printed in that spot
            near = min(min(abs(c['x0'] - x1), abs(x0 - c['x1'])) for c in M['chars'])
            if bscore is None or near < bscore:
                best, bscore = M, near
        if best is not None and bscore < 0.5 * body:
            best['chars'].extend(L['chars'])
            lines.remove(L)
    for L in lines:
        L['top'] = statistics.median(c['top'] for c in L['chars'])
        L['bottom'] = statistics.median(c['bottom'] for c in L['chars'])
    # Attach small chars to the nearest line they overlap.
    orphans = []
    for c in small:
        cy = (c['top'] + c['bottom']) / 2
        best, bd = None, 1e9
        for L in lines:
            if L['top'] - 0.5 * body <= cy <= L['bottom'] + 0.35 * body:
                d = abs(cy - (L['top'] + L['bottom']) / 2)
                if d < bd:
                    best, bd = L, d
        (best['chars'] if best else orphans).append(c)
    for c in orphans:  # small text on its own line (footnotes etc.)
        for L in lines:
            if L.get('orph') and abs(L['bottom'] - c['bottom']) <= 0.3 * body:
                L['chars'].append(c); break
        else:
            lines.append({'bottom': c['bottom'], 'top': c['top'], 'chars': [c], 'orph': True})
    lines.sort(key=lambda L: L['bottom'])

    return [(L['bottom'], _render_line(L, body)) for L in lines]


def _render_line(L, body):
    top, bottom = L['top'], L['bottom']
    mid = (top + bottom) / 2
    h = max(bottom - top, 1)
    cs = sorted(L['chars'], key=lambda c: (c['x0'], c['top']))
    is_small = lambda c: c['size'] < 0.8 * body and not L.get('orph')

    def cls(c):
        cy = (c['top'] + c['bottom']) / 2
        if abs(cy - mid) < 0.12 * h:
            return 'mid'
        return 'up' if cy < mid else 'down'

    text, last_x1, i = '', None, 0
    gap_space = 0.1 * body
    while i < len(cs):
        c = cs[i]
        if is_small(c) and cls(c) != 'mid':
            run = [c]
            j = i + 1
            while j < len(cs) and is_small(cs[j]) and cls(cs[j]) != 'mid' and cs[j]['x0'] <= max(r['x1'] for r in run) + 0.25 * body:
                run.append(cs[j]); j += 1
            ups = [r for r in run if cls(r) == 'up']
            downs = [r for r in run if cls(r) == 'down']
            if last_x1 is not None and run[0]['x0'] - last_x1 > gap_space and not text.endswith(' '):
                text += ' '
            word = lambda rs: _clean(''.join(r['text'] for r in sorted(rs, key=lambda r: r['x0'])))
            if ups and downs:
                ux = (min(r['x0'] for r in ups), max(r['x1'] for r in ups))
                dx = (min(r['x0'] for r in downs), max(r['x1'] for r in downs))
                overlap = min(ux[1], dx[1]) - max(ux[0], dx[0])
                if overlap > 0.4 * min(ux[1] - ux[0], dx[1] - dx[0]):
                    text = _math_join(text, 'frac', word(ups), word(downs))
                else:  # e.g. an ion with sub then sup: emit in x order
                    for grp in _split_runs(run, cls):
                        text = _math_join(text, 'sup' if cls(grp[0]) == 'up' else 'sub', word(grp))
            else:
                text = _math_join(text, 'sup' if ups else 'sub', word(run))
            last_x1 = max(r['x1'] for r in run)
            i = j
            continue
        if last_x1 is not None and c['x0'] - last_x1 > gap_space and not text.endswith(' '):
            text += ' '
        text += _clean(c['text'])
        last_x1 = c['x1'] if last_x1 is None else max(last_x1, c['x1']) if c['x0'] < last_x1 else c['x1']
        i += 1
    text = re.sub(r'(?<=\S) +\)', ')', text)
    text = re.sub(r'\( +(?=\S)', '(', text)
    text = re.sub(r'(?<=\w) +([?.,;:])(?=\s|$)', r'\1', text)  # 'f ?' from italic spacing
    return _compose_accents(text.strip())


def _split_runs(run, cls):
    groups = []
    for r in sorted(run, key=lambda r: r['x0']):
        if groups and cls(groups[-1][0]) == cls(r):
            groups[-1].append(r)
        else:
            groups.append([r])
    return groups


def pdf_pages(data):
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return [page_lines(p) for p in pdf.pages]


def _docx_numbering(d):
    """numId -> {ilvl: (numFmt, start, lvlText)} from the document's numbering part."""
    from docx.oxml.ns import qn
    out = {}
    try:
        root = d.part.numbering_part.element
    except Exception:
        return out
    abstract = {}
    for an in root.findall(qn('w:abstractNum')):
        lv = {}
        for l in an.findall(qn('w:lvl')):
            g = lambda tag: (l.find(qn(tag)).get(qn('w:val')) if l.find(qn(tag)) is not None else None)
            lv[int(l.get(qn('w:ilvl')))] = (g('w:numFmt') or 'decimal', int(g('w:start') or 1), g('w:lvlText') or '%1.')
        abstract[an.get(qn('w:abstractNumId'))] = lv
    for n in root.findall(qn('w:num')):
        a = n.find(qn('w:abstractNumId'))
        if a is not None:
            out[n.get(qn('w:numId'))] = abstract.get(a.get(qn('w:val')), {})
    return out


def _roman(n):
    vals = [(10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]
    r = ''
    for v, t in vals:
        while n >= v:
            r += t; n -= v
    return r


# Word equations (OMML) -> LaTeX, so "Let $f(x)=\frac{1}{1-x}$" isn't read as "Let ."
_OMML_SYMBOLS = {
    'π': r'\pi', 'θ': r'\theta', 'α': r'\alpha', 'β': r'\beta', 'γ': r'\gamma', 'δ': r'\delta',
    'Δ': r'\Delta', 'ε': r'\epsilon', 'λ': r'\lambda', 'μ': r'\mu', 'ρ': r'\rho', 'σ': r'\sigma',
    'Σ': r'\Sigma', 'τ': r'\tau', 'φ': r'\phi', 'ϕ': r'\phi', 'ω': r'\omega', 'Ω': r'\Omega',
    'ψ': r'\psi', 'Ψ': r'\Psi', 'Φ': r'\Phi', 'Γ': r'\Gamma', 'Λ': r'\Lambda', 'Π': r'\Pi',
    'Θ': r'\Theta', 'Ξ': r'\Xi', 'ℏ': r'\hbar', 'χ': r'\chi', 'η': r'\eta', 'κ': r'\kappa', 'ν': r'\nu', 'ξ': r'\xi', 'ζ': r'\zeta',
    '×': r'\times', '·': r'\cdot', '⋅': r'\cdot', '±': r'\pm', '∓': r'\mp', '≤': r'\le', '≥': r'\ge',
    '≠': r'\ne', '≈': r'\approx', '∞': r'\infty', '→': r'\to', '∈': r'\in', '∂': r'\partial',
    '∇': r'\nabla', '°': r'^{\circ}', '−': '-', '∗': '*', '…': r'\ldots', '⋯': r'\cdots',
    '∫': r'\int', '∑': r'\sum', '∏': r'\prod', '∮': r'\oint', '√': r'\sqrt{}',
}
_OMML_FUNCS = {'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'ln', 'log', 'exp', 'lim', 'max', 'min',
               'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'det'}


def _omml(el):
    """LaTeX for an OMML element (m:oMath or any part of one)."""
    from docx.oxml.ns import qn
    M = lambda tag: '{http://schemas.openxmlformats.org/officeDocument/2006/math}' + tag
    tag = el.tag.split('}')[-1]

    def kids(e, skip=('Pr',)):
        return ''.join(_omml(c) for c in e if not c.tag.endswith(skip) and not c.tag.endswith('ctrlPr'))

    def part(name):
        c = el.find(M(name))
        return kids(c) if c is not None else ''

    def prop(prname, child, default=None):
        pr = el.find(M(prname))
        c = pr.find(M(child)) if pr is not None else None
        return c.get(M('val'), default) if c is not None else default

    if tag == 'r':
        text = ''.join(t.text or '' for t in el.iter(M('t')))
        text += ''.join(t.text or '' for t in el.iter(qn('w:t')))
        if not text:
            return ''
        normal = el.find(M('rPr')) is not None and (el.find(M('rPr')).find(M('nor')) is not None
                                                     or prop('rPr', 'sty') == 'p')
        if text.strip() in _OMML_FUNCS:
            return '\\' + text.strip() + ' '
        if normal and re.fullmatch(r'[A-Za-z ]{2,}', text.strip()):
            return f'\\text{{{text}}}'
        out = ''
        for ch in text:
            sym = _OMML_SYMBOLS.get(ch)
            out += (sym + ' ' if sym and sym[-1].isalpha() else sym) if sym else ch
        return out
    if tag == 'f':
        num, den = part('num'), part('den')
        if prop('fPr', 'type') == 'lin':
            return f'{num}/{den}'
        return f'\\frac{{{num}}}{{{den}}}'
    if tag == 'sSup':
        return f'{{{part("e")}}}^{{{part("sup")}}}'
    if tag == 'sSub':
        return f'{{{part("e")}}}_{{{part("sub")}}}'
    if tag == 'sSubSup':
        return f'{{{part("e")}}}_{{{part("sub")}}}^{{{part("sup")}}}'
    if tag == 'sPre':
        return f'{{}}_{{{part("sub")}}}^{{{part("sup")}}}{part("e")}'
    if tag == 'rad':
        deg = part('deg')
        return f'\\sqrt[{deg}]{{{part("e")}}}' if deg.strip() else f'\\sqrt{{{part("e")}}}'
    if tag == 'd':
        beg, end, sep = prop('dPr', 'begChr', '('), prop('dPr', 'endChr', ')'), prop('dPr', 'sepChr', ',')
        es = [kids(e) for e in el.findall(M('e'))]
        esc = lambda c: {'{': r'\{', '}': r'\}', '|': '|', '': '.', '⌊': r'\lfloor', '⌋': r'\rfloor',
                         '⌈': r'\lceil', '⌉': r'\rceil', '‖': r'\|', '⟨': r'\langle', '⟩': r'\rangle'}.get(c, c)
        return f'\\left{esc(beg)}{sep.join(es)}\\right{esc(end)}'
    if tag == 'nary':
        op = _OMML_SYMBOLS.get(prop('naryPr', 'chr', '∫'), prop('naryPr', 'chr', '∫'))
        sub, sup = part('sub'), part('sup')
        lim = (f'_{{{sub}}}' if sub.strip() else '') + (f'^{{{sup}}}' if sup.strip() else '')
        return f'{op}{lim} {part("e")}'
    if tag == 'func':
        return f'{part("fName").strip()} {part("e")}'
    if tag == 'limLow':
        return f'{part("e")}_{{{part("lim")}}}'
    if tag == 'limUpp':
        return f'{part("e")}^{{{part("lim")}}}'
    if tag == 'acc':
        ch = prop('accPr', 'chr', '̂')
        cmd = {'̂': 'hat', '̃': 'tilde', '̇': 'dot', '̈': 'ddot', '⃗': 'vec', '̄': 'bar', '→': 'vec'}.get(ch, 'hat')
        return f'\\{cmd}{{{part("e")}}}'
    if tag == 'bar':
        return f'\\overline{{{part("e")}}}'
    if tag == 'm':
        rows = [' & '.join(kids(e) for e in mr.findall(M('e'))) for mr in el.findall(M('mr'))]
        return '\\begin{matrix}' + ' \\\\ '.join(rows) + '\\end{matrix}'
    if tag == 'eqArr':
        return ' \\\\ '.join(kids(e) for e in el.findall(M('e')))
    if tag.endswith('Pr') or tag == 'ctrlPr':
        return ''
    return kids(el)


def _omml_inline(el):
    tex = re.sub(r'\s+', ' ', _omml(el)).strip()
    tex = re.sub(r'\{\{([^{}]*)\}\}', r'{\1}', tex)
    tex = re.sub(r'(?<![\^_])\{([A-Za-z0-9.]+)\}(?=[\^_])', r'\1', tex)  # {x}^{2} -> x^{2}
    if not tex:
        return ''
    if re.fullmatch(r'[A-Za-z0-9.,]+', tex):  # a plain number or word typed as an equation
        return tex
    return f'${tex}$'


def docx_pages(data):
    """Word packets: paragraphs and table cells in document order. Auto-numbered list items
    (Word's own 1. 2. 3. or W) X) Y) Z) numbering, which isn't part of the text) get their
    number or letter written out so the parser sees them."""
    import docx  # python-docx
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    d = docx.Document(io.BytesIO(data))
    numbering = _docx_numbering(d)
    lines, counters, prev_list = [], {}, None

    from docx.text.run import Run
    MATH = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'

    def pieces(el):
        # Runs and equations in reading order, including those inside hyperlinks,
        # tracked insertions and content controls.
        for c in el:
            if c.tag == qn('w:r'):
                yield 'run', c
            elif c.tag in (MATH + 'oMath', MATH + 'oMathPara'):
                yield 'math', c
            elif c.tag in (qn('w:hyperlink'), qn('w:ins'), qn('w:smartTag'), qn('w:sdt'), qn('w:sdtContent'), qn('w:fldSimple')):
                yield from pieces(c)

    def para_text(p):
        s = ''
        for kind, el in pieces(p._p):
            if kind == 'math':
                tex = _omml_inline(el)
                if tex:
                    s += (' ' if s and not s.endswith((' ', '(', '$')) and tex.startswith('$') and s[-1].isalnum() else '') + tex
                continue
            r = Run(el, p)
            t = _clean(r.text)
            if not t:
                continue
            f = r.font
            if f.superscript and t.strip():
                s = _math_join(s, 'sup', t.strip())
            elif f.subscript and t.strip():
                s = _math_join(s, 'sub', t.strip())
            else:
                s += t
        return _compose_accents(s)

    def handle(p):
        nonlocal prev_list
        text = para_text(p).strip()
        pPr = p._p.pPr
        numPr = pPr.numPr if pPr is not None else None
        if numPr is not None and numPr.numId is not None and text:
            nid = str(numPr.numId.val)
            ilvl = int(numPr.ilvl.val) if numPr.ilvl is not None else 0
            fmt, start, lvltext = numbering.get(nid, {}).get(ilvl, ('decimal', 1, '%1.'))
            key = (nid, ilvl)
            if prev_list != nid:
                counters.pop(key, None)  # a new run of list items restarts the count
            counters[key] = counters.get(key, start - 1) + 1
            prev_list = nid
            k = counters[key]
            if QSTART_RE.match(text) or HEADER_RE.match(text) or ANSWER_RE.match(text) or fmt in ('bullet', 'none'):
                pass  # auto-numbered question lines: numbering is optional for the parser
            elif fmt == 'decimal':
                text = f'{k}) {text}'
            elif fmt in ('upperLetter', 'lowerLetter'):
                text = f"{chr(ord('A') + (k - 1) % 26)}) {text}"
            elif fmt in ('upperRoman', 'lowerRoman'):
                text = f'{_roman(k)}. {text}'
        elif text:
            prev_list = None
        for part in text.split('\n'):
            if part.strip():
                lines.append(part.strip())

    for child in d.element.body.iterchildren():
        if child.tag == qn('w:p'):
            handle(Paragraph(child, d))
        elif child.tag == qn('w:tbl'):  # some packets put answers or options in a table
            for tr in child.iter(qn('w:tr')):
                for tc in tr.iter(qn('w:tc')):
                    for pe in tc.iter(qn('w:p')):
                        handle(Paragraph(pe, d))
    return [lines]


IBP_HEAD_RE = re.compile(r'^(TOSSUP|TOSS-UP|BONUS)\s+(\d+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$', re.I)
IBP_IMAGE_RE = re.compile(r'\b(?:shown|pictured|depicted)\s+(?:in|on)\s+(?:the\s+)?(?:image|diagram|screen|picture|figure)|\bin the (?:image|picture)\b', re.I)


def ibp_packet(text):
    """Plain-text packets ("PACKET / set: RR 1 / TOSSUP 1 | Physics | Phrase / ... / ANSWER: ...").
    Returns (round name or None, lines in the usual packet layout, skipped image questions,
    the skipped questions as rows for the review queue)."""
    round_name, out, skipped, skipped_rows = None, [], [], []
    blocks, cur = [], None
    for raw in text.splitlines():
        line = raw.strip().replace('$$', '$')
        m = IBP_HEAD_RE.match(line)
        if m:
            cur = {'type': 'BONUS' if m.group(1).upper() == 'BONUS' else 'TOSS-UP', 'num': m.group(2),
                   'subject': m.group(3), 'kind': m.group(4), 'body': [], 'answer': [], 'accept': [],
                   'reject': [], 'part': 'body'}
            blocks.append(cur); continue
        if cur is None:
            mm = re.match(r'^set\s*:\s*(.+)$', line, re.I)
            if mm:
                round_name = mm.group(1).strip()
            continue
        if not line:
            continue
        field = re.match(r'^(CHOICES|ANSWER|ACCEPT|DO NOT ACCEPT|REJECT|INVIS)\s*:\s*(.*)$', line, re.I)
        if field:
            key = field.group(1).upper()
            cur['part'] = {'CHOICES': 'choices', 'ANSWER': 'answer', 'ACCEPT': 'accept',
                           'DO NOT ACCEPT': 'reject', 'REJECT': 'reject', 'INVIS': 'invis'}[key]
            if field.group(2).strip() and cur['part'] in cur:
                cur[cur['part']].append(field.group(2).strip())
            continue
        if cur['part'] in ('body', 'answer', 'accept', 'reject'):
            cur[cur['part']].append(line)
    for b in blocks:
        body = ' '.join(b['body'])
        if b['kind'].lower() == 'multipart' or IBP_IMAGE_RE.search(body):
            skipped.append(f"{b['type']} {b['num']}: image question")
            skipped_rows.append({'type': b['type'], 'num': b['num'], 'subject': b['subject'],
                                 'question': '\n'.join(b['body']), 'answer': '; '.join(b['answer']),
                                 'accept': '; '.join(b['accept']), 'reject': '; '.join(b['reject']),
                                 'skip_reason': 'image question'})
            continue
        fmt = 'Multiple Choice' if b['kind'].lower().startswith('multiple choice') else 'Short Answer'
        first, rest = (b['body'][0], b['body'][1:]) if b['body'] else ('', [])
        ans = '; '.join(b['answer'])
        if b['accept']:
            ans += ' (ACCEPT: ' + '; '.join(b['accept']) + ')'
        if b['reject']:
            ans += ' (DO NOT ACCEPT: ' + '; '.join(b['reject']) + ')'
        out += [b['type'], f"{b['num']}) {b['subject']} - {fmt} {first}", *rest, f'ANSWER: {ans}']
    return round_name, out, skipped, skipped_rows


def strip_running_lines(pages):
    """Drop lines that recur at the top/bottom of many pages (headers, footers, page numbers).

    Only the first and last few lines of each page are candidates, so repeated question
    content ("W) 30") in the middle of a page is never removed."""
    key = lambda s: re.sub(r'\d+', '#', s.strip().lower())
    edge = lambda p: set(range(min(3, len(p)))) | set(range(max(0, len(p) - 3), len(p)))
    counts = collections.Counter()
    for p in pages:
        for k in set(key(p[i]) for i in edge(p)):
            counts[k] += 1
    thresh = max(3, 0.3 * len(pages))
    out = []
    for p in pages:
        e = edge(p)
        for i, l in enumerate(p):
            l = re.sub(r'\s*[~=_*]{5,}\s*$', '', l)  # trailing "~~~~~~" separators
            if not l.strip() or re.fullmatch(r'[\s~=_*\-–—.·•]{5,}', l):
                continue
            if re.match(r'^\s*©', l):
                continue  # "© LOST ROUND 1 (Nat. RR1) PAGE"
            if len(l) < 120 and re.search(r'\b(?:round|tiebreak|packet|invitational|bowl)\b.*\bpage\s*\d+(?:\s*of\s*\d+)?\s*$', l, re.I):
                continue  # a page footer, even in a packet too short for repeated-line detection
            k = key(l)
            if i in e and not ANSWER_RE.match(l) and not HEADER_RE.match(l) and not QSTART_RE.match(l) \
                    and not re.match(r'^\(?[wxyz]\)|^#\)', k):
                if counts[k] >= thresh or re.fullmatch(r'(page\s*)?#(\s*(of|/)\s*#)?', k):
                    continue
            out.append(l)
    return out


# ---------------------------------------------------------------------------
# 2. Parsing questions
# ---------------------------------------------------------------------------

def dehyphen(a, b):
    """Join two wrapped lines, removing a line-end hyphen when it splits one word."""
    m = re.search(r'([A-Za-z]+)-$', a)
    n = re.match(r'([a-z]+)', b)
    if m and n:
        whole = m.group(1) + n.group(1)
        if zipf_frequency:
            joined = zipf_frequency(whole.lower(), 'en')
            parts = min(zipf_frequency(m.group(1).lower(), 'en'), zipf_frequency(n.group(1).lower(), 'en'))
            if joined >= 1.5 and (joined >= parts or parts < 2.5):
                return a[:-1] + b
        return a + b  # keep the hyphen, no space ("high-scoring")
    return a + ' ' + b


def join_body(lines):
    """Join wrapped lines; keep numbered statements and MC options on their own lines."""
    out = []
    for l in lines:
        l = l.strip()
        if not l:
            continue
        if not out or re.match(r'^(\d{1,2}\)|[WXYZwxyz] ?\)|[WXYZ]\.\s)\s?', l) or re.match(r'^\(?[WXYZ]\)', l) or re.match(r'^(?:[IVX]{1,4})\.\s', l):
            out.append(l)
        else:
            out[-1] = dehyphen(out[-1], l)
    return out


def split_inline_statements(text):
    """'...: 1) A; 2) B; 3) C.' -> lines '1) A', '2) B', '3) C'."""
    m = re.search(r'(?:(?<=:)|(?<=\?)|(?<=\.))\s+1\)\s', text)
    if not m or '\n1) ' in text:
        return text
    head, tail = text[:m.start()].rstrip(), text[m.start():].strip()
    # find 2), 3) ... in order, preceded by ';' or ',' or whitespace
    parts, pos, k = [], 0, 2
    starts = [0]
    while True:
        mm = re.compile(r'[;,]?\s+' + str(k) + r'\)\s').search(tail, starts[-1] + 2)
        if not mm:
            break
        starts.append(mm.start()); k += 1
    if len(starts) < 2:
        return text
    starts.append(len(tail))
    items = []
    for s, e in zip(starts, starts[1:]):
        seg = tail[s:e].strip().lstrip(';,').strip()
        items.append(seg.rstrip(';,').strip())
    return head + '\n' + '\n'.join(items)


def split_options(body_lines):
    """Return stem, [w,x,y,z] (or None)."""
    text = '\n'.join(body_lines)
    pos = []
    start = 0
    for L in 'WXYZ':
        m = re.compile(r'(?:^|\n|\s)\(?' + L + r'\)\s*|(?:^|\n)\(?' + L + r' \)\s*|(?:^|\n)\(?' + L.lower() + r' ?\)\s*'
                       r'|(?:^|\n)' + L + r'\.\s+').search(text, start)
        if not m:
            return _split_options_inline_dotted(text)
        pos.append((m.start(), m.end()))
        start = m.end()
    stem = text[:pos[0][0]].strip()
    opts = []
    for k in range(4):
        end = pos[k + 1][0] if k < 3 else len(text)
        opts.append(re.sub(r'\s*\n\s*', ' ', text[pos[k][1]:end]).strip())
    return stem, opts


def _split_options_inline_dotted(text):
    """Options run together and marked "W. 32 X. 36 Y. 45 Z. 49" or "W: ... X: ..." (all four, in order)."""
    pos, start = [], 0
    for L in 'WXYZ':
        m = re.compile(r'(?:^|\n|\s)' + L + r'[.:]\s+').search(text, start)
        if not m:
            return text, None
        pos.append((m.start(), m.end()))
        start = m.end()
    opts = [re.sub(r'\s*\n\s*', ' ', text[pos[k][1]:(pos[k + 1][0] if k < 3 else len(text))]).strip() for k in range(4)]
    return text[:pos[0][0]].strip(), opts


# Writer/editor tags at the end of an answer: "[OW]", "[YL MDE]", "[ArK]", "[MS/TD] REO",
# "[W: OW, E: EB; RR Bio-G]". They go to notes, not the answer.
AUTHOR_RE = re.compile(r'\s*\[((?:[A-Z][a-z]?[A-Z]{1,3})(?:[\s,/]+[A-Z][a-z]?[A-Z]{1,3})*|[WE]:[^\]]*)\]'
                       r'((?:\s*\[[^\]]{1,25}\]|\s+[A-Z][A-Z&/-]{1,10}|\s+\d{1,2})*)\s*\.?\s*$')  # + "[gases]", "MDRN 5"


VULGAR = {'¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5',
          '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'}


def parse_answer(raw):
    # Fraction characters (¾) become 3/4 so typed answers can match them.
    raw = re.sub('[' + ''.join(VULGAR) + ']', lambda m: VULGAR[m.group(0)], raw)
    ans = re.sub(r'\s+', ' ', raw).strip()
    ans = re.sub(r'^(?:answer|ans)\s*[:.]\s*', '', ans, flags=re.I)  # "ANSWER: Answer: ..."
    notes = []
    # Trailing metadata, in any order: footnotes, notes, worked solutions, writer credits and tags.
    TRAILERS = [
        (r'\s*\$\^\{\d\}\$\s+([A-Z][^\[\]]{15,})$', 0, lambda m: 'footnote: ' + m.group(1).strip()),  # "1 ONLY $^{1}$ Answer choice Y ..."
        (r'\s*\(\s*Note[^:]*:\s*(.+)\)\s*$', re.I, lambda m: 'note: ' + m.group(1).strip()),
        (r'\s*\(?Solution\s*:\s*(.+?)\)?\s*$', re.I, lambda m: 'solution: ' + m.group(1).strip()),
        (r'\s*(?:Written|Edited)\s+by\s*:?\s*(.+)$', re.I, lambda m: 'writer: ' + m.group(1).strip()),  # "2 ONLY Written by: name"
        (r'\s*\[(\d+\s*,\s*[A-Z][A-Za-z ]*)\]\s*([A-Z][\w.\- ]{0,25})?\s*$', 0,                      # "EUROPA [2, SPACE] Eric"
         lambda m: f'tag: {m.group(1)}' + (f'; writer: {m.group(2).strip()}' if m.group(2) else '')),
        (r'\s+([A-Za-z0-9_.]{2,32}#\d{4})\s*$', 0, lambda m: 'writer: ' + m.group(1)),                     # Discord handle
        (r'\s*\[([A-Z][a-z]?[A-Z]{1,3}(?:\s*/\s*[A-Z][a-z]?[A-Z]{1,3})*)\s*,\s*([^\]]{1,400})\]\s*$', 0,     # "[DJ, Biomolecules]"
         lambda m: f'writer: {m.group(1)} ({m.group(2).strip()})'),
        (AUTHOR_RE.pattern, 0, lambda m: 'writer: ' + m.group(1) + (f' ({m.group(2).strip()})' if (m.group(2) or '').strip() else '')),
        (r'\s*\[([^\[\]]{1,40}),\s*([A-Z][a-z]?[A-Z]{1,3})\]\s*$', 0, lambda m: f'writer: {m.group(2)} ({m.group(1).strip()})'),  # "[Geometry, GW]"
        (r'\s*\[([A-Z][a-z]?[A-Z]{1,3}(?:\s*[+&]\s*[A-Z][a-z]?[A-Z]{1,3})+)\]\s*$', 0, lambda m: 'writer: ' + m.group(1)),     # "[WC + QG]"
        (r'\s*\[((?:ChatGPT|Gemini|Claude|GPT|AI)\b[^\]]{0,20})\]\s*$', re.I, lambda m: 'writer: ' + m.group(1)),           # "[ChatGPT/AE]"
        (r'\s*\[([a-z][a-z &/.-]{1,24})\]\s*$', 0, lambda m: 'tag: ' + m.group(1)),  # "[stoich]"
        (r'(?<=\S)\s*\[([A-Z][a-z]+(?:[\s-][A-Z][a-z]+){1,2})\]\s*\.?\s*$', 0, lambda m: 'writer: ' + m.group(1)),  # "GAS [Lishan Prado]"
        (r'(?<=\S)\s*\[((?:[A-Z]\.\s?){1,3}[A-Z]?)\]\s*\.?\s*$', 0, lambda m: 'writer: ' + m.group(1).strip()),  # "6 [Y.L.]", "[E.Z]"
    ]
    changed = True
    while changed and ans:
        changed = False
        for pat, flags, fn in TRAILERS:
            m = re.search(pat, ans, flags)
            if m:  # (a line holding only a writer tag leaves no answer, which is then reported)
                notes.insert(0, fn(m))
                ans = ans[:m.start()].strip()
                changed = True
    accept, reject = [], []

    def grab(m):
        kind, body = m.group(1).upper(), m.group(2).strip()
        # "ACCEPT: X; DO NOT ACCEPT: Y" in one bracket
        sub = re.split(r'[;,]?\s*DO NOT ACCEPT\s*:?', body, flags=re.I)
        if 'DO NOT' in kind or 'REJECT' in kind:
            reject.extend(_split_alts(body))
        else:
            accept.extend(_split_alts(sub[0]))
            for r in sub[1:]:
                reject.extend(_split_alts(r))
        return ''
    ans = re.sub(r'\(\s*((?:ALSO\s+)?ACCEPT|DO NOT ACCEPT|REJECT)\s*:?\s*([^()]*(?:\([^()]*\)[^()]*)*)\)', grab, ans, flags=re.I)
    ans = re.sub(r'\[\s*((?:ALSO\s+)?ACCEPT|DO NOT ACCEPT|REJECT)\s*:?\s*([^\[\]]*)\]', grab, ans, flags=re.I)
    m2 = re.search(r'[;,]?\s*\b((?:ALSO\s+)?ACCEPT|DO NOT ACCEPT)\s*:\s*(.*)$', ans, re.I)
    if m2:
        grab(m2); ans = ans[:m2.start()]
    ans = re.sub(r'\s+', ' ', ans).strip().rstrip(';,').strip()
    return ans, accept, reject, notes


def _split_alts(s):
    s = re.sub(r'(?:any\s+)?equivalents?\s*,?\s*(?:such\s+as|e\.?g\.?|like)\s*:?\s*', '', s, flags=re.I)  # "EQUIVALENTS, SUCH AS x"
    s = s.strip().rstrip('.').strip()
    if not s:
        return []
    if ';' in s:
        parts = s.split(';')
    elif re.fullmatch(r'[\d\s,andAND]+', s):  # "1, 2, 3" style answers stay whole
        parts = [s]
    else:
        parts = re.split(r'(?<!\d),\s*|(?<=\d),\s+|,(?!\d)\s*|\s+(?:OR|or)\s+', s)  # "1,3-pentadiene" stays whole
    parts = [re.sub(r'^(?:any\s+)?equivalents?\s*,?\s*(?:such\s+as|e\.?g\.?|like)\s*:?\s*', '', p.strip(), flags=re.I) for p in parts]
    # "or equivalent" isn't an answer someone types
    return [p for p in parts if p and not re.fullmatch(r'(?:any\s+|other\s+|an?\s+)?(?:equivalents?|equivalent\s+(?:answers?|expressions?|forms?))\.?', p, re.I)]


_FMT_NC = r'(?i:Short\s*Answer|Mul\s?tiple\s*Choice)'
_INLINE_Q = re.compile(r'(?<=\S)\s*(?=\b\d{1,2}\)\s*(?i:' + SUBJ_RE + r')(?![A-Za-z])\s*[-–—:]?\s*' + _FMT_NC + ')'
                       r'|(?<=\S)\s+(?=(?:Toss[\s-]*up|TOSS[\s-]*UP|Bonus|BONUS)\s+(?i:' + SUBJ_RE + r')(?![A-Za-z]))'
                       r'|(?<=\S)\s+(?=\d{1,2}\s*\)\s*(?:Toss[\s-]*up|TOSS[\s-]*UP|Bonus|BONUS)\s*[-–—:])')


def parse_lines(lines):
    """Yield raw question dicts from a flat list of lines."""
    qs, cur, pending_type, pending_num, section = [], None, None, None, 'body'
    section_subject, repl_for = None, None  # subject named by a sheet heading ("Replacements - Biology")
    # A question that runs straight on from the previous answer ("...DECREASES9) Earth and Space - Short Answer")
    lines = [part for l in lines for part in _INLINE_Q.split(l) if part]
    lines = [part for l in lines for part in re.split(r'(?<=[?.)])\s+(?=ANSWER\s*:)', l) if part]  # "...? ANSWER: 3"
    # A radical drawn on the next line ("√ BONUS" after "ANSWER: 3"): put it back on the answer.
    for i in range(1, len(lines)):
        m = re.match(r'^\s*√\s+(\S.*)$', lines[i])
        if m and HEADER_RE.match(m.group(1)) and ANSWER_RE.match(lines[i - 1]):
            lines[i - 1] = re.sub(r'(\S+)\s*$', r'√\1', lines[i - 1])
            lines[i] = m.group(1)
    for li, raw in enumerate(lines):
        line = raw.strip()
        if (cur is not None and section == 'body' and HEADER_RE.match(line) and li + 1 < len(lines)
                and ANSWER_RE.match(lines[li + 1])):
            continue  # "TOSS-UP" printed between a question and its answer (page break): not a new question
        hd = SUBJECT_HEADING_RE.match(line)
        if hd and (cur is None or section == 'answer'):
            section_subject = hd.group(1)
            if cur:
                qs.append(cur); cur = None
            continue
        v = VISUAL_LINE_RE.match(line)
        if v and not QSTART_COMBO_RE.match(line):
            # "Visual Bonus Biology" with no format: an image question; keep its place so its
            # text and answer don't run into the question before it, then skip it.
            if cur:
                qs.append(cur)
            cur = {'replacement_for': None, 'num': int(v.group(1)) if v.group(1) else None, 'subject': 'General Science',
                   'format': 'Short Answer', 'type': 'VISUAL', 'body': [], 'answer': []}
            pending_type, pending_num, section = None, None, 'body'
            continue
        c = QSTART_COMBO_RE.match(line)
        if c:
            word = c.group(2).upper().replace(' ', '').replace('-', '')
            pending_type = 'VISUAL' if word.startswith('VISUAL') else ('BONUS' if word == 'BONUS' else 'TOSS-UP')
            num, subj, rest = c.group(1) or c.group(3), c.group(4), c.group(6)
            fmt = None if not c.group(5) else 'Multiple Choice' if c.group(5).lower().startswith('m') else 'Short Answer'
            q = c
        else:
            h = HEADER_RE.match(line)
            if h and not QSTART_RE.match(line):
                word = h.group(1).upper().replace(' ', '').replace('-', '')
                pending_type = 'VISUAL' if word.startswith(('VISUAL', 'VISHWAL', 'AUDI')) else ('BONUS' if word == 'BONUS' else 'TOSS-UP')
                pending_num = h.group(2)
                rest = h.group(3).strip()
                if cur:
                    qs.append(cur); cur = None
                if not rest:
                    continue
                line = rest
            q = QSTART_RE.match(line)
            fmt = None
            if q:
                fmt = 'Multiple Choice' if q.group(3).lower().startswith('m') else 'Short Answer'
                num, subj, rest = q.group(1), q.group(2), q.group(4)
                if num is None and pending_type is None:
                    q = None  # an unnumbered "Physics - Short Answer" only counts right after a header
            elif pending_type is not None:
                q = QSTART_NOFMT_RE.match(line)
                if q:
                    num, subj, rest = q.group(1), q.group(2), q.group(3)
            if not q:
                q = QSTART_OTHER_RE.match(line)
                if q:
                    fmt = 'Multiple Choice' if q.group(3).lower().startswith('m') else 'Short Answer'
                    num, subj, rest = q.group(1), q.group(2), q.group(4)
            if not q and pending_type is not None:
                q = QSTART_OTHER_NONUM_RE.match(line)  # "DUALITY, SHORT ANSWER ..." under "TOSSUP 21"
                if q:
                    fmt = 'Multiple Choice' if q.group(2).lower().startswith('m') else 'Short Answer'
                    num, subj, rest = None, q.group(1), q.group(3)
            if not q:
                t1 = QSTART_TYPE_ONLY_RE.match(line)
                if t1:
                    q = t1
                    pending_type = 'BONUS' if t1.group(2).upper().startswith('B') else 'TOSS-UP'
                    num, subj, rest, fmt = t1.group(1), 'Bonus' if pending_type == 'BONUS' else 'General Science', t1.group(3), None
            if not q and section_subject:
                q = QSTART_REPL_RE.match(line)  # "HS DE3 TOSSUP, MULTIPLE CHOICE ..." on a replacements sheet
                if q:
                    word = q.group(2).upper().replace(' ', '').replace('-', '')
                    pending_type = 'BONUS' if word == 'BONUS' else 'TOSS-UP'
                    fmt = 'Multiple Choice' if q.group(3).lower().startswith('m') else 'Short Answer'
                    num, subj, rest = None, section_subject, q.group(4)
                    repl_for = re.sub(r'\s+', ' ', q.group(1) or '').strip()
            if q and not num and pending_num:
                num = pending_num  # "TOSSUP 1" on the line above
        if q:
            if cur:
                qs.append(cur)
            cur = {'replacement_for': repl_for,
                   'num': int(num) if num and num.isdigit() else None,
                   'subject': SUBJ_MAP.get(re.sub(r'\s+', ' ', subj.upper()), subj.title()),
                   'format': fmt, 'type': pending_type, 'body': [rest] if rest.strip() else [], 'answer': []}
            pending_type, pending_num, section, repl_for = None, None, 'body', None
            continue
        if cur is None:
            continue
        if section == 'answer' and re.fullmatch(r'(?:' + SUBJ_RE + r')\s*(?:questions?)?', line, re.I):
            continue  # a section heading like "Chemistry" between questions
        a = ANSWER_RE.match(line)
        if a and section == 'body':
            section = 'answer'
            cur['answer'].append(a.group(1))
            continue
        cur[section].append(line)
    if cur:
        qs.append(cur)
    return qs


def _norm(t):
    t = re.sub(r'\[[^\]]*\]|\((?:read|pronounced)[^)]*\)|\([A-Za-z]+(?:-[A-Za-z]+)+\)', ' ', t, flags=re.I)  # pronunciations
    t = re.sub(r'\\(?:text|frac|mathrm)|[${}^_]', '', t)
    return re.sub(r'[^a-z0-9]', '', t.lower())


def _same(a, b):
    a, b = _norm(a), _norm(b)
    if not a or not b or a == b or a in b or b in a:
        return True
    import difflib
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.88


def build_rows(qs, meta, keep_skipped=None):
    """Rows for one packet. With keep_skipped (a list), questions that are skipped (visual
    bonuses) are still read and appended to it as rows with a 'skip_reason' (review queue)."""
    rows, problems, skipped = [], [], []
    seen = collections.Counter()
    # Unnumbered questions (Word auto-numbering, replacement sheets): number them in order,
    # giving each bonus the number of the toss-up before it.
    last_tu, expect, tu_subject = 0, 'TOSS-UP', {}
    for q in qs:
        t = q['type'] or expect
        if q['num'] is None:
            q['num'] = last_tu + 1 if t == 'TOSS-UP' else max(last_tu, 1)
            q['type'] = t
        if t == 'TOSS-UP':
            last_tu = q['num']
        expect = 'BONUS' if t == 'TOSS-UP' else 'TOSS-UP'
    for q in qs:
        # Types: printed header if present, else first of a number = toss-up, second = bonus.
        typ = q['type'] or ('TOSS-UP' if seen[q['num']] == 0 else 'BONUS')
        seen[q['num']] += 1
        tag = f"{meta['round']} #{q['num']} {typ}"
        if typ == 'TOSS-UP':
            tu_subject[q['num']] = q['subject']
        elif q['subject'].lower().replace('-', '') in ('bonus', 'tossup', 'toss up', 'visual bonus'):
            q['subject'] = tu_subject.get(q['num'], 'General Science')  # subject left out: same as its toss-up
        if q['subject'] not in KNOWN_SUBJECTS:
            q['subject'] = 'General Science'  # a tournament's own category, e.g. "BUMS Special"
        skip_reason = None
        if typ == 'VISUAL':
            skipped.append(f'{tag}: visual bonus (needs the image)')
            skip_reason = 'visual bonus (needs the image)'
            if keep_skipped is None:
                continue
        body = join_body(q['body'])
        if not skip_reason and typ in ('BONUS', 'TOSS-UP') and re.search(r'\bnext (?:bonus|toss-?up) is (?:a )?visual|\bvisual bonus\b', ' '.join(body)[:200], re.I):
            skipped.append(f'{tag}: visual question (needs the image)')
            skip_reason = 'visual question (needs the image)'
            if keep_skipped is None:
                continue
        problems_before = len(problems)
        notes = [f"replacement for {q['replacement_for']}"] if q.get('replacement_for') else []
        w = x = y = z = ''
        fmt = q['format']
        if fmt is None:  # not printed: decide from whether W/X/Y/Z options are there
            fmt = 'Multiple Choice' if split_options(body)[1] else 'Short Answer'
            notes.append('format not printed; inferred')
        if fmt == 'Multiple Choice':
            stem, opts = split_options(body)
            if opts:
                w, x, y, z = opts
            else:
                fmt = 'Short Answer'
                notes.append('printed as Multiple Choice but has no W/X/Y/Z options; imported as Short Answer')
                problems.append(f'{tag}: printed as Multiple Choice with no W/X/Y/Z options -> imported as Short Answer')
        else:
            stem = '\n'.join(body)
        stem = split_inline_statements(re.sub(r'[ \t]+', ' ', stem).strip())
        answer, accept, reject, anotes = parse_answer(' '.join(join_body(q['answer'])))
        notes += anotes
        if not stem:
            problems.append(f'{tag}: empty question text')
        if not answer:
            problems.append(f'{tag}: no ANSWER line found')
        if fmt == 'Multiple Choice' and answer:
            opts = [w, x, y, z]
            answer = re.sub(r'^\(?\s*([WXYZwxyz])\s*(?:[):]|\.(?=\s))\s*', lambda m: m.group(1).upper() + ') ', answer).strip()
            answer = re.sub(r'^([WXYZ])\s*\((.*)\)\s*$', r'\1) \2', answer)  # "W (CONVERGENT)"
            tagm = re.fullmatch(r'([WXYZ])\s*\[([^\]]{1,12})\]', answer)  # "Y [E.Z]": a writer tag after the letter
            if tagm:
                notes.append('writer: ' + tagm.group(2)); answer = tagm.group(1)
            m = re.match(r'^\(?([WXYZ])\)', answer)
            bare = re.fullmatch(r'\(?([WXYZwxyz])\)?[.\s‘’\'"]*', answer.strip())
            if bare:  # "ANSWER: Y" -> "Y) <option text>"
                L = bare.group(1).upper()
                answer = f'{L}) {opts["WXYZ".index(L)]}'
            elif not m:
                hits = [i for i, o in enumerate(opts) if _norm(o) == _norm(answer)]
                if len(hits) == 1:
                    L = 'WXYZ'[hits[0]]
                    notes.append(f'packet answer had no letter; matched option {L}')
                    answer = f'{L}) {answer}'
                else:
                    problems.append(f'{tag}: MC answer "{answer[:50]}" has no letter and matches no option')
            else:
                opt = opts['WXYZ'.index(m.group(1))]
                at = answer[m.end():].strip()
                if at and not _same(at, opt):
                    others = [ 'WXYZ'[i] for i, o in enumerate(opts) if _same(at, o)]
                    hint = f' (text matches option {others[0]})' if others else ''
                    problems.append(f'{tag}: answer letter {m.group(1)} but text "{at[:45]}" differs from that option{hint}')
                    notes.append('answer letter and text disagree in the packet' + hint)
        if len(answer) > 160:
            problems.append(f'{tag}: very long answer (possible stray text): {answer[:80]}...')
        row = {'id': '', 'set': meta['set'], 'year': meta['year'], 'level': meta['level'],
               'round': meta['round'], 'num': q['num'], 'type': typ, 'subject': q['subject'],
               'format': fmt, 'question': stem, 'w': w, 'x': x, 'y': y, 'z': z,
               'answer': answer, 'accept': '; '.join(accept), 'reject': '; '.join(reject),
               'notes': '; '.join(notes)}
        if skip_reason:
            row.update(type='BONUS' if typ == 'VISUAL' else typ, skip_reason=skip_reason,
                       problems=problems[problems_before:], visual=True)
            del problems[problems_before:]   # a skipped question's problems aren't the packet's
            keep_skipped.append(row)
            continue
        rows.append(row)
    # Numbering / pairing checks
    nums = collections.defaultdict(set)
    for r in rows:
        nums[r['type']].add(int(r['num']))
    for s in skipped:
        m = re.search(r'#(\d+) (\S+)', s)
        nums['TOSS-UP' if m.group(2) == 'TOSS-UP' else 'BONUS'].add(int(m.group(1)))
    if nums['TOSS-UP']:
        allnums = nums['TOSS-UP'] | nums['BONUS']
        lo, top = min(allnums), max(allnums)
        for t in ('TOSS-UP', 'BONUS'):
            if not nums[t]:
                continue  # e.g. a seeding round of toss-ups only
            missing = sorted(set(range(lo, top + 1)) - nums[t])
            if missing:
                problems.append(f"{meta['round']}: {t.lower()} numbers missing: {missing}")
    return rows, problems, skipped


# ---------------------------------------------------------------------------
# 3. Tournament / packet metadata
# ---------------------------------------------------------------------------

def round_label(filename):
    """A short round name from the file name: 'HSBT Double Elimination 4.docx' -> 'DE4',
    'Copy of MHS Set 2 Round 5 (CB done).pdf' -> 'Round 5', 'Round 1 [RR1].pdf' -> 'RR1'."""
    stem = Path(filename).stem.strip()
    m = re.search(r'\[([^\]]+)\]', stem)
    if m:
        return m.group(1).strip()
    stem = re.sub(r'\((?:[^)]*done[^)]*|\d+)\)', '', stem, flags=re.I)   # "(CB done)", "(1)"
    stem = re.sub(r'^copy of\s+', '', stem, flags=re.I).replace('_', ' ').strip()
    pats = [
        (r'\bround\s*robin\s*(\d+)', lambda m: f'RR{m.group(1)}'),
        (r'\bdouble\s*elim(?:ination)?\s*(\d+)', lambda m: f'DE{m.group(1)}'),
        (r'\bsingle\s*elim(?:ination)?\s*(\d+)', lambda m: f'SE{m.group(1)}'),
        (r'\b(RR|DE|SE|SW)\s*(\d+)\b', lambda m: f'{m.group(1).upper()}{m.group(2)}'),
        (r'\brounds?\s*(\d+)\s*-\s*(\d+)\s*replacements?', lambda m: f'Replacements {m.group(1)}-{m.group(2)}'),
        (r'\bwildcard\s*round\s*(\d+)', lambda m: f'Wildcard {m.group(1)}'),
        (r'\bplayoffs?\s*(?:round\s*)?(\d+(?:\.\d+)?)', lambda m: f'Playoff {m.group(1)}'),
        (r'\bprelim(?:inary)?\s*(?:round\s*)?(\d+)', lambda m: f'Prelim {m.group(1)}'),
        (r'\bfinals?\s*(\d+)', lambda m: f'Finals {m.group(1)}'),
        (r'\bfinals?\b', lambda m: 'Finals'),
        (r'\bseeding\s*round\b', lambda m: 'Seeding'),
        (r'\bround\s*(\d+)\s*supplemental', lambda m: f'Round {m.group(1)} Supplemental'),
        (r'\bround\s*(\d+)', lambda m: f'Round {m.group(1)}'),
    ]
    for pat, fn in pats:
        m = re.search(pat, stem, re.I)
        if m:
            return fn(m)
    stem = re.sub(r'\s+', ' ', re.sub(r'^\d{4}\s+', '', stem)).strip()
    return re.sub(r'^[A-Z][A-Z0-9]{1,6}\s+(?=\S)', '', stem)  # "NSI2 Quarters" -> "Quarters"


def guess_set(first_lines, container_name):
    year = ''
    m = re.search(r'\b(19|20)\d{2}\b', container_name)
    if m:
        year = m.group(0)
    for l in first_lines[:6]:
        if re.search(r'science bowl|invitational|\b(19|20)\d{2}\b', l, re.I) and len(l) < 90:
            name = re.sub(r'\s*[-–—:]\s*Round\s*\w+$', '', l.strip(), flags=re.I)
            name = re.sub(r'\s+Round\s+\d+$', '', name, flags=re.I)
            if name.isupper() and not re.search(r'\d', name):
                name = name.title().replace('Mit ', 'MIT ')
            if not re.search(r'\b(19|20)\d{2}\b', name) and year:
                name = f'{year} {name}'
            y = re.search(r'\b(19|20)\d{2}\b', name)
            return name, (y.group(0) if y else year)
    base = re.sub(r'-\d{8}T\d+Z.*$', '', container_name)
    base = re.sub(r'\[.*?\]|\b(public|release|packets?|published)\b', '', base, flags=re.I)
    return re.sub(r'\s+', ' ', base).strip(), year


def iter_container(path):
    """Yield (name, bytes) for packet files inside a zip/folder/single file."""
    p = Path(path)
    if p.is_dir():
        for f in sorted(p.rglob('*')):
            if f.is_file():
                yield str(f.relative_to(p)), f.read_bytes()
    elif p.suffix.lower() == '.zip':
        with zipfile.ZipFile(p) as z:
            for n in sorted(z.namelist()):
                if not n.endswith('/'):
                    yield n, z.read(n)
    else:
        yield p.name, p.read_bytes()


def natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]


def read_tournament(path, keep_skipped=False):
    """keep_skipped: also return result['skipped_rows'] (skipped questions with their text,
    each tagged with 'file') for the review queue."""
    files, other = [], []
    for name, data in iter_container(path):
        base = Path(name).name
        ext = Path(name).suffix.lower()
        if base.startswith(('!', '~$', '.')) or 'readme' in base.lower():
            other.append((name, 'skipped: readme/hidden')); continue
        if ext in ('.pdf', '.docx', '.txt', '.ibp'):
            files.append((name, ext, data))
        else:
            other.append((name, f'skipped: {ext or "no extension"} file (not a packet format this reader handles)'))
    files.sort(key=lambda f: natural_key(f[0]))
    container = Path(path).stem
    result = {'container': Path(path).name, 'packets': [], 'other_files': other, 'rows': [], 'skipped_rows': []}
    meta_set = None
    for name, ext, data in files:
        pk = {'file': name, 'status': 'ok', 'questions': 0, 'tossups': 0, 'bonuses': 0,
              'answer_lines': 0, 'problems': [], 'skipped': []}
        try:
            if ext == '.pdf':
                pages = pdf_pages(data)
            elif ext == '.docx':
                pages = docx_pages(data)
            elif ext == '.ibp':
                ibp_round, ibp_lines, ibp_skipped, ibp_skipped_rows = ibp_packet(data.decode('utf-8', 'replace'))
                pages = [ibp_lines]
            else:
                pages = [data.decode('utf-8', 'replace').splitlines()]
            if sum(len(p) for p in pages) == 0:
                raise ValueError('no text layer (scanned image PDF?)')
            if meta_set is None:
                meta_set = guess_set(pages[0], container)
            meta = {'set': meta_set[0], 'year': meta_set[1],
                    'level': 'MS' if re.search(r'middle\s*school', ' '.join(pages[0][:5]) + container, re.I) else 'HS',
                    'round': round_label(name)}
            if ext == '.ibp':
                if ibp_round:
                    meta['round'] = round_label(ibp_round)
                lines = pages[0]
            else:
                lines = strip_running_lines(pages)
            pk['answer_lines'] = sum(1 for l in lines if ANSWER_RE.match(l))
            qs = parse_lines(lines)
            kept = [] if keep_skipped else None
            rows, problems, skipped = build_rows(qs, meta, kept)
            if keep_skipped:
                if ext == '.ibp':
                    kept += [dict(r, set=meta['set'], year=meta['year'], level=meta['level'], round=meta['round'],
                                  format='Short Answer', visual=True) for r in ibp_skipped_rows]
                for r in kept:
                    r['file'] = name
                result['skipped_rows'] += kept
            pk['questions'] = len(rows)
            pk['tossups'] = sum(r['type'] == 'TOSS-UP' for r in rows)
            pk['bonuses'] = sum(r['type'] == 'BONUS' for r in rows)
            if ext == '.ibp':
                skipped = ibp_skipped + skipped
                pk['answer_lines'] += len(ibp_skipped)
            pk['problems'], pk['skipped'] = problems, skipped
            if not rows and not skipped and pk['answer_lines'] == 0:
                pk['status'] = 'not a packet'  # e.g. a writers list
            elif not rows:
                pk['status'] = 'failed'
                pk['problems'].insert(0, 'no questions recognized')
            elif len(rows) + len(skipped) < pk['answer_lines']:
                pk['status'] = 'partial'
                pk['problems'].insert(0, f"{pk['answer_lines'] - len(rows) - len(skipped)} ANSWER lines not matched to a question")
            elif problems:
                pk['status'] = 'ok with warnings'
            for r in rows if keep_skipped else ():
                r['file'] = name
            result['rows'].extend(rows)
        except Exception as e:  # keep going; report it
            pk['status'] = 'failed'
            pk['problems'].append(f'{type(e).__name__}: {e}')
        result['packets'].append(pk)
    result['set'] = meta_set[0] if meta_set else container
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('paths', nargs='+')
    ap.add_argument('--out', default='parsed')
    args = ap.parse_args(argv)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    report, all_rows, used_names = [], [], set()
    for p in args.paths:
        t = read_tournament(p)
        safe = re.sub(r'[^A-Za-z0-9]+', '_', t['set']).strip('_') or 'tournament'
        if safe in used_names:  # two folders with the same printed title (e.g. HS and MS divisions)
            safe = f"{safe}_{re.sub(r'[^A-Za-z0-9]+', '_', Path(p).name).strip('_')}"
        used_names.add(safe)
        with open(out / f'{safe}.csv', 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, COLUMNS); w.writeheader(); w.writerows(t['rows'])
        all_rows += t['rows']
        report.append({k: v for k, v in t.items() if k not in ('rows', 'skipped_rows')} | {'csv': f'{safe}.csv', 'total': len(t['rows'])})
        print(f"{t['set']}: {len(t['rows'])} questions from {len(t['packets'])} packets")
    with open(out / 'all.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, COLUMNS); w.writeheader(); w.writerows(all_rows)
    (out / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
