"""Fits the difficulty model to the hand ratings and writes MODEL into js/difficulty.js.

  node importer/difficulty/features.mjs > /tmp/features.json
  python3 importer/difficulty/fit.py /tmp/features.json [--write]

Ridge regression (alpha picked by 10-fold cross-validation); prints how well held-out ratings
are predicted (Spearman, Pearson, mean absolute error) and the weights."""
import json, re, sys, pathlib
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold
from scipy.stats import spearmanr, pearsonr

data = json.load(open(sys.argv[1]))
names = data['features']
X = np.array([r['x'] for r in data['rows']], float)
y = np.array([r['rating'] for r in data['rows']], float)

def cv(alpha, cols=None, seeds=(0, 1, 2, 3, 4)):
    Xs = X if cols is None else X[:, cols]
    preds = np.zeros((len(seeds), len(y)))
    for k, seed in enumerate(seeds):
        for tr, te in KFold(10, shuffle=True, random_state=seed).split(Xs):
            m = Ridge(alpha=alpha).fit(Xs[tr], y[tr])
            preds[k, te] = m.predict(Xs[te])
    p = preds.mean(0)
    return spearmanr(p, y)[0], pearsonr(p, y)[0], np.abs(p - y).mean(), p

best = max((cv(a)[0], a) for a in [0.1, 0.3, 1, 2, 3, 5, 8, 12, 20])
alpha = best[1]
s, r, mae, held = cv(alpha)
print(f'alpha {alpha}: held-out Spearman {s:.3f}, Pearson {r:.3f}, MAE {mae:.2f} (ratings sd {y.std():.2f})')
base = [names.index(n) for n in ['ms', 'bonus', 'mc', 'early', 'mid', 'late', 'other']]
print('  format/level/stage only: Spearman %.3f' % cv(alpha, base)[0])
model = Ridge(alpha=alpha).fit(X, y)
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
