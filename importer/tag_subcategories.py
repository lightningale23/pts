#!/usr/bin/env python3
"""Fill in the `subcategory` column of a question bank (Genetics, Optics, Calculus...).

    python importer/tag_subcategories.py data/questions.csv [--comp sb] [--all] [--write]
    python importer/tag_subcategories.py data/osb-questions.csv --comp osb --write

Packets don't print subcategories, so they are worked out from the question text:
  1. keyword scores from importer/subcategory_rules.py; a question whose best subcategory
     clearly beats the rest is a confident "seed"
  2. per subject, a text model (TF-IDF + logistic regression) is trained on the seeds and
     labels every question; seeds keep their keyword label, the rest take the model's pick
     nudged by their keyword scores
By default only rows with an empty subcategory are filled (so hand fixes and earlier tags
stay put); --all re-tags every row. Without --write it only prints counts and samples.
--comp defaults to osb when the file name contains "osb", otherwise sb.
Needs scikit-learn: pip install --break-system-packages scikit-learn
"""
import argparse, collections, csv, random, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from subcategory_rules import RULES   # noqa: E402

COLUMNS = ['id', 'set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format',
           'question', 'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes', 'subcategory']

STRONG, WEAK = 3, 1


def text_of(r):
    return ' '.join(r.get(k, '') or '' for k in ('question', 'w', 'x', 'y', 'z', 'answer', 'accept')).lower()


def compile_rules(rules):
    out = {}
    for subject, cats in rules.items():
        out[subject] = [(name, [re.compile(r'(?<![a-z])' + t) for t in strong],
                         [re.compile(r'(?<![a-z])' + t) for t in weak]) for name, strong, weak in cats]
    return out


def keyword_scores(text, cats):
    return [STRONG * sum(1 for p in s if p.search(text)) + WEAK * sum(1 for p in w if p.search(text))
            for _, s, w in cats]


def is_seed(scores):
    top = sorted(scores, reverse=True)
    return top[0] >= STRONG and top[0] >= 2 * top[1] and top[0] - top[1] >= STRONG


def tag(rows, rules):
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    import numpy as np

    rules = compile_rules(rules)
    labels, info = {}, {}
    for subject, cats in rules.items():
        idx = [i for i, r in enumerate(rows) if r['subject'] == subject]
        if not idx:
            continue
        names = [c[0] for c in cats]
        texts = [text_of(rows[i]) for i in idx]
        kw = np.array([keyword_scores(t, cats) for t in texts], dtype=float)
        seed = np.array([is_seed(s) for s in kw])
        vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, max_features=60000,
                              token_pattern=r'(?u)\b[a-z][a-z0-9\-]+\b|\\[a-z]+')
        X = vec.fit_transform(texts)
        y = kw.argmax(axis=1)
        present = sorted(set(y[seed]))
        if len(present) < 2:
            pred = kw.argmax(axis=1)
        else:
            model = LogisticRegression(C=4.0, max_iter=2000, class_weight='balanced')
            model.fit(X[seed], y[seed])
            prob = np.zeros((len(idx), len(names)))
            prob[:, model.classes_] = model.predict_proba(X)
            kwn = kw / np.maximum(kw.sum(axis=1, keepdims=True), 1)
            pred = np.where(seed, y, (prob + 0.35 * kwn).argmax(axis=1))
        for j, i in enumerate(idx):
            labels[i] = names[pred[j]]
        info[subject] = (len(idx), int(seed.sum()))
    return labels, info


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('bank')
    ap.add_argument('--comp', choices=['sb', 'osb'])
    ap.add_argument('--all', action='store_true', help='re-tag every row, not just empty ones')
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--samples', type=int, default=0, help='print N random questions per subcategory')
    a = ap.parse_args()
    comp = a.comp or ('osb' if 'osb' in Path(a.bank).name.lower() else 'sb')

    with open(a.bank, encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    labels, info = tag(rows, RULES[comp])

    changed = 0
    for i, r in enumerate(rows):
        r.setdefault('subcategory', '')
        r['subcategory'] = r['subcategory'] or ''
        new = labels.get(i, '')
        if (a.all or not r['subcategory']) and new != r['subcategory'] and (new or a.all):
            r['subcategory'] = new
            changed += 1

    counts = collections.Counter((r['subject'], r['subcategory']) for r in rows)
    for subject, (n, seeds) in info.items():
        print(f'{subject}: {n} questions, {seeds} keyword seeds ({seeds / n:.0%})')
        for name, *_ in RULES[comp][subject]:
            print(f'    {counts[(subject, name)]:6d}  {name}')
    print(f'{changed} rows {"changed" if a.write else "would change"}')

    if a.samples:
        rnd = random.Random(0)
        by = collections.defaultdict(list)
        for r in rows:
            if r['subcategory']:
                by[(r['subject'], r['subcategory'])].append(r)
        for k in sorted(by):
            print(f'\n== {k[0]} / {k[1]}')
            for r in rnd.sample(by[k], min(a.samples, len(by[k]))):
                print('  -', re.sub(r'\s+', ' ', r['question'])[:130], '|', r['answer'][:30])

    if a.write:
        with open(a.bank, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, COLUMNS); w.writeheader(); w.writerows(rows)


if __name__ == '__main__':
    main()
