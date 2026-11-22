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
- `english_words.py`: regenerates `js/english-words.js` (needs `pip install wordfreq`).

Fit of 2026-11-22: held-out Spearman 0.66 against the ratings (the first hand-set version: 0.43).
To improve it, rate more questions (append to `sample-ids.json` and `ratings.txt`) and refit.
