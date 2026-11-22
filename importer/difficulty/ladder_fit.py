"""Works out each question's difficulty from the model ladder's answers (ladder.mjs), with item
response theory: every "player" (a model, reading the whole question or only part of it) has a
strength theta, every question a difficulty b, and

    P(right) = g + (1 - g) / (1 + exp(-(theta - b)))

where g is the guessing floor (0.25 with four choices in view). b is in logits: a question with
b = theta is answered right by that player about half the time (above the guessing floor).
Fitted by maximum a posteriori (gentle normal priors keep questions every model got right, or
every model missed, at finite values).

  python3 importer/difficulty/ladder_fit.py [--min-players 2]

Writes data/ai-difficulty.csv (id,ai), which the site and fit.py use as the `ai` feature, and
importer/difficulty/runs/ladder-fit.csv (id, ai, standard error, answers) to look at. Prints
each player's strength and how well `ai` agrees with the hand ratings."""
import csv, glob, json, pathlib, sys
from collections import defaultdict
import numpy as np
from scipy.optimize import minimize
from scipy.stats import spearmanr

ROOT = pathlib.Path(__file__).resolve().parents[2]
RUNS = ROOT / 'importer' / 'difficulty' / 'runs'
PRIOR_B, PRIOR_T = 2.0, 3.0
min_players = int(sys.argv[sys.argv.index('--min-players') + 1]) if '--min-players' in sys.argv else 2

# (question, player) → [answers, right, guess floor]
cells = defaultdict(lambda: [0, 0, 0.0])
for f in sorted(glob.glob(str(RUNS / 'ladder-*.jsonl'))):
    for line in open(f):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        c = cells[(r['id'], r['r'])]
        c[0] += 1; c[1] += r['c']; c[2] = r.get('g', 0)
if not cells:
    sys.exit('No ladder results in importer/difficulty/runs/ (run ladder.mjs first).')

players_of = defaultdict(set)
for (q, p) in cells: players_of[q].add(p)
items = sorted(q for q, ps in players_of.items() if len(ps) >= min_players)
players = sorted({p for (_, p) in cells})
qi = {q: i for i, q in enumerate(items)}
pi = {p: i for i, p in enumerate(players)}
rows = [(qi[q], pi[p], n, k, g) for (q, p), (n, k, g) in cells.items() if q in qi]
I = np.array([r[0] for r in rows]); P = np.array([r[1] for r in rows])
N = np.array([r[2] for r in rows], float); K = np.array([r[3] for r in rows], float); G = np.array([r[4] for r in rows], float)
nI, nP = len(items), len(players)
print(f'{nI} questions, {nP} players, {int(N.sum())} answers ({K.sum() / N.sum():.0%} right)')

def parts(x):
    theta, b = x[:nP], x[nP:]
    s = 1 / (1 + np.exp(-(theta[P] - b[I])))
    p = np.clip(G + (1 - G) * s, 1e-9, 1 - 1e-9)
    return theta, b, s, p

def loss(x):
    theta, b, s, p = parts(x)
    ll = (K * np.log(p) + (N - K) * np.log(1 - p)).sum()
    lp = -(b ** 2).sum() / (2 * PRIOR_B ** 2) - (theta ** 2).sum() / (2 * PRIOR_T ** 2)
    dz = (K / p - (N - K) / (1 - p)) * (1 - G) * s * (1 - s)   # d loglik / d (theta - b)
    gt = np.bincount(P, dz, nP) - theta / PRIOR_T ** 2
    gb = -np.bincount(I, dz, nI) - b / PRIOR_B ** 2
    return -(ll + lp), -np.concatenate([gt, gb])

res = minimize(loss, np.zeros(nP + nI), jac=True, method='L-BFGS-B', options={'maxiter': 5000})
theta, b, s, p = parts(res.x)
info = np.bincount(I, N * ((1 - G) * s * (1 - s)) ** 2 / (p * (1 - p)), nI) + 1 / PRIOR_B ** 2
se = 1 / np.sqrt(info)
print('fit:', 'ok' if res.success else res.message)
print('players, weakest first (strength in logits; share of answers right):')
for j in np.argsort(theta):
    m = P == j
    print(f'  {players[j]:28s} {theta[j]:+6.2f}   {K[m].sum() / N[m].sum():.0%} of {int(N[m].sum())}')

ai = dict(zip(items, b))
# Agreement with the hand ratings (the rubric's scale).
ids = json.load(open(ROOT / 'importer/difficulty/sample-ids.json'))
hand = {}
for line in open(ROOT / 'importer/difficulty/ratings.txt'):
    if line.strip():
        i, r = line.split(); hand[ids[int(i)]] = float(r)
both = [q for q in hand if q in ai]
if len(both) >= 10:
    rho = spearmanr([ai[q] for q in both], [hand[q] for q in both])[0]
    print(f'agreement with the hand ratings: Spearman {rho:.3f} on {len(both)} rated questions')
print('ai spread: pct 1/10/50/90/99 = ' + ' '.join(f'{np.percentile(b, q):.2f}' for q in [1, 10, 50, 90, 99]))

with open(ROOT / 'data' / 'ai-difficulty.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['id', 'ai'])
    for q in items: w.writerow([q, f'{ai[q]:.2f}'])
answers = np.bincount(I, N, nI)
with open(RUNS / 'ladder-fit.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['id', 'ai', 'se', 'answers', 'right'])
    right = np.bincount(I, K, nI)
    for j, q in enumerate(items): w.writerow([q, f'{b[j]:.3f}', f'{se[j]:.3f}', int(answers[j]), int(right[j])])
print(f'wrote data/ai-difficulty.csv ({nI} questions). Next: refit the model (RUBRIC.md → AI signals).')
