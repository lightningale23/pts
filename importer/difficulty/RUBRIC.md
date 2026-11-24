# Difficulty ratings

Every question has one difficulty number, **d**, with one meaning. Ratings are made by reading each
question against this page (stored in `data/difficulty.csv`); `js/difficulty.js` only rates questions
that have no stored rating yet (new imports), with a model fitted to the stored ratings.

## The definition (the only thing a rating means)

A question's difficulty d is set by **f**, the share of high school teams at an average online Science
Bowl invitational that would answer it correctly more than half the time if no other team were
buzzing, under the normal clock (5 seconds after a toss-up is read, 20 seconds for a bonus):

    f = 10^(-d/5)        d = 5 · log10(1/f)

| d | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| f | 100% | 63% | 40% | 25% | 16% | 10% | 6.3% | 4% | 2.5% | 1.6% | 1% | 0.4% |

Every 5 points = 10× fewer teams. No cap: over 10 means fewer than 1 team in 100, which should happen
only for a handful of extreme questions in the whole bank. Below 0 isn't used (0 = every team).
Middle school and Ocean Science Bowl questions use the same scale, judged against the same high school
invitational teams (so most MS questions are low). Ratings to two decimals (v3; the v2 raters used steps of 0.5).

## How to judge

1. **Calculations.** Does a typical player know exactly what to do with every number the moment the
   question is read? If yes (Carnot efficiency then multiply; the mirror equation; v² = 2ad; continuity
   A₁v₁ = A₂v₂), rate it like knowing the formula: low. The arithmetic itself adds little. If the formula
   is even slightly awkward, the setup needs an insight, the answer needs simplifying (radicals,
   fractions), or there are several steps, the difficulty rises fast. Judge the full multi-step process,
   not the topic name.
2. **Same scale for every subject.** No subject has a floor or a ceiling.
3. **Multiple choice** is easier than the same knowledge asked as short answer (the answer is on the
   screen); a set of wrong-but-plausible distractors makes it harder again.
4. **Length, a story setup, rare-looking words the question itself explains, or a long lead-in don't
   make a question hard.** A long lead-in that gives the answer away makes it easier.
5. **Toss-ups:** what can be recalled or worked out within 5 seconds of the end. **Bonuses:** 20 seconds,
   so moderate calculations are feasible. Multi-part answers ("1) ...; 2) ...") and select-all/ordering:
   the team must get every part, so it's harder than its hardest part alone.
6. **Visual bonuses** (`data/visual-bonuses.csv`, picture at `image`): look at the picture when the
   rater can; otherwise rate from the text.
7. **A wrong or ambiguous answer key:** rate the question as intended and log it in `v2/key-issues.txt`.

## Anchors

Proposed by reading each question against the definition (a human review was in progress when they
were set). `v2/anchors.json` holds them. Every batch hides three check questions, unlabelled: two from the
calibration sample (below; raters never see those ratings) and one published anchor.

| Subject | Anchors (id **d** why) |
|---|---|
| Physics | `nv72ef` **1.5** mirror equation, every number's job obvious · `1f0ucp7` **2.5** which particles are bosons · `15kmxpm` **4** recall v^2 = rg tan θ, simplify √20 · `6qggb8` **5** two projectile formulas into a ratio, awkward simplification · `1npv5nh` **6.5** canonical partition function + geometric series · `vxks2b` **8** scaling insight, two parts · `kuw9mz` **9** BBGKY hierarchy, graduate stat mech |
| Chemistry | `1i0rkrb` **1.5** degree of unsaturation of o-xylene · `196exgz` **2.5** silver halide solubility, MC · `zmlk9i` **4** Stille coupling uses tin, MC · `usm3od` **5** Rydberg ratio using 120 nm · `vqcbmw` **6.5** Luche reduction, MC · `19i6ak8` **8** Woodward–Fieser rules · `2emss0` **9** Bell–Evans–Polanyi principle |
| Biology | `9cifzp` **1.5** meiosis then mitosis, MC · `ftbh5k` **2.5** 12:3:1 dominant epistasis, MC · `1izd92r` **4** lungs constrict, brain dilates under hypoxia, MC · `1qm6xe2` **5** siRNA/piRNA and heterochromatin · `1gn1un3` **6.5** funny channels + sodium · `tbpwe8` **8** PTTH · `1bvnyx7` **9** tunica–corpus division planes |
| Mathematics | `37sv3b` **1.5** black or jack, 7/13 · `1kmcjne` **2.5** two-case combinations · `1joph4o` **4** sum of binomial coefficients · `norvmy` **5** matrix is a scaled rotation · `ntgas8` **6.5** convexity insight in a toss-up · `2esb0q` **8** expected unique subjects, linearity of expectation · `1ixhlip` **9** power of a point three times, then area, in 20 s |
| Earth and Space | `1tgbyhw` **1.5** Uranus, first found by telescope · `48tec8` **2.5** S0 = lenticular, MC · `5hkgmm` **4** Milankovitch periods · `1tj64tt` **5** lysocline · `q895j3` **6.5** Gossamer rings · `k2rbmd` **8** order four bodies by sputtering · `7ft69` **9** isostasy models, two parts |
| Energy | `2wz1lj` **1.5** cytochrome c activates caspases, MC · `6mn6xy` **2.5** Tc-99m, MC · `k67ino` **4** order three half-lives · `3h0kwj` **5** no-hair theorem · `q34vdw` **6.5** geodetic effect · `a4ncmx` **8** hohlraum · `19swsgs` **9** N−1 contingency |
| Other | `1q41bnq` **2** Carnot: max work between 250 K and 500 K with 90 J in; standard plug-in · `15axdjo` **2** positron emission of Mg-23 gives a neutrino; plenty of teams miss it |

Fixed points from players' feedback: `1wr2o9p` (influenza HA/NA), `1qkk7ph` (ENSO), `15puwj8`
(epididymis) and `ha428l` (|a+b| in one line) belong around 1–2.5.

## Calibration notes

Settled while rating the 145-question calibration sample (`v2/ratings/cal-*.txt`, 20 per SB subject, CS, OSB):

- **Plug-in calculations** whose every number has an obvious job: toss-up 1–2, bonus 1–2.5 (mirror
  equation, Carnot efficiency, r = mv/qB scaling, L ∝ R²T⁴, B = μ₀I/2πr). One less-familiar relation or a
  trap in the setup (minimum loop speed √(5gR); a reduced-mass/angular-momentum statement list) puts it at 4–6.
  Real insight (an equilibrium you have to set up yourself, a counting trick) 6.5–8.
- **Named things.** Names in every HS course (Charles' law, nodes, mitosis): 0.5–1.5. Names a good team
  knows from AP/olympiad study (Zeeman, synchrotron, Meissner, Cooper pairs, torsional strain, Madelung):
  2.5–5. College or specialist names (Twomey effect, albuminous cells, Gouy–Stodola, Woodward–Fieser): 6.5–8.
  A stem that defines the term nearly word for word ("all black holes are described by mass, charge and
  angular momentum": no-hair theorem) is 1–2 points easier than one that only hints.
- **Multiple choice**: one option obviously right to anyone who knows the topic at all: 0–1.5. Distractors
  that need real understanding to rule out (MO-diagram statements, Pourbaix slopes): rate the reasoning.
- **Select-all / ordering** with three items: about 1–2 above the hardest single item; a trap item
  (gram isn't an SI base unit) counts.
- **Multi-part visual bonuses** whose parts are each standard (Lagrange points L4/L5, SOHO L1, JWST L2): 3–4.
- **Middle school**: rated on the same scale, so most are 0–3; an MS question on HS/college material
  (p-adic valuation) is rated for what it asks.
- **OSB**: judged against the same SB teams. General ocean facts 0–2; course-level oceanography (thermocline,
  ITCZ, La Niña) 1.5–3; specialist ocean biology/law (hectocotylus, white-smoker chemistry) 5–6. Quiz-bowl
  style toss-ups (several clues, "for 10 points...") are rated by the clue at the end.
- **Broken questions** (a key that looks wrong, a question that leans on an earlier one): rate as intended,
  log in `v2/key-issues.txt`.
- The calibration sample's medians came out 3–4 per subject, so the bank should land around 3.
- After the first ~4,700 ratings, the raters who met calibration items as hidden checks rated them ~0.5 lower,
  consistently and in agreement with each other (mostly multiple choice and select-all in the 3–6 range), while
  matching the published anchors. The calibration items were moved to the consensus (the reference rating and
  each rater's rating one vote each, rounded to 0.5): 45 changed, listed in `v2/calibration-releveled.txt`.

## Rating workflow (`v2/`)

- `node importer/difficulty/v2/rate.mjs next <worker> [--subject S] [--slice k/n] [--size 80]` prints the
  next batch: unrated questions of that subject (or slice of it), grouped by subcategory, plus three
  hidden check questions, numbered #1, #2, ... (no IDs). The batch is remembered in `v2/work/<worker>.json`.
- The rater writes one `number rating` line per question to a file and runs
  `node importer/difficulty/v2/rate.mjs save <worker> <file>`. If the hidden check questions are off by more than
  1.0 on average the batch is refused (re-rate it); otherwise ratings are appended to
  `v2/ratings/<worker>.txt` (`id rating`) and anchor results to `v2/qc.log`.
- `rate.mjs anchors [subject]` prints the anchors in full; `rate.mjs status` shows how many are rated per subject; `rate.mjs stats [subject]` the distribution,
  drift by batch and 10 random rated questions; `rate.mjs missing` lists unrated IDs (new imports).
- A question is never rated twice: every file in `v2/ratings/` counts. Reruns resume.
- `rate.mjs export` writes `data/difficulty.csv` (`id,d`) from all ratings plus the anchors.

### How the bank was actually rated (2026-11-22)

- 7,231 questions by Claude Code raters with `rate.mjs` (Opus, parallel workers). Too costly to finish that
  way: each worker's conversation grew across batches and was re-sent on every step.
- The rest through the Claude API's Message Batches: `v2/batch_api.mjs` (Claude Haiku 5.5, about $4 for the
  whole bank). Same rubric, anchors and hidden checks; plus a section on routine calculations with 19
  rated calculation examples (`CALC_EXAMPLES`), added after a 400-question check showed Haiku rating
  calculations ~1.3–1.7 too high. Haiku rated every question (raw ratings in `v2/api/`).
- `batch_api.mjs calibrate` then puts Haiku's numbers on the raters' scale per subject by matching
  percentiles on the 7,231 both rated (Haiku's order kept; past the overlap's top it continues in
  proportion, so over 10 stays possible) and writes `v2/ratings/api-calibrated.txt` for the questions the
  raters didn't do. Haiku vs raters: Spearman 0.65–0.86 by subject; Math error 1.18 → 0.57 after calibrating.
  The raters ran ~0.4 below the anchors on their hidden checks, so the bank as a whole may sit a little low.
- Key issues Haiku flagged are in `v2/key-issues.txt` (`api-claude-haiku-5-5` lines; many are noise).
- v2's site numbers came from `v2/combine.py` (raters + calibrated Haiku + fallback model). Superseded by v3.

### v3 (2026-11-22, what the site uses)

Owner: Haiku alone, two decimals, numbers used as they are (no raters, calibration, model or combine.py).
The v3 prompt adds a share-of-teams table, the online-invitational field, hand-levelled easy examples
0.1–1.7 (v2's 0.00s were an artifact) and notes on conceptual physics and fancy-sounding easy facts. One
Haiku rating lands on ~0.5 steps whatever it's told, so every question was rated 3 times (different
neighbours each pass; `v3` batches in `v2/api-v3/`). Cost about $11.
- Continuous numbers (owner: not means of three half-points, which all end in .00/.17/.33/.5/.67/.83): each
  answer also gives the share of teams ("~35%", 5% steps). `export` puts it on the rating scale
  (5·log10(100/share), then the least-squares line to the ratings, ≈ 1.34x + 0.54) and stores 0.6 × mean rating +
  0.4 × mean share estimate. The two grids don't line up, so the result fills the two-decimal grid (~730 distinct
  values, endings even), and it agrees a little better with the 7,231 v2 rater ratings (Spearman 0.797 → 0.804;
  weight 0.25–0.5 all ~0.803). Shares are read only from the answer's last segment (percents in the summary are
  often from the question) and dropped when over 2 points from their own rating. `v2/api-v3/*.txt` lines are
  `id rating share%`; `collect --rebuild` rewrites them from the saved replies (`api-raw-*.jsonl`, gitignored).
- Fine pass (`rate --fine`, `api-v4/`, ~$3.65): one more rating per question, to two decimals with every number in a
  request different. Haiku then uses every last digit (no repeats in 501 trial numbers), but the forced spread is
  noise as much as signal: alone it agrees with the v2 raters at 0.744 (a v3 pass: 0.755–0.771). Mixed in at
  `FINE_WEIGHT` 0.15 (tested 0.1–0.6 on 7,079 rater questions; 0.1–0.2 best, more hurts) it nudges agreement
  0.8042 → 0.8052 and breaks ties.
- Result: SB median 2.54, 10th/90th/99th percentile 0.94 / 4.6 / 6.35, max 9.09 (none over 10);
  OSB median 2.21; MS ~1.2–1.5 by subject; no zeros. Spearman with v2's numbers 0.89; v3 sits ~0.27 higher.
  Hidden checks: off by ~0.8 on average, bias about −0.4 (Haiku rates the anchors a little low).
- Averaging three ratings squeezes the hard tail a little: nothing is over 10 yet.
- ~100 questions have 2 ratings (their third request kept running out of room); a few have 4–7 (ones also used
  as hidden checks).
- New questions: `batch_api.mjs rate --all` (needs `ANTHROPIC_API_KEY`, or the key alone in the gitignored
  `v2/.api-key`), `status`, `collect`, `export`. Until then the site gives them the fallback model's number
  (`js/difficulty.js` MODEL, `features.mjs` labels = `data/difficulty.csv`: held-out Spearman 0.61).

### v4: a stronger model on top (2026-11-24, in progress)

Haiku's three passes agree with each other at 0.95 but with the 7,231 v2 rater ratings only at 0.80, so its mistakes
are systematic and more Haiku passes can't fix them. Of the 28 largest Haiku–rater disagreements read by hand, Haiku was
wrong in ~17: research-lab lead-ins on easy answers rated 5–6 (ribose 5.27, a giveaway "homologous recombination" 6.46),
routine math ~0.9 too high (sum of cubes of the roots of x³ − 1 = 2.93), obscure specialist names too low (glycosomes
2.2, Kondo effect 3.4). Plan: one rating per question from a stronger model, mixed in at `STRONG_WEIGHT` 0.75 (export
picks the folder in `v2/api-v5/` with the most ratings, or `--strong-model`).
- Through the API: `batch_api.mjs validate --n 600 --model M` (same 600 rater questions for every model, printed next to
  the site's numbers; ~$2 Opus, ~$1 Sonnet), `rate --strong [--model claude-sonnet-5-5]` (~$146 Opus, ~$73 Sonnet, estimates).
- Through a Claude subscription instead (owner's choice): `v2/rate_cc.mjs` runs `claude -p` once per 40 questions, fresh
  each call (no growing conversation, no CLAUDE.md: it runs in an empty temp folder), hardest-rated first (Haiku's top
  half holds ~81% of the ≥1.5-point disagreements), `--limit N` a run; it stops on a failed call (usage limit) and
  resumes next time. Ratings → `v2/api-v5/cc-<model>/`. Questions not re-rated keep their v3 number, so a partial run
  is fine.
- First run (2026-11-24, `--limit 200`): 211 ratings (with hidden checks), all from Haiku's top (Haiku mean 7.06, Opus
  6.54; Spearman between them only 0.42 in that narrow range, 62 moved by over 1.5). On the 31 also rated by the v2
  raters: Spearman Opus 0.82 vs Haiku 0.63, mean error 0.61 vs 0.87. Opus brings hard math puzzles down 3–5 points and
  spreads the top (Gegenweg 10.8, Callisto's interior 10.2). Opus doesn't write a share of teams, so `blended` uses its
  ratings alone. `STRONG_WEIGHT` 0.75 is untested: tune it once a few thousand overlap the v2 raters.
- The rest with Sonnet (owner: Opus used too much of the weekly limit). `rate_cc` skips questions any strong model has
  rated; `export` takes each question's first rating in Opus → Sonnet order. Check Sonnet's level against Opus on a few
  hundred both rated (`--again --model opus`) before trusting the mix.
- After the second round (2026-11-24): 251 Opus, 317 Sonnet (8 both). On the questions the v2 raters also did, Opus
  agrees at 0.85 (Haiku 0.51 on the same 35; mean error 0.60 vs 0.96, bias −0.2); Sonnet at 0.76 (Haiku 0.45 on 58;
  mean error 0.85 vs 0.94, bias +0.2). Sonnet does write shares of teams (220 of 320 lines). Sonnet gives 10.00 to
  several hard multi-part visual bonuses and graduate-level names; Opus is the better rater, Sonnet still clearly
  beats Haiku on order.

## Previous scales

- 2026-11-22 (v1): a 0–10 "how hard for a strong player" rubric, 444 hand ratings (`sample-ids.json`,
  `ratings.txt`) and a ridge model on word-rarity and set-level features. Replaced because calculations ran
  hot, conceptual questions cold, and niche-sounding easy questions very hot. Those ratings are on the old
  scale: don't reuse them as labels.

## AI signals (no player data needed)

Two optional signals from free local models (Ollama, on the owner's computer; nothing is paid).
Raw results go to `runs/` (gitignored); only `data/ai-difficulty.csv` and `pairwise-ratings.txt`
are committed. Both runs can be stopped any time and resume where they left off.

**Model ladder** (`ladder.mjs`, `ladder_fit.py`): models from ~1B to ~12B answer every question (the
weaker ones stand in for weaker players), the site's checker marks them, and item response theory
gives each question a difficulty in logits (`ai`). Visual bonuses go only to models that see pictures.
It becomes a feature (`ai`, plus `aiMissing`) of the fit; fit.py prints the held-out score with and
without it, and won't write MODEL unless the ladder covers ≥95% of the SB bank.

```
ollama pull gemma3:1b && ollama pull qwen2.5:1.5b && ollama pull llama3.2:3b && ollama pull gemma3:4b
ollama pull qwen2.5:7b && ollama pull llama3.1:8b && ollama pull gemma3:12b
pip install pillow && python3 importer/difficulty/visuals_png.py      # pictures as PNG
node importer/difficulty/ladder.mjs --limit 300                        # time it first (prints an ETA)
node importer/difficulty/ladder.mjs                                    # the whole bank, model by model
python3 importer/difficulty/ladder_fit.py                              # → data/ai-difficulty.csv
```
Options: `--models a,b,c` (any Ollama models, weakest to strongest), `--samples N` (answers per model,
default 1), `--cuts 0.5,1` (toss-ups also read only halfway, like an early buzz: more rungs, more time),
`--parallel N` (set `OLLAMA_NUM_PARALLEL` to match), `--bank sb|osb`. `ladder_fit.py` prints each
model's strength (bigger should be stronger; if not, something is off) and the agreement with the
hand ratings.

**Pairwise** (`pairwise.mjs`, `pairwise_fit.py`): a judge model (default `gemma3:12b`) compares a
question with ~6 hand-rated anchors near its current rating, each pair both ways round; the fit puts
it on the rubric's scale. Always validate first: `--validate 80` rates anchors from the other
anchors and `pairwise_fit.py` prints its Spearman against the hand ratings. Only if that is near or
above the model's held-out Spearman, run `--sample 2000` (≈24,000 judge calls) and refit: the ratings
in `pairwise-ratings.txt` join the training labels at weight `PAIR_WEIGHT` (default 0.3).

Refit after either: `node importer/difficulty/features.mjs > /tmp/f.json && python3 importer/difficulty/fit.py /tmp/f.json`
(compare the held-out Spearman with the line above), then add `--write` to update MODEL. Rerun
`ladder.mjs` + `ladder_fit.py` on new questions after an import (questions without `ai` count as average).
