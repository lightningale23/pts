#!/usr/bin/env python3
"""Tidy LaTeX that packet readers get wrong. Safe to run on a whole bank (it only touches what
it recognizes, and running it twice changes nothing more).

    python importer/fix_latex.py data/questions.csv [--write]

merge_into_bank.py runs it on new rows. What it does, in question, choices, answer, accept, reject:
  - a dollar amount becomes \\$ ("costs \\$5"), so "$2 ... $3" isn't read as math
  - Greek capitals that stand in for Latin ones in formulas (Ο, Η, Ν from some PDFs) become Latin
  - inside $...$: en dashes and minus signs become -, µ ∆ ′ ∘ × ½ become LaTeX, √3 becomes \\sqrt{3},
    a stacked charge read as a fraction (\\frac{2-}{2}) becomes _{2}^{2-}, x^{'} becomes x',
    ^{o} after a number becomes ^{\\circ}, a superscript split in two (10^{1}^{6}) is joined,
    4.6x10^{5} gets \\times, and empty _{} / ^{} are dropped
  - "20 $^{o}$C" becomes "$20^{\\circ}$C", and a script cut off from what it belongs to
    ("HA $^{-}$", "10 $^{-8}$") is put back next to it

It can't rebuild math the reader flattened ("x6-64" for x to the sixth, a limit or integral
whose bounds became a fraction, a radical whose √ landed somewhere else). Look for those by
hand after an import: KaTeX errors, (cid:NN), a stray √ at the end of a question, \\frac{..}{..}
with a → or = in it, or a [READ: ...] guide that doesn't match the math.
"""
import csv, re, sys

COLS = 'id,set,year,level,round,num,type,subject,format,question,w,x,y,z,answer,accept,reject,notes,subcategory'.split(',')
FIELDS = ['question', 'w', 'x', 'y', 'z', 'answer', 'accept', 'reject']
MATH = re.compile(r'(?<!\\)\$([^$]*[^$\\])\$')

UNI = {'–': '-', '—': '-', '−': '-', 'µ': r'\mu ', 'ɑ': r'\alpha ', '∆': r'\Delta ', '′': "'",
       '∙': r'\cdot ', '½': r'\frac{1}{2}', 'ℎ': 'h', '∘': r'\circ ', '×': r'\times '}
GREEK_LOOK = dict(zip('ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ', 'ABEZHIKMNOPTYX'))
ORPHAN = re.compile(r'(?<![^\s(\[,/])(10|[A-Za-z]|\d*[a-zA-Z]{1,2}|[A-Z][A-Za-z0-9()]{0,7}) '
                    r'\$([_^]\{(?:-?\d+|\d*[+-]|[A-Za-z]|\(n\)|-?\d+/\d+)\})\$(?![A-Za-z0-9√]| ?\$[_^])')


def escape_currency(s):
    """$5, $0.39, $1,000,000 -> \\$5 ...; real math ($10^{-8}$, $0.2 M$, $2 + 3$) is left alone."""
    out, i = '', 0
    while True:
        j = s.find('$', i)
        if j < 0:
            return out + s[i:]
        if j > 0 and s[j - 1] == '\\':
            out += s[i:j + 1]; i = j + 1; continue
        k = s.find('$', j + 1)
        while k > 0 and s[k - 1] == '\\':
            k = s.find('$', k + 1)
        inner = s[j + 1:k] if k > 0 else None
        m = re.match(r'\d[\d,]*(?:\.\d+)?', s[j + 1:])
        nxt = s[j + 1 + m.end():j + 2 + m.end()] if m else ''
        money = bool(m) and nxt not in tuple('^_{}$\\') and not nxt.isalpha()
        if money and inner is not None and (re.search(r'[\\^_{}]', inner)
                                            or re.match(r'\d[\d,.]*\s*[-+*/=<>×·]', inner)
                                            or re.fullmatch(r'\d[\d,.]*\s?[A-Za-z]{1,3}', inner)):
            money = False
        if money:
            out += s[i:j] + '\\$'; i = j + 1; continue
        if k < 0:
            return out + s[i:]
        out += s[i:k + 1]; i = k + 1


def fix_math(e):
    """e is what's inside $...$"""
    for k, v in UNI.items():
        e = e.replace(k, v)
    e = re.sub(r'(\\[a-zA-Z]+) (?=[}_^)\]{,.]|$)', r'\1', e)          # "\mu }" -> "\mu}"
    displaced = re.search(r'\\frac\{\d*?(\d+)\}\{√\1\}', e)             # "\frac{163}{√3}": the √ moved, leave it
    if not displaced:
        e = re.sub(r'√\{([^{}]*)\}', r'\\sqrt{\1}', e)
        e = re.sub(r'√(\d+|[A-Za-z])', r'\\sqrt{\1}', e)
        e = re.sub(r'\\sqrt\{\}(\d+|[A-Za-z])', r'\\sqrt{\1}', e)
    e = re.sub(r'\\frac\{(\d*[+\-])\}\{(\d+)\}', r'_{\2}^{\1}', e)      # stacked charge
    e = re.sub(r"\^\{('+)\}", r'\1', e)                                 # x^{'} -> x'
    e = re.sub(r'(\d|\))\s*\^\{o\}', r'\1^{\\circ}', e)                 # 30^{o} -> 30^{\circ}
    while re.search(r'\^\{([^{}]*)\}\^\{([^{}]*)\}', e):                # 10^{1}^{6} -> 10^{16}
        e = re.sub(r'\^\{([^{}]*)\}\^\{([^{}]*)\}', r'^{\1\2}', e)
    e = re.sub(r'(\d)\s*[xX]\s*10\^', r'\1 \\times 10^', e)             # 4.6x10^{5}
    e = re.sub(r'_\{\}|\^\{\}', '', e)                                   # empty scripts
    return e


def greek_lookalikes(s):
    # only next to Latin letters, digits or math: "ΗClΟ$_{3}$" (HClO3), not a Greek word
    near = r'[A-Za-z0-9$()\[\]]'
    return re.sub(f'(?<={near})[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]|[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ](?={near})',
                  lambda m: GREEK_LOOK[m.group()], s)


def fix_text(s):
    s = greek_lookalikes(s)
    s = escape_currency(s)
    s = MATH.sub(lambda m: f'${fix_math(m.group(1))}$' if fix_math(m.group(1)).strip() else '', s)
    s = re.sub(r'(?<![\d.$])(\d+(?:\.\d+)?) ?\$\^\{(?:o|\\circ)\}\$ ?(?=[CFK]\b)', r'$\1^{\\circ}$', s)
    prev = None
    while prev != s:
        prev = s
        s = ORPHAN.sub(lambda m: f'$10{m.group(2)}$' if m.group(1) == '10' and m.group(2)[0] == '^'
                       else f'{m.group(1)}${m.group(2)}$', s)
    return s


def apply(row):
    """Fix a row in place; returns True if anything changed."""
    changed = False
    for k in FIELDS:
        if row.get(k):
            new = fix_text(row[k])
            if new != row[k]:
                row[k] = new; changed = True
    return changed


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    bank = sys.argv[1]
    with open(bank, encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    changed = [r for r in rows if apply(r)]
    print(f'{len(changed)} rows changed')
    for r in changed[:20]:
        print(f"  {r['set']} {r['round']} #{r['num']} [{r['id']}]")
    if '--write' in sys.argv:
        with open(bank, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)


if __name__ == '__main__':
    main()
