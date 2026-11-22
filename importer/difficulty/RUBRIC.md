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
invitational teams (so most MS questions are low). Ratings in steps of 0.5 (one decimal when sure).

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
