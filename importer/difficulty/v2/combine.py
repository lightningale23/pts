"""The final difficulty numbers: writes data/difficulty.csv (id,d, two decimals) from every estimate a
question has, so the site's numbers aren't stuck on the raters' half-point steps.

  python3 importer/difficulty/v2/combine.py        (after rate.mjs export / batch_api.mjs calibrate)

Estimates of one question: the Claude Code raters' rating (ratings/*.txt, 7,231 questions), Haiku's
(api/*.txt, every question; put on the raters' scale per subject by matching percentiles on the
questions both rated, like batch_api.mjs calibrate but unrounded) and the fallback model's (MODEL in
js/difficulty.js, via model_preds.mjs). How noisy each is comes from the questions that have all three
(three-way comparison: var(a-b) = var_a + var_b for independent errors); they're averaged with
inverse-variance weights, then each bank is stretched back to the ratings' own mean and spread (averaging
pulls toward the middle) and clipped at 0. The anchors keep their published ratings. Questions with no
rating at all get the model's number."""
import glob, json, pathlib, subprocess
import numpy as np
from scipy.stats import spearmanr

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]

def load(files):
    m = {}
    for f in sorted(files):
        for line in open(f):
            p = line.split()
            if len(p) == 2:
                try: m[p[0]] = float(p[1])
                except ValueError: pass
    return m

model = {i: (g, d) for i, g, d in json.loads(subprocess.run(['node', str(HERE / 'model_preds.mjs')], check=True, capture_output=True, text=True).stdout)}
raters = load(f for f in glob.glob(str(HERE / 'ratings' / '*.txt')) if not f.endswith('api-calibrated.txt'))
haiku_raw = load(glob.glob(str(HERE / 'api' / '*.txt')))
anchors = {i: float(d) for l in json.load(open(HERE / 'anchors.json')).values() for i, d, _ in l}

# Haiku on the raters' scale, per group, unrounded (past the overlap's top: in proportion).
haiku = {}
for g in sorted({g for g, _ in model.values()}):
    ov = [i for i in haiku_raw if i in raters and model.get(i, ('',))[0] == g]
    if len(ov) < 150: ov = [i for i in haiku_raw if i in raters]
    ms, hs = np.sort([haiku_raw[i] for i in ov]), np.sort([raters[i] for i in ov])
    ratio = hs.std() / ms.std()
    for i, v in haiku_raw.items():
        if model.get(i, ('',))[0] != g: continue
        if v > ms[-1]: haiku[i] = hs[-1] + (v - ms[-1]) * ratio; continue
        p = (np.searchsorted(ms, v, 'left') + np.searchsorted(ms, v, 'right')) / 2 / len(ms)
        x = min(len(hs) - 1, max(0, p * len(hs) - 0.5)); a, b = int(np.floor(x)), int(np.ceil(x))
        haiku[i] = max(0.0, hs[a] + (hs[b] - hs[a]) * (x - a))

# Error variances from the questions with all three.
tri = [i for i in raters if i in haiku and i in model]
r, h, m = (np.array([src[i] for i in tri]) for src in (raters, haiku, {i: model[i][1] for i in model}))
vrh, vhm, vrm = np.var(r - h), np.var(h - m), np.var(r - m)
var = {'r': (vrh + vrm - vhm) / 2, 'h': (vrh + vhm - vrm) / 2, 'm': (vhm + vrm - vrh) / 2}
w = {k: 1 / max(v, 0.05) for k, v in var.items()}
print(f'{len(tri)} questions with all three; error sd: raters {np.sqrt(var["r"]):.2f}, Haiku {np.sqrt(var["h"]):.2f}, model {np.sqrt(var["m"]):.2f}')

rating = {i: raters.get(i, haiku.get(i)) for i in model}
comb = {}
for i, (g, md) in model.items():
    num, den = w['m'] * md, w['m']
    for k, src in (('r', raters), ('h', haiku)):
        if i in src: num += w[k] * src[i]; den += w[k]
    comb[i] = num / den
final = {}
for bank in ('sb', 'osb'):
    ids = [i for i, (g, _) in model.items() if (g == 'OSB') == (bank == 'osb')]
    have = [i for i in ids if rating[i] is not None]
    c, rr = np.array([comb[i] for i in have]), np.array([rating[i] for i in have])
    k = rr.std() / c.std()
    for i in ids: final[i] = max(0.0, rr.mean() + (comb[i] - c.mean()) * k)
    f = np.array([final[i] for i in ids])
    print(f'{bank}: {len(ids)} questions ({len(ids) - len(have)} with no rating, model only); mean {f.mean():.2f}, median {np.median(f):.2f}, '
          f'90th {np.percentile(f, 90):.2f}, 99th {np.percentile(f, 99):.2f}, max {f.max():.2f}, over 10: {(f > 10).sum()}')
for i, d in anchors.items():
    if i in final: final[i] = d
both = [i for i in final if rating[i] is not None]
print(f'Spearman with the half-point ratings: {spearmanr([final[i] for i in both], [rating[i] for i in both])[0]:.3f}')
with open(ROOT / 'data' / 'difficulty.csv', 'w') as f:
    f.write('id,d\n')
    for i in model: f.write(f'{i},{round(final[i], 2):g}\n')
print(f'wrote data/difficulty.csv ({len(final)} questions)')
