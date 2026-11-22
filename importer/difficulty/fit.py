"""Fits the difficulty model to the hand ratings and writes MODEL into js/difficulty.js.

  node importer/difficulty/features.mjs > /tmp/features.json
  python3 importer/difficulty/fit.py /tmp/features.json [--write]

Ridge regression (alpha picked by 10-fold cross-validation); prints how well held-out ratings
are predicted (Spearman, Pearson, mean absolute error) and the weights.

Extra labels (pairwise-ratings.txt, via features.mjs) are added to every training fold at their
lower weight; scores are always measured on held-out *hand* ratings only. When the `ai` feature
(model ladder) is there, the score without it is printed too, so it's clear what it adds."""
import json, re, sys, pathlib
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold
from scipy.stats import spearmanr, pearsonr

data = json.load(open(sys.argv[1]))
names = data['features']
X = np.array([r['x'] for r in data['rows']], float)
y = np.array([r['rating'] for r in data['rows']], float)
extra = data.get('extra', [])
Xe = np.array([r['x'] for r in extra], float).reshape(len(extra), len(names))
ye = np.array([r['rating'] for r in extra], float)
we = np.array([r['weight'] for r in extra], float)
if len(extra):
    print(f'{len(y)} hand ratings + {len(extra)} pairwise ratings at weight {we.mean():.2f}')

def train(alpha, Xs, ys, Xx, cols=None):
    Xa = np.vstack([Xs, Xx if cols is None else Xx[:, cols]]) if len(extra) else Xs
    ya = np.concatenate([ys, ye]) if len(extra) else ys
    wa = np.concatenate([np.ones(len(ys)), we]) if len(extra) else None
    return Ridge(alpha=alpha).fit(Xa, ya, sample_weight=wa)

def cv(alpha, cols=None, seeds=(0, 1, 2, 3, 4)):
    Xs = X if cols is None else X[:, cols]
    preds = np.zeros((len(seeds), len(y)))
    for k, seed in enumerate(seeds):
        for tr, te in KFold(10, shuffle=True, random_state=seed).split(Xs):
            m = train(alpha, Xs[tr], y[tr], Xe, cols)
            preds[k, te] = m.predict(Xs[te])
    p = preds.mean(0)
    return spearmanr(p, y)[0], pearsonr(p, y)[0], np.abs(p - y).mean(), p

best = max((cv(a)[0], a) for a in [0.1, 0.3, 1, 2, 3, 5, 8, 12, 20])
alpha = best[1]
s, r, mae, held = cv(alpha)
print(f'alpha {alpha}: held-out Spearman {s:.3f}, Pearson {r:.3f}, MAE {mae:.2f} (ratings sd {y.std():.2f})')
base = [names.index(n) for n in ['ms', 'bonus', 'mc', 'early', 'mid', 'late', 'other']]
print('  format/level/stage only: Spearman %.3f' % cv(alpha, base)[0])
if data.get('ai'):
    no_ai = [i for i, n in enumerate(names) if n not in ('ai', 'aiMissing')]
    print('  without the model ladder (ai): Spearman %.3f' % cv(alpha, no_ai)[0])
model = train(alpha, X, y, Xe)
fitted = model.predict(X)
# Predictions regress toward the mean; stretch them so their spread on the rated sample
# matches the ratings' spread (scaled by the held-out correlation, so noise isn't amplified fully).
center = float(y.mean())
stretch = float(min(1.6, y.std() / fitted.std() * 0.85 + 0.15))
w = {n: round(float(c), 4) for n, c in zip(names, model.coef_) if abs(c) > 1e-6}
for n, c in sorted(w.items(), key=lambda t: -abs(t[1])):
    print(f'  {n:12s} {c:+.3f}')
print('stretch', round(stretch, 3), 'center', round(center, 3))
# Distribution on the banks.
for k, rows in data['bank'].items():
    p = model.predict(np.array(rows, float))
    d = center + (p - center) * stretch
    d = np.where(d >= 1, d, np.exp(d - 1))
    print(k, 'mean %.2f, pct 1/10/50/90/99/max: %s, over 10: %d' % (d.mean(), ' '.join('%.2f' % np.percentile(d, q) for q in [1, 10, 50, 90, 99, 100]), (d > 10).sum()))
# The ladder has to cover (nearly) the whole bank: rated questions all have an `ai` value, so the
# fit can't learn what to do without one, and partial coverage would squash the bank's spread.
if data.get('ai'):
    miss = names.index('aiMissing')
    for k, rows in data['bank'].items():
        cov = 1 - np.array(rows, float)[:, miss].mean()
        print(f'{k}: model ladder covers {cov:.1%} of the bank')
        if k == 'sb' and cov < 0.95 and '--write' in sys.argv and '--force' not in sys.argv:
            sys.exit('Not writing MODEL: run ladder.mjs on the whole bank first (or --force).')
if '--write' in sys.argv:
    js = pathlib.Path(__file__).resolve().parents[2] / 'js' / 'difficulty.js'
    src = js.read_text()
    m = {'intercept': round(float(model.intercept_), 4), 'weights': w, 'center': round(center, 3), 'stretch': round(stretch, 3)}
    src = re.sub(r'// MODEL-START\n.*?\n// MODEL-END', '// MODEL-START\nexport const MODEL = ' + json.dumps(m, separators=(',', ':')) + ';\n// MODEL-END', src, flags=re.S)
    js.write_text(src)
    print('wrote', js)
# Worst held-out misses, to look at.
ids = [r['id'] for r in data['rows']]
order = np.argsort(-np.abs(held - y))[:15]
print('largest held-out misses (id rating predicted):', ' '.join(f'{ids[i]}:{y[i]:g}/{held[i]:.1f}' for i in order))
