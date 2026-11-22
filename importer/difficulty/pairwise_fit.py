"""Turns the judge's comparisons (pairwise.mjs) into ratings on the rubric's scale. For a question
with rating t compared with an anchor rated r:

    P(judged harder) = 1 / (1 + exp(-((t - r) / s + beta * order)))

s (how sharply the judge tells ratings apart) and beta (its preference for the first or second
question shown; order = +1 when the question came first, -1 when second) are shared by all
comparisons; t is fitted per question with a weak normal prior around the anchors' mean.

  python3 importer/difficulty/pairwise_fit.py

Validation comparisons (pairwise.mjs --validate) rate anchors from the other anchors only: their
ratings are checked against the hand ratings (Spearman, mean absolute error). The current
model's held-out Spearman (fit.py) is the bar to clear. The other questions' ratings are written
to importer/difficulty/pairwise-ratings.txt (`id rating comparisons`), which features.mjs adds to
fit.py's training labels at a lower weight than hand ratings."""
import glob, json, pathlib, sys
from collections import defaultdict
import numpy as np
from scipy.optimize import minimize
from scipy.stats import spearmanr

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = ROOT / 'importer' / 'difficulty'
rows = []
for f in sorted(glob.glob(str(HERE / 'runs' / 'pairwise-*.jsonl'))):
    for line in open(f):
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
if not rows:
    sys.exit('No comparisons in importer/difficulty/runs/ (run pairwise.mjs first).')

ids = json.load(open(HERE / 'sample-ids.json'))
hand = {}
for line in open(HERE / 'ratings.txt'):
    if line.strip():
        i, r = line.split(); hand[ids[int(i)]] = float(r)
mean = float(np.mean(list(hand.values())))

keys = sorted({(r['t'], int(r.get('v', 0))) for r in rows})
ki = {k: i for i, k in enumerate(keys)}
T = np.array([ki[(r['t'], int(r.get('v', 0)))] for r in rows])
R = np.array([r['ar'] for r in rows], float)
O = np.array([1.0 if r['tf'] else -1.0 for r in rows])
Y = np.array([r['win'] for r in rows], float)
n = len(keys)

def loss(x):
    t, ls, beta = x[:n], x[n], x[n + 1]
    s = np.exp(ls)
    z = (t[T] - R) / s + beta * O
    p = 1 / (1 + np.exp(-z))
    ll = (Y * np.log(p + 1e-12) + (1 - Y) * np.log(1 - p + 1e-12)).sum()
    lp = -((t - mean) ** 2).sum() / (2 * 3.0 ** 2) - (ls - np.log(1.5)) ** 2 / 2 - beta ** 2 / 2
    d = Y - p
    gt = np.bincount(T, d / s, n) - (t - mean) / 9.0
    gls = (d * -(t[T] - R) / s).sum() - (ls - np.log(1.5))
    gb = (d * O).sum() - beta
    return -(ll + lp), -np.concatenate([gt, [gls, gb]])

x0 = np.concatenate([np.full(n, mean), [np.log(1.5), 0.0]])
res = minimize(loss, x0, jac=True, method='L-BFGS-B')
t, s, beta = res.x[:n], float(np.exp(res.x[n])), float(res.x[n + 1])
count = np.bincount(T, minlength=n)
print(f'{len(rows)} comparisons, {n} questions; judge sharpness s = {s:.2f} rating points, '
      f'first-slot bias {beta:+.2f}; {np.mean(Y):.0%} judged harder than their anchor')
# Consistency: how often the two orders of one pair agree.
pair = defaultdict(dict)
for r in rows: pair[(r['t'], r['a'])][r['tf']] = r['win']
both = [v for v in pair.values() if len(v) == 2]
if both:
    print(f'the two orders of a pair agree {np.mean([v[0] == v[1] for v in both]):.0%} of the time ({len(both)} pairs)')

val = [(k, t[i]) for k, i in ki.items() if k[1] == 1 and k[0] in hand]
if val:
    placed = np.array([v for _, v in val]); truth = np.array([hand[k[0]] for k, _ in val])
    print(f'VALIDATION on {len(val)} hand-rated questions: Spearman {spearmanr(placed, truth)[0]:.3f}, '
          f'MAE {np.abs(placed - truth).mean():.2f} (hand ratings sd {truth.std():.2f}). '
          'Worth adding as labels if this is near or above the model\'s held-out Spearman (fit.py prints it).')

out = [(k[0], t[i], count[i]) for k, i in ki.items() if k[1] == 0]
if out:
    with open(HERE / 'pairwise-ratings.txt', 'w') as f:
        for q, v, c in sorted(out):
            f.write(f'{q} {v:.2f} {c}\n')
    print(f'wrote importer/difficulty/pairwise-ratings.txt ({len(out)} questions)')
