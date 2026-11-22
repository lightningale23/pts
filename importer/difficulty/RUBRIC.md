# Difficulty ratings

`js/difficulty.js` rates every question on a 0–10 scale (open at the top). Its weights (`MODEL`)
were fitted to hand ratings of a sample of questions, rated against the rubric below.

## Rubric (from the view of a strong high school Science Bowl player; same scale for MS and OSB)

| Rating | Meaning | Examples |
|---|---|---|
| 0–1 | Trivial, everyday knowledge | "SI unit of electric potential?" Volt; MS "type of energy of motion" |
| 2–3 | Easy textbook fact or one-step calculation | competitive exclusion; series resistors; Hess's law |
| 4–5 | Typical regional question: solid HS coursework, a two-step calculation, a moderately rare term | firn; packing efficiency order; Doppler with two moving sources |
| 6–7 | Hard: AP/college depth, a rare topic, or a calculation that takes real work in 20 s | Henyey track; GZK bound; expected tosses for two heads in a row |
| 8–9 | Very hard: specialist knowledge few top players have, or a long calculation | umpolung; Cram's rule; potocytosis; a 3×3 matrix inverse |
| 10+ | Extreme: obscure research-level fact, or a calculation almost no one finishes in time | |

Multiple choice is rated easier than the same knowledge asked as short answer (the answer is on
the screen). Length, a picture or a story setup don't make a question hard by themselves.

## Files

- `sample-ids.json`: the rated questions (stratified by level, type, format and subject; 400 SB, 44 OSB), in order.
- `ratings.txt`: `index rating`, one line per rated question.
- `features.mjs`: features of the rated questions and the banks (`node importer/difficulty/features.mjs > /tmp/f.json`).
- `fit.py`: ridge regression with cross-validation; `python3 importer/difficulty/fit.py /tmp/f.json --write` writes `MODEL`.
- `llm.mjs`, `ladder.mjs`, `ladder_fit.py`, `pairwise.mjs`, `pairwise_fit.py`, `visuals_png.py`: the AI signals (below).
- `english_words.py`: regenerates `js/english-words.js` (needs `pip install wordfreq`).

Fit of 2026-11-22: held-out Spearman 0.66 against the ratings (the first hand-set version: 0.43).
To improve it, rate more questions (append to `sample-ids.json` and `ratings.txt`) and refit.

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
