# pts: notes for Claude

This file is the hand-off between chats. A new chat is often given only "the pts repo", so
everything needed to work on the site without asking the owner should be here.

**Keep this file current.** Update it in the same commit whenever something here changes or
a new chat would otherwise have to rediscover it: a new file or module, a new convention, a
decision the owner made (especially "don't do X" or "X is off for now"), a new external
service or setting, a known issue found or fixed. Edit the section it belongs to; replace
stale lines instead of appending history. Keep it short: what's true now, not a diary.

## Owner and how to work

- Owner: Toby (GitHub `lightningale23`), a high school Science Bowl player. Friends use the
  site and send feedback, often as screenshots.
- Repo `lightningale23/pts` (public), branch `main`, published by GitHub Pages at
  https://lightningale23.github.io/pts/. Static ES-module site, **no build step**.
- **Always commit and push finished work to `main`** (no PRs) unless told otherwise. Another
  chat may have pushed in between: `git pull --rebase origin main` before pushing.
- Run `npm test` (node --test, Node 18+) before every push. Add tests for checker, speech
  text or engine changes (`tests/*.test.js`).
- Reports to the owner: short, results first, no recap of steps. Plain words for players
  (the owner says "neg", not "incorrect interrupt").
- The repo is public. Never put the owner's email or other private details in it. Claude
  can't push secrets (API keys, TURN passwords); when one is needed, tell the owner exactly
  what to paste where and let them commit it (that's how the relay credentials in
  `js/config.js` got there).

## Changelog (required)

Every change players would notice (new questions count) gets:
1. a one-line, plain-language entry for players in `data/changelog.json` under today's date
   (newest day first, newest item first within the day), and
2. a `Changelog: ...` line in the commit message.

The help page (collapsed at the bottom) shows the JSON plus `Changelog:` lines from recent
commits (via the GitHub API, `CONFIG.repo`). Internal, dev-page or data-only changes players
won't notice need no entry.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `css/style.css` | The whole site UI (hash routes: practice, rooms, questions, saved, stats, help); see Phones and small screens, Desktop layout |
| `js/config.js` | Site settings: banks, competitions (SB/OSB), PeerJS prefix, relay servers, presence URL, `repo`, `respellings` |
| `js/app.js` | Pages, routing, keyboard, wiring |
| `js/questions.js` | Loading banks, `normalizeRow` (IDs), subcategory list, filters, ordering, bonus pairing |
| `js/rounds.js` | Round stages (RR / early, mid, late DE) |
| `js/engine.js` | `GameEngine`: reading, buzzing, timers, scoring, negs, overrides |
| `js/game-view.js` | Reading stage, buzzer lamp/timer ring, after-question view, Search Google button (`searchText`: the whole question and choices, brackets and guides kept, no length cap) |
| `js/checker.js`, `js/mathval.js` | Answer checking; math answers evaluated and compared by value |
| `js/text.js` | Tokenizing questions for display and for speech (math, degrees, charges, READ guides); `plainText`/`plainMath` turn math into plain text without dropping anything (summaries, reports, Search Google) |
| `js/speech.js` | Listen mode (Web Speech API), voice pace calibration, end of reading |
| `js/net.js` | Rooms over WebRTC (PeerJS 1.5.5); relay (TURN) handling |
| `js/settings.js`, `js/stats.js`, `js/bookmarks.js` | Settings (`DEFAULTS`), stats page, saved questions |
| `js/difficulty.js`, `data/difficulty.csv`, `js/english-words.js`, `importer/difficulty/`, `data/ai-difficulty.csv` | Difficulty: the stored rating of every question, the fallback model and its word list, the rating tools and rubric, the unused AI ladder's numbers (see Difficulty) |
| `js/changelog.js`, `js/presence.js` | Help-page changelog; "● N online" badge |
| `js/report.js` | The Report form on questions (see Question reports) |
| `dev.html`, `js/dev.js`, `js/dev-gate.js` | Unlinked troubleshooting page behind a password (see below) |
| `rate.html`, `js/rate.js`, `importer/difficulty/human/` | Unlinked page where people rate a fixed set of 80 questions, to test the AI difficulty rater (see Difficulty) |
| `js/review.js`, `review/` | Review queue of left-out questions (see Review queue) |
| `js/review-autofill.js` | Review tab auto-fill: fix suggestions and the bank model behind them (see Review queue) |
| `data/questions.csv` | Science Bowl bank (~42k questions, ~80 sets) |
| `data/osb-questions.csv` | Ocean Science Bowl bank (~2.6k) |
| `data/visual-bonuses.csv`, `data/visuals/` | SB visual bonuses (bank columns + `image`) and their pictures (`<id>.webp`); see Visual bonuses |
| `data/pronunciations.csv` | Respellings for hard terms (unused while respellings are off) |
| `data/changelog.json` | Changelog entries |
| `importer/` | Packet readers and bank tools (see Importing); `visual_bonuses.py` finds visual bonus pictures |
| `worker/presence/` | Cloudflare Worker for the online badge, question reports and the dev page password |
| `importer/answers/` | Answer-key check: API batch script and hand-checked proposed fixes, none applied (see Question banks) |
| `.github/workflows/apply-review.yml` | Adds questions approved on the Review tab to the bank |
| `.github/workflows/apply-edits.yml`, `importer/apply_edits.py` | Applies bank edits made on the Edit tab (see Editing the bank) |
| `tests/` | node:test suites |
| `sw.js` | Service worker: the site works offline after one visit (see Working offline) |
| `offline/` | Builds the offline app (see Offline app) |

`README.md` is the public setup guide. Its Google Sheet and "AI importer" parts describe the
first version; the site now runs from the CSV banks in the repo and packets are read by the
rule-based readers in `importer/`.

## Question banks

- Columns: `id,set,year,level,round,num,type,subject,format,question,w,x,y,z,answer,accept,reject,notes,subcategory`
- **Never change an existing row's `id`** or drop the column: players' stats and saved
  questions point at IDs. New rows get the ID the site derives (`importer/ids.mjs`, a hash
  of set|round|num|type|question in `normalizeRow`); `merge_into_bank.py` does this.
  Fixing question text in place is fine; the stored ID stays.
- `type` TOSS-UP / BONUS; `format` Short Answer / Multiple Choice; `level` HS / MS.
- SB subjects: Biology, Chemistry, Physics, Mathematics, Earth and Space, Energy (older sets
  have General Science, excluded via `CONFIG.excludeSubjects`, and Computer Science).
  OSB: Biology, Chemistry, Geology, Physical Oceanography, Technology, Social Sciences, Geography.
- Multiple choice: options in `w`..`z`, answer `W) TEXT`.
- `subcategory` (Genetics & Molecular Biology, Optics, Calculus...): packets don't print it, so
  `importer/tag_subcategories.py BANK [--all] --write` works it out (keyword seeds from
  `importer/subcategory_rules.py`, then a TF-IDF + logistic regression model per subject trained
  on the seeds; needs scikit-learn). Spot checks put it at roughly 85-95% right for SB, less for
  OSB. By default it only fills empty rows, so hand fixes in the CSV stay; `merge_into_bank.py`
  runs it on new rows. General Science, OSB Geography and Theme have none. The list and display
  order live in `SUBCATEGORY_ORDER` (`js/questions.js`); keep it in step with the rules file
  (a test checks every subcategory in the banks is listed).
- Math in LaTeX inside `$...$` (`$x^{2}$`, `$\text{CH}_{4}$`, `$\sqrt[3]{2}$`). A literal dollar sign is
  `\$` ("costs \$5"); a bare `$` pair would turn the text between into math. Math written right
  against a word ("N$_{2}$", "[A]$^{2}$") is shown attached to it (the `glue` token flag in `js/text.js`).
  Listen mode reads LaTeX structures as words (`sayStructure`: fractions, roots, limits, integrals,
  sums, binomials); keep new LaTeX within what KaTeX 0.16 renders.
- `importer/fix_latex.py BANK [--write]` repairs reader LaTeX it can recognize (dollar amounts,
  unicode in math, split superscripts, charges cut off from formulas, Greek look-alike capitals);
  imports run it. Math a reader flattened (`x6-64`, bounds turned into a `\frac`, a √ that moved)
  has to be fixed by hand from the question's read guide.
- `accept` / `reject`: alternates split on `;` **and** `|`, so never put absolute-value bars
  there.
- `notes`: `writer: AB`, `reader note: ...`, `replacement question`, anything not the answer.
- `importer/clean_questions.py BANK [--write]` tidies question text: leading round numbers
  ("[11]"), empty brackets, reader notes ("[read slowly]" → notes), headers, and trailing
  writer initials ("...? [SA]" → `writer: SA`). Imports run it automatically.
- **Owner, 2026-11-22: don't change answers that were printed on the packet, for now.** Suspected wrong keys go in
  `importer/answers/proposed-fixes.jsonl` (not applied; see `importer/answers/README.md` for what's been checked).
- Checks: `node importer/check_answers.mjs data/questions.csv` must accept every official
  answer; the only known failure is WSBT 2023 `m5uyxf` (a symbols-only option).

## Visual bonuses

Questions that come with a picture. They live apart from the bank in `data/visual-bonuses.csv`
(the bank's columns plus `image`, a path like `data/visuals/<id>.webp`), listed in the SB
competition's `bankFiles` in `js/config.js`, so they load with the bank (`normalizeRow` keeps
`image`). Built 2026-11-11: 294 SB bonuses from 22 sets (160 from slide decks); 2026-11-16: 65 more
moved in from the bank with `--from-bank` (below), 359 in all; 2026-11-21: 27 added by hand (SMH 2026,
BASED, BASH, WSBT, SSBT, CLASH duality 21A/B; see Known issues), 386 in all (385 after FE!M DE8 B6 `k68epw`, a broken packet question, was removed); OSB has none yet
(`data/osb-visual-bonuses.csv` would be its file).
- Site: the picture shows above the question from the moment it starts (also in listen mode) and
  stays after the answer; click to zoom (`zoomImage`/`visualFigure` in `js/game-view.js`).
  The header and lead-in say "Visual bonus". Settings → Questions → **Visual bonuses** checkbox
  (`filters.visuals`, default on; `visualsAllowed` in `js/questions.js`); off also stops a
  toss-up from pairing with its visual bonus (`bonusFor` picks another bonus). Owner: visual
  bonuses get 30 seconds (`visualTime`, Timing and scoring; `bonusSeconds` in the engine, also
  the buzz window in mixed mode). Questions → **Visual bonuses only** is `typeMode: 'visual'`
  (ignores the checkbox; listed only when the bank has visual bonuses). Rooms: the host's
  setting; players load the picture from `meta.image`. Questions page: Type → Visual bonus.
- Building: `importer/visual_bonuses.py --sb ROOT [--only FOLDER]` (plus the first-batch zips and
  `PDFs/Edited` as paths, like review_queue). It reruns `review_queue.process` on each folder, takes
  the visual/image items and finds each picture: first a slide deck in the folder (`.pptx` named
  visual / VB): slides matched by their labels or speaker notes (packet numbers when they fit,
  else order within subject, else plain order; a stray slide goes to the round of its
  neighbours), drawn with LibreOffice without labels or repeated logos; else the packet itself:
  pictures/drawings between the previous answer and the next question (zones body, then before,
  then after), cut at 200 dpi. Frames, highlights and backgrounds that hold question text are
  ignored. Questions about a GIF, video or sound, and General Science ones, are left out. Rows of
  the sets read are replaced (IDs kept), others stay; subcategories are tagged with the whole
  bank as training data; found questions are removed from `review/queue.json` (their
  screenshots too). It writes `visual-report.html` (gitignored) to check pictures by eye: do.
- Not found: the public releases of SBST (Spring), SBSTWO, LOST3 (`.ibp`), NCB DE6 and a few
  others have no pictures at all; they stay in the review queue.
- Bank questions that point at a picture (the reader took them as ordinary questions): `--from-bank
  IDS` (a file of IDs, or `auto` = `points_at_picture`: "shown in the image", "the given diagram",
  "pictured below", "will be visual"; not optics images, solids "figure formed by...", "has been
  shown"). They're hidden from the reference bank so the reader finds them again, get their picture
  the same way, and move to the visual file with their ID and text as they were; nothing else in it
  changes. Check `visual-report.html`: a lone question can get a slide from another round's deck
  (Berkeley Fall 2023 R14 #16 `1adep69` got a Round 12 slide and was left in the bank).
- A question already in the visual file stays visual when its folder is read again and keeps its
  ID and text (Edit-tab fixes too); only its picture is cut again. Pictures from the packet stop at
  the ANSWER line; `W) ...` choice lines never count as labels of a picture (but some packets paste a
  screenshot with the choices in it: `10th46i` was cropped by hand, as were `1s5dart`, `1t5z3ra`,
  `1k23h4`, and a rerun of their folder would cut them again).
- `review_queue.Bank` counts the visual file as part of the bank, so imported visual bonuses
  don't come back into the queue.

## Difficulty

Owner, 2026-11-22 (v2, with a friend's feedback): one definitive meaning. A question's number d says roughly
the share f of teams at an average online invitational that would get it right more than half the time with
nobody else buzzing: **d = 5·log10(1/f)** (0 every team, 5 ≈ 1 in 10, 10 ≈ 1 in 100; owner chose 10× per 5
points, the first draft's 20× tapered too fast; no cap, over 10 only for a handful). Routine calculations
(every number's job obvious) rate low; no subject has a floor (owner removed the friend's "physics ≥ 1").
Rubric, anchors and the whole rating story: `importer/difficulty/RUBRIC.md`. SB mean ~2.7, median 2.5, 99th
percentile 6.3; MS ~1.2–1.5, OSB ~2.2. Rounds and sets get the plain average of their questions (`averages`,
`roundKey(set, round)`). Shown as **just the number in gold**, two decimals (`--gold`, `.diff`; no "Difficulty"
label; the word stays in the tooltip/aria-label only).
- **Every question's rating is stored** in `data/difficulty.csv` (`id,d`, two decimals). **v3 (owner, 2026-11-22):
  Haiku alone**, 3 passes (`importer/difficulty/v2/batch_api.mjs`: `rate --all` → `status` → `collect` → `v2/api-v3/`
  → `export`); no raters, calibration, model or `combine.py` (v2 leftovers). A Haiku rating lands on ~0.5 steps, so
  (owner: numbers must be continuous, not means with the same endings) `export` stores 0.6 × the ratings' mean + 0.4 ×
  the share of teams Haiku wrote in the same answers, put on the rating scale (`SHARE_WEIGHT`; RUBRIC.md → v3).
  SB median 2.52, 99th percentile 6.33, max 9.11 (none over 10 yet);
  anchors are rated too (tests allow ±2 of their published values). Details: RUBRIC.md → v3. `rateBank` (`js/app.js`)
  fetches it; `applyStored` sets `q.difficulty` directly when the whole bank is covered (no model, no word list loaded).
  It's in sw.js DATA and the offline build. `tests/difficulty.test.js` fails if more than 1% of a bank has no stored rating.
- **Human check (owner, 2026-11-22):** `rate.html` (unlinked, no password, noindex; not in sw.js) shows the 80 questions
  of `importer/difficulty/human/set.json` (`make_set.mjs`: 12 per SB subject spread over the ratings, 8 OSB, none the
  API rater sees as examples or checks) one at a time, with the scale and rules, never the site's number; subject tabs (6 SB + OSB, with done counts) so each person rates the subjects they know. People pick
  a number (slider/box, shows the share of teams), can say "Can't judge", add a note; kept in `pts.rate.v1`; Download
  gives `pts-difficulty-<name>.json`, sent to the owner. Use: compare Haiku 1 pass / 3 passes / Sonnet against them
  (owner skipped this before the v3 run; still usable to check it). Changing set.json invalidates ratings people already made.
- **New imports have no stored rating**: the site falls back to the model for them (`difficultyJob(..., stored)`,
  a stored rating always wins). Rate them for real with `importer/difficulty/v2/batch_api.mjs` (Claude API,
  owner's key, cents; RUBRIC.md → v3), then `export`. Never with
  parallel Claude Code raters again (owner: that used up a week's usage for 16% of the bank).
- Fallback model: `js/difficulty.js` features (`FEATURES`, `featuresOf`): niche = words rare in everyday English
  (`js/english-words.js`) AND rare in the bank; answer niche, calculation size, MC/bonus/MS/stage, lists, parts,
  picture, subject, set-level means. `MODEL` is fitted by `importer/difficulty/fit.py` on the stored ratings
  (`features.mjs` → `fit.py [--write]`, labels = `data/difficulty.csv`; `--v2` the v2 ratings, `--hand` the old 444
  v1 ratings): held-out Spearman 0.61. Refit after a new export.
- AI signals, built 2026-11-21 (owner: no player data yet): a **model ladder** of local Ollama models
  (`ladder.mjs`, `ladder_fit.py` → `data/ai-difficulty.csv`, features `ai`/`aiMissing`) and **pairwise** judging
  (gemma3:12b failed validation: Spearman 0.35, mostly picks the first question). Unused: MODEL gives `ai` no weight,
  `usesAi()` is false, the CSV stays header-only. Experimental; see RUBRIC.md → AI signals.
- When the model is needed (~1 s for SB), `rateBank` runs `difficultyJob` in 30 ms slices after load; `applyRatings` fills
  the Set/Round dropdowns ("MIT 2025 (950) · 4.81"), the Settings Packets list (`.diff-slot`), the Questions/Saved
  pages, the summary line ("MIT 2025 4.81 · Round 3 5.02") and the practice header. Practice shows it only after
  the reveal (`#q-diff`, `showDifficulty`), like the set/round/# line (owner: hidden while reading; `.qsource.later`,
  visibility only so the header doesn't move); rooms carry it on the revealed question. Tests: `tests/difficulty.test.js`.
- Questions page **Difficulty** range slider (`#db-diff`: two `input[type=range]` stacked on one track, only the thumbs
  take the pointer; `diffRange`/`drawDiffRange`/`setDiffScale` in `js/app.js`). Owner: drawn as a mini distribution, not
  a plain bar: `#db-diff-hist` columns per quarter point (`drawDiffHist`, heights ∝ √count so the hard tail shows,
  counts of what the *other* filters leave; bars inside the range gold, hover title gives the count; kept short, 40px,
  the bars are decoration); disabled ("rating…") until the bank is
  rated, top = the bank's highest rating rounded up (min 10) and the top thumb there means no upper limit; thumbs
  can meet but not cross; the lower thumb is raised above the upper past the middle so both can be pulled apart at
  either end.

## Subcategory filters

`filters.subcats` holds picked `"Subject|Subcategory"` keys (`subcatKey`). A subject with
subcategories picked gives only those (ticked or not); other ticked subjects stay whole; nothing
picked means everything (`subjectAllowed` in `js/questions.js`). Settings shows them in a
collapsible group under Subjects; rooms carry them in the host's settings; the Questions page
has a Subcategory dropdown.

## Answer checker conventions

- Multiple choice is strict: letter, exact option text, or an equal number.
- Short answer is lenient: ACCEPT / DO NOT ACCEPT, optional words in parentheses, typos and
  plurals, numbers equal in value or more precise, select-all answers in any form, Roman
  numerals ↔ numbers, statements answered by name, the question's noun left off.
- A different number is never a typo, and a dropped minus sign is never a typo.
- Expressions with variables are compared by evaluating at made-up values (`sameExpression`):
  `1/4 omega` = `ω/4`; `w` can mean omega; case is folded only when the key doesn't depend
  on case; subscripts stay part of variable names. A mismatch against one alternate blocks
  fuzzy matching against that alternate only.
- Degree signs in LaTeX are understood (`60` = `$60^{\circ}$`).
- "the" and "and" between words are optional ("kamacite taenite" = KAMACITE AND TAENITE); a key
  written as a number word ("Two") takes the digit.
- Questions in parts (most visual bonuses, ~115 bank bonuses): a key labeled `1) X; 2) Y`, `I) ...`,
  `1 – X`, `1: X` (labels 1, 2, 3... in order, the first at the start; "2.4", "2:1" and out-of-order
  matchings like "1. A 3. B 2. C" aren't parts) is split by `answerParts` (cached on the question,
  `_parts`). Each part is checked on its own with `checkWhole`, against its slice of the question
  (`questionSlices`: statement lists, ordering) and the ACCEPT alternates most like it
  (`assignAccepts`); "X) TEXT" or a bare "W" part is strict multiple choice. The typed answer is
  split by the player's own labels ("1) h 2) m", "I. x II. y", skipped labels allowed), else by the
  cut points (; newline | , / "and" spaces) that get the most parts right (`checkParts`); all parts
  must be right. The result has `parts: [{label, given, correct}]`; the engine's judgment carries
  `parts` (booleans) and the view says "1 of 2 parts right: 1 ✓, 2 ✗". `metaOf` gives `parts: n`
  (no tap buttons then; the placeholder says "Answer all n parts"). `check_answers.mjs` and the dev
  page build full answers for these with `partAnswerForms`.
- When fixing a wrong ruling, add a test to `tests/checker.test.js` and re-run
  `check_answers.mjs` on both banks.

## Typewriter reading speed

On-screen (word-by-word) reading: Settings → Reading speed, 250–1000 wpm (owner's range;
`WPM_MIN`/`WPM_MAX`, default 260). `fill` in `js/settings.js` clamps saved values (`clampWpm`),
so old settings below 250 load as 250.

## Listen mode (speech)

- The question is only heard; text shows after. Spoken a sentence at a time at the Voice
  speed (`DEFAULT_RATE` 1.2); `CHOICE_PAUSE_MS` 400 between MC options.
- **Respellings are off** (`CONFIG.respellings: false`): some voices spelled respellings out
  letter by letter, so printed pronunciation guides are skipped and words are said as
  written. The respelling code and `data/pronunciations.csv` stay; `dev.html` can turn it on
  to test. Don't turn it back on without the owner.
- `[READ: ...]` guides for math/formulas are read instead of the symbols; reader
  instructions ("[read slowly]") are not read.
- Degrees are read as degrees ("25 degrees Celsius", "naught" for ΔH°), ion charges as
  charges ("Fe 3 plus"), not "to the".
- The buzz timer starts when the voice's last sentence fires its `end` event (owner: exactly when
  the voice stops, never early; the old guess at when the last word would finish came too soon
  with voices that don't report word boundaries). A buzz on the last word isn't a neg.
- Rooms: the host picks one voice. A player without that voice gets their own voice sped up
  or slowed down to match the host's pace (learned pace in `pts.voicePace.v1`). When everyone
  has the same voice, no adjustment happens.

## Rooms

- WebRTC via the public PeerJS broker (`peerPrefix` `pts-scibowl-`); the host's browser runs
  the game. `?net=local` tests rooms in two tabs of one browser.
- School Wi-Fi, Cloudflare WARP and managed Chromebooks block direct connections, so rooms
  use a relay: Metered TURN servers in `CONFIG.iceServers` (committed by the owner; leave
  them). With a site relay, PeerJS's own TURN servers are skipped. A blocked connection shows
  a clear "couldn't connect to the host" message instead of "No room found".
- dev.html's Network tab tests which connection types work on a device.
- Wrong answers stay up: the status line is overwritten by the next buzz, so `#tried` under it lists
  every wrong, non-voided answer on the current question ("Wrong answers: Bob: “x” neg"), rebuilt from
  `judgments` by `drawTried` (`js/game-view.js`) on judged/reveal/override, cleared on the next
  question. Rooms only (solo ends the toss-up on a wrong answer).

## Online badge

`worker/presence` is a Cloudflare Worker + SQLite Durable Object with hibernating WebSockets
(auto-response ping/pong, so idle tabs cost nothing). Deployed by the owner at
`wss://pts-presence.albertsonseinstein.workers.dev/online` (`CONFIG.presenceUrl`), allowed
origin `https://lightningale23.github.io`. Tabs disconnect after 5 minutes hidden.
The badge counts IPs, not tabs (`countPeople` in `worker/presence/src/visitors.js`: tabs from one IP
count once, a socket with no IP noted counts alone), so people sharing a network (a school) count as one;
the Durable Object only sends the count when it changes (a new tab always gets it).
**Online tab** (owner, 2026-11-21): when a tab connects, the outer Worker copies its IP
(`CF-Connecting-IP`) and Cloudflare's city/region/country onto the request (`x-pts-*` headers,
overwritten so visitors can't fake them), and the Durable Object keeps them plus a browser label as
that WebSocket's attachment (`worker/presence/src/visitors.js`, tests in `tests/visitors.test.js`).
`POST /dev/online` (signed-in dev session only) returns them grouped by IP for dev.html → Online.
Nothing about visitors is written to storage or logged; it lives only on the open socket and is gone
when the tab closes. Help → About says so; keep that line accurate if this changes. The same Worker takes question
reports at `/report` (see Question reports) and the dev page password at `/dev/*` (see dev.html). Redeploying is the owner's step
(`npx wrangler deploy` in that folder).

## Question reports

Players press **Report** on a question (after the answer, in the session history, on the
Questions and Saved pages), pick what's wrong and can add details. `js/report.js` posts it to
`CONFIG.reportApi` (`/report` on the presence Worker, `worker/presence/src/report.js`), which opens
a GitHub issue on this repo labeled `question-report`, titled `Question <id>: <problem> (<set> R<round> #<num>)`;
another report on a question with an open issue becomes a comment on it. The Worker needs the
owner's `GITHUB_TOKEN` secret (fine-grained, Issues read/write on pts; see the Worker README); if
it can't send, the form offers a prefilled GitHub "new issue" link instead. Reported IDs are kept
in `pts.reported.v1` so the button says "Reported ✓".

Finding a question by ID: cards on the Questions and Saved pages and session-history entries show `ID <id>`
(`.qid`, just left of the set name, or after Report in history; with a mouse only while hovering the question, always on touch screens). A Questions-page search that is just an ID ("1qy21vz", "ID 1qy21vz", "#1qy21vz";
`questionForSearch` in `js/questions.js`) shows that one question and ignores the other filters; an
ID-looking search with no match (`looksLikeId`) says so and points to the other competition.
`#questions?id=<id>` (with `?comp=osb` before the `#` for OSB) opens the page searched for it.
Clicking a card's "Set, Round, #num" on the Questions page (`sourceLink`/`showInRound` in `js/app.js`) clears the
filters, picks that set and round, and opens the page holding that question (outlined, `.focused`); a set+round view is
sorted by number, toss-up before bonus, so visual bonuses sit in their place. **Sort by** (`#db-sort`, `sortQuestions` in
`js/app.js`: packet order, easiest/hardest, newest/oldest set, set A–Z, subject; ties keep bank order) with a ⇅ button
(`#db-sort-next`) that steps to the next option (Shift: previous). Owner removed the Questions page's "Saved only" box
(saved questions are on the Saved page).

dev.html → **Reports** tab: every `question-report` issue (open, closed or all; filter by problem, bank, search; sort
newest / oldest / most reports / set order), each with its reports (comment, the player's answer and "Checker now:
accepted/rejected" against the current bank), comments on the issue, and the question as the bank has it now (marked when
its text or answer changed since the report). Buttons: Edit, Question tab, try the players' answers in the checker,
GitHub; Close: fixed / Close: not changed (optional comment) / Reopen use the Review tab's token, which then needs
Issues: Read and write. Reads use the public API (the token when there is one, for the rate limit); the tab label shows the open count.

When the owner says "check the reports" / "fix the issues":
- List them: `gh api 'repos/lightningale23/pts/issues?labels=question-report&state=open&per_page=100'`
  (REST only; GraphQL is blocked here). Each issue body and comment ends in a ```json block:
  `id`, `comp` (sb/osb → `data/questions.csv` / `data/osb-questions.csv`, or `data/visual-bonuses.csv`
  when `q.image` is set), `reason` (answer, ruling, text, math, choices, picture, category, other),
  `comment`, `given` (the player's answer) and `ruled`, plus the question as the player saw it.
  Read the comments too: `gh api repos/lightningale23/pts/issues/N/comments`.
- Find the row by `id`, fix it in place with the csv module (never change the id). `ruling`
  reports are usually an `accept` alternate or a checker fix (add a test, see Answer checker
  conventions). Check the fix against the packet when the report is unclear.
- Commit with `Closes #N` for each fixed issue (pushing to `main` closes them) and a `Changelog:`
  line. Reports that are wrong or can't be fixed: close with a short comment saying why
  (`gh api -X POST .../issues/N/comments -f body=...`, then `gh api -X PATCH .../issues/N -f state=closed -f state_reason=not_planned`).
- Then tell the owner what was fixed and what was closed without a change.
- 2026-11-15 sweep after reports: short answers whose last four lines were W)–Z) with a letter answer became
  Multiple Choice (244; multi-part ones and a few whose key didn't match an option stay), and answers ending in
  the next question's header ("Halftime", "Visual Bonus", "[YL] LONG BONUS" → `writer: YL`, "TOSS-UP---") were
  trimmed (68). Check for these again after big imports.
- 2026-11-21 format sweep of all three banks (~700 rows): writer/category tags after answers (`[SY] cell bio`,
  `<spencerd> [Calc II]`, `[LW] [Quantum] Visual`, "BUMS Special", "End of packet", "ESTIMATION") → `writer: XX` /
  `note: ...` in notes; MC answers set to `L) <option text>` (read guides dropped) wherever the key's text differed,
  the old key kept as `packet answer: ...` when the letter changed (35 had the wrong letter, decided by the science);
  NSBA1/NSBA2/MOSFET 2021 power marks (`*`, `**`) removed from text and choices; Packets 2026 / Prometheus 2022
  choices Excel had turned into dates or serials (`2025-03-04 00:00:00`, `44861`) rebuilt as fractions; choices a
  packet printed twice rewritten to the missing combination (noted); inline ACCEPT / DO NOT ACCEPT moved to fields;
  same-round import duplicates removed (`-2` IDs and others). Not errors: CLASH #21A/B bonuses, OSB toss-up/bonus
  subjects not matching (NOSB 2018, Blue Heron and June Yin pair them that way), packet subject labels like
  ICSBT1 DE6 T22 "Physics" for a CS question. Rerun after big imports: MC answer text vs option, `\[[A-Z]{2,3}\]`
  at the end of answers, `\d{4}-\d\d-\d\d 00:00:00` in xlsx-read sets, `*` at the end of choices.

## Give up

Practice controls: Next, **Give up** (`G`, `#btn-giveup`), Skip, Pause. Give up (`engine.giveUp`) reveals the
answer with outcome `gaveup` and stays on the question until Next (Skip reveals and moves on at once). Stats record it
as `dead` (not buzzed); the session history says "Gave up". Host only in rooms, like Skip. On phones the four buttons
are one row (`.controls` grid of 4). The button is `hidden` in index.html and shown by `clear()` (made by GameView if the
page lacks it), so a new page with an old cached script never shows a dead button (an iPhone report right after release).

Stars (`.star-btn`) are `inline-flex` with a zero-width character (`::before`) so they have a text baseline and sit
centered on the text in baseline-aligned rows (practice header, Questions/Saved cards).

## Multiple choice on touch screens

On a device with a touch screen (`any-pointer: coarse`), a multiple-choice question you can answer
shows W X Y Z buttons under the answer box (`#mc-buttons`, `useButtons` in `js/game-view.js`);
tapping one submits that letter (placeholder "Tap a letter"). When touch is the main input (`pointer: coarse`, phones and
iPads) the answer box isn't focused, so the keyboard doesn't cover the buttons. Typing still works.

## Tap the answer box to buzz

The answer box is disabled until you buzz, and disabled inputs get no taps, so a clear button
(`#answer-tap`, shown by CSS only while `#answer` is disabled) covers it and calls `pressBuzz`
(works for every pointer, not just touch). On phones (`pointer: coarse`) the placeholder says
"Tap here to buzz" instead of "Press space to buzz". In solo the buzz is synchronous, so the
keyboard opens on the same tap for short answers.

## Phones and small screens

Owner asked (2026-11-22) for consistent locations on phones and a top bar that doesn't wrap. CSS at the end of
`css/style.css` ("Small screens"):
- ≤ 1000px: tighter top bar (tab padding, no "online" word) so all six tabs fit on one line.
- ≤ 820px (phones, iPad portrait): `.tabs` becomes a fixed bottom tab bar (icons `.tab-icon` in each tab in
  `index.html`, labels `.tab-label`; the Saved count is `.tab-count`, "(3)" on desktop, a badge on phones, set by
  `drawSavedCount` in `js/app.js`); the top bar is one row (wordmark, badges, SB/OSB, theme). Hidden while a text box
  has focus on touch screens (keyboard open). `body` gets bottom padding; safe areas via `viewport-fit=cover` + `env()`.
- Practice: `#dock` wraps `.buzz-row` and `.controls` (`display: contents` on desktop, where `order` keeps question,
  buzzer, answer, buttons). On phones the stage fills the screen, the reveal sits right under the question, and the dock
  is `position: sticky` at the bottom (above the tab bar), so the buzzer and Next/Give up/Skip/Pause are in the same place for
  every question. `revealIntoView`/`stageIntoView` in `js/game-view.js` scroll the answer / the new question into sight
  (only when the dock is sticky). Landscape phones (height ≤ 500px) don't pin it.
- Key hints (`kbd`) in buttons are hidden on touch screens; `.keys-only`/`.touch-only` spans pick "Press N" vs "Tap".
- Questions page filters are a two-column grid. Changing tabs scrolls to the top (`route`).
- Rooms on phones (owner, 2026-11-22): the room bar is one line (`.room-label`/`.room-role` hidden, buttons' short
  labels `.s` instead of `.l`); `.play-main`/`.play-side` are `display: contents` so the order is room bar, stage, Players,
  This session, settings; `#chat-panel` is a fixed panel over the bottom, opened by the room bar's Chat button
  (`chatButton`/`setChatOpen`/`chatUnread` in `js/app.js`, `body.chat-open`, `.chat-badge` counts messages from others
  while closed; ✕ or Esc closes). A player (only Next) gets the score beside Next.
- Listen-mode notes (voice off, no read-aloud, another voice than the host's) are one small line `#q-note` (`note()` in
  `js/game-view.js`), not the status line under the buzzer. A room player whose device can't play the voice follows the
  host's: the engine sends `spoken` {at} whenever `listenAt` moves (`on_spoken`, `following`), the ghost holds the space,
  and the rest shows at `readEnd`. Solo and the host still get the whole question at once.
- Rooms can be tried here with `?net=local` (two pages of one Playwright context); real rooms need PeerJS's CDN, which the
  cloud container blocks.

## Desktop layout

Owner asked (2026-11-22) for a better desktop experience after the phone work:
- One 1280px column everywhere: `.play-grid`, `.wide` (Questions, Saved, Stats) and `.help-layout`; the top bar's
  side padding lines it up with that column. Rooms stays `.narrow` (760px, centered).
- The question box (`.qtext`) is at least 7 lines tall (`min(11.2em, 34vh)`, 85% of SB questions fit), so the
  buzzer is in the same place from one question to the next; longer questions still push it down.
- Questions page filters: a 4-column grid at ≥ 821px (Search | Subject | Subcategory; Type | Set | Round | Sort;
  Difficulty | Clear filters); `/` focuses the search box there.
- Help: `helpContents` (`js/app.js`) builds the "On this page" list (`#help-toc`, sticky, ≥ 961px) from the `h2`s in
  `#help-body` plus the Changelog; buttons, not `#` links (the hash is the route), and the section in view is marked.
- `?` on any page (not while typing) opens the Help page's key list in `#dialog`. The offline build rewrites the `/`
  line of that list (`help: chat key` in `offline/build.mjs`); keep them in step.

## Select-all and ordering questions on touch screens

`listPick` (`js/text.js`) finds short-answer questions with a numbered list (`1)`/`1.` or `I)`/`I.`,
one per line or all on one line; `listLabels`) whose stem asks to order (`isOrderingQuestion`) or to
pick ("all", "which ... of the following", "of the following ..., which"; not "answer the following
questions" or "for each of the following"): about 2,400 SB
ordering and 4,900 select-all questions. `metaOf` carries it as `meta.pick` `{mode, n, roman}`. On a
touch screen the view shows number buttons under the answer box (`#pick-buttons`, `drawPick` in
`js/game-view.js`): ordering taps build a sequence (tap again to take one out), select-all taps
toggle; the answer box shows what will be sent (`pickAnswer`: "2, 1, 3", "I, III"); Submit with
nothing picked sends "None". The checker takes "None" for keys "None of them"/"Neither"
(`isNoneWord`) and uses `listLabels` for one-line lists; its ordering test is `isOrderingQuestion`
(so "in order to", "bond order" aren't orderings). Every bank answer written as numbers is accepted
as tapped, except ~85 rows whose key has packet junk ("2 AND 3 [HJ] LDE", "ALL <name>").

## The buzzer doesn't move while a question is read

- `#q-ghost`: an invisible copy of the whole question shares a grid cell with `#q-text`, so the
  text box is its full height from the first word. The engine's `question` event carries `layout`
  (the tokens; not in listen mode); `RoomHost` sends players `maskTokens(layout)` (letters replaced
  by same-width letters, math kept) so the question can't be read early.
- The header's subject/type/format are in place but `visibility: hidden` (`.pending`) until the
  lead-in reads them (`prepareHeader`/`showHeader`).
- `.buzz-row` is top-aligned (things under the answer box grow down), and buzz marks take no width.
  It lives in `#dock` with the buttons (see Phones and small screens).
- The stats page's rows were also `.buzz-row`; their CSS is scoped to `.buzz-rows > .buzz-row`.

## Bold order words

In ordering questions ("Rank the following ... by increasing ...", "from lowest to highest"),
`markKeyWords` in `js/text.js` flags the direction words (`token.key`; increasing / decreasing /
ascending / descending / chronological, and "X-est ... to Y-est" / least / most / first / last
phrases) and they show in bold, not highlighted (owner's choice; `mark.key`). Only the question's own words before its list
are searched, and only when `isOrderingQuestion` sees an ordering verb ("in order to", reaction
and bond order don't count). About 2,200 SB questions get bold words. Tests in `tests/text.test.js`.

## dev.html

**Password screen** (owner, 2026-11-21): dev.html shows only a password form; `js/dev-gate.js` sends it
to the presence Worker (`CONFIG.devAuthApi`, `/dev/login|check|password|logout`,
`worker/presence/src/devauth.js`, tests in `tests/devauth.test.js`), which returns an HMAC-signed session
(12 h, or 30 days with "Keep me signed in"; `pts.dev.session.v1` in session/localStorage), and only then
does it `import('./dev.js')`. A saved session is re-checked by the Worker on every load. The password is the
Worker secret `DEV_PASSWORD`, or a PBKDF2 hash in the Durable Object after a change on the page (Password
button); a new `DEV_PASSWORD` secret resets it. Changing it or "Sign out everywhere" rotates the signing key.
10 wrong passwords in 15 min pause logins (site-wide count, nothing about the sender stored). Never put the
password or a check of it in the page or repo. The repo is public, so dev.js's code can still be read on
GitHub; what the gate protects is the page itself, and saving still needs the owner's GitHub token.

Unlinked troubleshooting page: question inspector by ID (what the voice is given), answer
checker lab, speech lab (voices, respellings, voice pace, room voice matching), localStorage
editor, sample stats, per-set checker runs, review queue with auto-fill (below), bank editor (Editing the bank), question
reports (Reports tab, see Question reports), who's online (Online tab, see Online badge), network test. Keep it working when modules it
imports change; no changelog entries needed.

Browser storage keys (`pts.*`): `settings.v2`, `roomSettings.v1`, `bookmarks.v1`, `reported.v1`,
`voicePace.v1`, `comp` (SB/OSB), `iceServers.v1`, `changelog.commits.v1`, `dbPerPage`, `rate.v1` (rate.html),
`dev.session.v1` (dev page session), `dev.*` (Edit tab: `dev.edits.v1` unsaved edits, `dev.editDrafts.v1`). Changing a stored format needs a new version suffix or a migration.

## Review queue

Questions in the packets that aren't in the bank, for the owner to fix by hand and add (dev.html →
Review tab).
- `importer/review_queue.py --sb ROOT --osb ROOT [--only NAME]` re-reads every folder
  `IMPORTED.md` lists and queues what isn't in the bank (fuzzy match on text and answer, so repeats
  and hand-fixed questions don't show): visual bonuses, image questions, rows dropped at import
  (reason guessed: picture equation, no ANSWER, bad MC...), and ANSWER lines the reader found no
  question for in partly read packets. Writes `review/queue.json` and a WebP screenshot per
  question in `review/img/` (cropped from the PDF page; Word files go through LibreOffice).
  `--only` keeps other folders' items. Set/round/year come from the same file's questions that
  are in the bank, so they match the names already used.
- The fuzzy match used to call different questions the same ("What is 125 squared?" = "165 squared",
  same stem with other numbers or another answer), so they never reached the queue. Since 2026-11-21
  `Bank.find` skips a candidate whose numbers differ when the answers differ too (unless the reader
  garbled the math: `(cid:`, `$_{`...). Merge-time repeats (`merge_into_bank.py`) are exact only.
- The tab saves decisions to `review/decisions.json` through the GitHub API with a fine-grained
  token the owner pastes (stored in `pts.dev.reviewToken`, never in the repo); without one it
  downloads the file. Unsaved decisions: `pts.dev.review.v1`; edits in progress:
  `pts.dev.reviewDrafts.v1`. Items are keyed by `rid` (hash of folder, file, round, number, text),
  stable across rebuilds of the queue.
- The "Apply review" Action checks out `main` (not the triggering commit) and runs one at a time; a
  stale checkout made a queued run conflict with the run before it ("approve 8", 2026-11-11).
- The "Apply review" Action runs `importer/apply_review.py` on pushes to `decisions.json`:
  approved rows go through `merge_into_bank.py` (cleanup, IDs, subcategories), get recorded in
  `review/applied.json` (rid → bank id, or repeat), a changelog entry and a `Changelog:` commit
  line. Only the dev page writes `decisions.json` and only the Action writes `applied.json`.
- Added questions (and repeats) leave the queue: `apply_review.prune_queue` drops their items from
  `queue.json` and their screenshots, on every run (2026-11-16: the 174 added so far were taken off).
  Dismissed items stay (status Dismissed).
- Auto-fill (`js/review-autofill.js`, tests in `tests/review-autofill.test.js`): `suggestFixes(row, {text, subjects, model})`
  lists fixes as chips (✨ = safe, `auto`; ? = the reviewer decides); `autoFill` applies the safe ones. Fixes: packet
  header left in the text ("Math – Multiple Choice", "PHYSICS", "T21)", "Question Type") → subject/format/number;
  W–Z options typed into the question → Multiple Choice (not auto when the question has parts); answer tidy (ANSWER:,
  `[AB]` / `[AB] TAG` writer → notes, ACCEPT / DO NOT ACCEPT → fields, but kept inline in multi-part answers); MC
  letter vs text (offers both, never auto); number and toss-up/bonus from the packet text; year/level from the set;
  wrapped lines joined; unicode math in `$…$` → LaTeX; lost ligatures (`\u0000ts` → fits); run-together words
  (split with the bank's word counts; auto only for 3+ words, or 2 with a short word like "of"; 0 false splits on
  20k bank questions); subject guess (naive Bayes on the bank; auto only when the subject is empty).
  `buildBankModel` also finds similar bank questions (Dice on content words) for "dismiss as a repeat".
  On the 2026-11-12 queue it took the to-review items that pass every check from 210 to ~276 of 306.
- Review tab UI: full width; the list scrolls in its own sticky box (all matches, no pages; ready / N to fix /
  ✎ edited tags); filters To review: ready / needs fixing / edited; search matches every word against set, round,
  #number, type, subject, text, answer, file, rid, reason and packet text. Editor: sticky bar (‹ › position, Add,
  Dismiss, Skip, Auto-fill, Undo fill), screenshot column sticky on wide screens. "Auto-fill when I open a question"
  (`pts.dev.reviewAutofill`, default on) fills untouched items once per page visit; "Auto-fill this list" fills all
  shown to-review items as drafts (never approves). Keys: Alt+↑/↓, J/K, Ctrl+Enter add, Alt+D/S/F/Z, `/` search.
  Filters and the open item live in sessionStorage `pts.dev.reviewView`.
- 19 queue items have no answer anywhere in the packet (or are unreadable / SMH joke rounds); the rest have one.
- Built 2026-11-10 from every imported folder: 738 SB questions (375 visual, 146 left out at import,
  87 no ANSWER line, 82 unread ANSWER lines, the rest image/MC/letter problems), ~13 MB of
  screenshots. The first-batch 2025 zips (MIT, Texas, MOSFET, Stanford) and `PDFs/Edited` (Enloe)
  aren't IMPORTED.md rows, so pass them as paths with `--comp sb`. OSB: only text PDFs are re-read
  (`osb_reader.py`); nothing was left out of them, and Word team sheets / scans are skipped.
  Placement only uses bank rows of the folder's own sets (repeats live under other sets).
- 2026-11-11: `importer/visual_bonuses.py` took the 294 visual bonuses it found pictures for out
  of the queue (444 left: 81 visual whose packets have no pictures, 18 image questions, the rest
  as above).

## Editing the bank

dev.html → **Edit** tab: find any question in the three bank files (search every word against ID, set, round,
#number, subject, text, answer, options; filters Reported / My edits / Possible problems / Visual bonuses), fix it
in a form like the Review tab's (auto-fill chips, subcategory picker, preview with the checker), press Keep edit,
then Save. Also reachable from the Question tab's Edit button and the Review tab's similar-question links.
- Save writes `review/edits.json` with the Review tab's token: `{id: {action: edit|remove, file, comp,
  changes: {field: {from, to}}, note, closes: [issue], at}}`. Only changed fields are sent, with old values.
- `.github/workflows/apply-edits.yml` runs `importer/apply_edits.py` on pushes to it: rows change in place (ID
  kept); a field that holds neither `from` nor `to` makes the entry a `conflict` (not applied); a changed subject
  with no subcategory picked is re-tagged (tag_subcategories on the whole bank); `remove` deletes the row and a
  visual bonus's picture. Results in `review/edits-applied.json` (id → at, status, date, detail), a changelog
  entry, then the reports in `closes` get a comment and are closed (`issues: write`). Only the dev page writes
  edits.json and only the Action writes edits-applied.json. It shares the `bank-writes` concurrency group with
  Apply review.
- Reported: open `question-report` issues read from the public GitHub API (no token), with the reports in their
  comments; "Close report #N when this is applied" is ticked by default.
- Possible problems (~480 SB/OSB): rowProblems, W–Z options still in a short answer's text (not multi-part),
  answers with writer initials / ACCEPT left in, MC answer letter whose text is another option (~50, real key
  errors), packet headers, broken lines.

## Importing packets

- Full instructions: `importer/IMPORT_PROMPT.md` (also usable as a prompt for a new chat).
  Record every imported folder in `importer/IMPORTED.md`.
- All packets (every set in the banks was imported from them) live on the owner's computer: `C:\Users\tobyw\Documents\scibowl-packets` (SB) and
  `C:\Users\tobyw\Documents\NOSB packets` (OSB). Reach them through the linked-computer
  tools, or ask the owner to attach them. Zips usually hold an inner folder of the same name.
- Tools: `packet_reader.py` (PDF/DOCX/TXT/IBP), `xlsx_reader.py`, `osb_reader.py`,
  `merge_into_bank.py` (dedupe, SA→MC, cleanup, LaTeX fixes, IDs, subcategories), `check_answers.mjs`, `ids.mjs`,
  `tag_subcategories.py`, `fix_latex.py`.
  `pip install --break-system-packages pdfplumber python-docx wordfreq openpyxl scikit-learn`.
- Owner decisions: **no OCR'd scans** (LOST2 was removed for that; `ocr_scan.py` is
  unused); skip meme/joke rounds and questions whose equations/diagrams are images; visual
  bonuses don't go in the bank but in `data/visual-bonuses.csv` (see Visual bonuses);
  short set names like `MIT 2025`, keep names the owner chose before.
- Answer lines come in many spellings (ANSWR, ANWER, "ANSWER X)", "Answer-", "[ANSWER] 180", all-caps "ANSWER 2, 3, 1");
  `ANSWER_RE` in `packet_reader.py` (and `ANSWERISH` in `review_queue.py`) takes them all. A missed one ends up
  glued to choice Z or the question text with no answer.
- After an import, `importer/review_queue.py --sb ROOT --only "FOLDER"` adds what it left out
  to the review queue, then `importer/visual_bonuses.py --sb ROOT --only "FOLDER"` adds its
  visual bonuses with pictures (commit `review/` and `data/`).
- `pip install --break-system-packages python-pptx` too for the slide decks.
- Joke rounds are never read: `JOKE_FILES` in `packet_reader.py` (`read_tournament`, so also the review queue
  and visual bonuses) skips packet files matching it. Owner, 2026-11-22: Roundshare 2024's Princess Anne rounds
  ("Princess Anne Round 2", "david (princess anne) meme round") are joke questions; their 45 bank rows and 50
  queue items were removed. Add other joke rounds the owner names to that pattern.
- `CHAT_PROMPT.md` and `import_packets.py` are from the old Google Sheet / API workflow.

## Working offline (iPhone home-screen app)

`sw.js` (registered at the end of `boot()` in `js/app.js` on http(s) only; `?nosw` skips it) makes the
site work with no internet after one online visit; that's how the iPhone/iPad home-screen app works
offline (Help → Without internet). Install caches `SHELL` (page, css, every js module, icons), `DATA`
(the banks, ~14 MB, only if not cached yet), KaTeX and Google Fonts CSS with their woff2 files, and
every picture named in `data/visual-bonuses.csv` (~12 MB). Own files are network first (6 s timeout
when a copy exists; non-navigation requests use `cache: 'no-cache'` so the browser's HTTP cache, 10 min on GitHub Pages,
can't mix an old script with a new page), so online visits get the latest site and questions and refresh the cache (an
unchanged ETag skips the rewrite); CDN files are cache first; rooms, presence, reports and GitHub
aren't touched. **A new module in `js/` must be added to `SHELL`** (`tests/sw.test.js` checks the
import graph, the bank files and index.html's CDN URLs). `CACHE` (`pts-offline-v1`) changes only if
the cache layout does. Home-screen apps on iOS keep their own storage, separate from Safari's.
Help → Without internet has a status line (`#offline-status`, `updateOfflineStatus` in `js/app.js`, polled
while Help is open): the page posts `offline-status` to the worker (installing, waiting or active) and
`offlineStatus()` in `sw.js` counts core files (SHELL, DATA, pictures) and extras (CDN math and fonts);
"Ready" means core is all saved. Missing extras are fetched again whenever the status is asked for.

## Offline app

`offline/` builds a copy of the site that runs from disk with no internet (Mac/Windows, any modern
browser): `cd offline && npm install && node build.mjs` → `offline/dist/pts-offline/` and
`pts-offline.zip` (gitignored). Players unzip it and open `pts.html` (or the Mac/Windows launchers,
which open Chrome/Edge in app mode). How it works: esbuild bundles `offline/entry.js` (fetch shim →
config overrides → `js/app.js`) into one classic script, since file:// can't load ES modules; each
`data/*` file becomes `app/data/<name>.js`, loaded by the shim the first time it's fetched; KaTeX,
the two fonts and `data/visuals/` are copied in. `overrides.js` blanks the online settings and sends
`#rooms` to Practice; CSS in `build.mjs` hides Rooms, Report, Search Google, the online badge and
Reload questions; the Help page gets a "This offline copy" section with the build date. The build
warns if an `index.html` edit it makes no longer matches. Rebuild after bank changes.

## Known issues and ideas

- 15 bank bonuses point at a picture that isn't in the released packets (checked 2026-11-16):
  SBST Spring `1bm7hh3` `1g0s7k5`, SBSTWO R14 `1i8ad5x` `ungkgw` `1r61b55` `1mls1xa`, Texas 2026
  `zmccyh` `1qontkp`, ICSBT1 DE7 `11bbyhr` `z4l6b6`, NCB DE6 `wgpbvt`, ESBOT DE13 `1moj3wd`, DASONI 2
  DE9 `1cnd7vo` (a video), Berkeley Fall 2023 `1adep69` (no slide in the Round 14 deck), SMH 2024
  `3hu2lv`. The owner hasn't decided whether to hide or drop them. The rest were moved to
  `data/visual-bonuses.csv` with pictures (see Visual bonuses).
- Missing question numbers (sweep of 2026-11-21, every set re-read against the packets): what's left
  is explained, not lost. Most are repeats (merge skips a question already in the bank, often from
  another tournament: WSBT 2023 reused SSBT, CSBL 2 Rounds 1-3 are Deadbird / NNHS 2021 rounds, Packets
  2026 reuses its own packets). Also by design: no bonus after a General Science / tiebreak toss-up
  (BASED B24, BUMS, NSI B20); DVMS "Round N Supplemental" rounds only have #19-23; packet slips (ESBOT DE12
  and WSBT Finals 2 have no bonus 19 / 18-19; MSJ R1's two unnumbered toss-ups are #18-19 with no
  bonus). Still open: visual bonuses whose released packet has no picture (SBST Spring, SBSTWO, NCB
  DE6, ICSBT1 DE6, Texas Finals 1 #3, SSBT Playoff 4 #21 is only a link) and LOST3's 18 image
  questions (`.ibp`, no pictures). Packets often print a bonus as "TOSS-UP" or with the wrong number;
  check the order in the packet (the second question after an answer is the bonus).
  OSB gaps (Blue Heron, Lake Sturgeon team sheets, NOSB 1999 scan) were left as they are: those
  files were imported by hand, skipping repeats and questions with doubtful answers ("What animals
  have ambergris? Squid"); "Questions 4" holds two numbered lists under one round name.
- To add a visual bonus by hand: take the original picture out of the Word file (`word/media/`, matched
  to the question by the text before the `r:embed`), a slide deck (`python-pptx` picture blobs) or the
  PDF (`page.images` box at 200 dpi), append the row to `data/visual-bonuses.csv`, give it an ID with
  `visual_bonuses.assign_ids`, save it with `visual_bonuses.save_image`, tag the subcategory.
- `README.md` still describes the Google Sheet workflow (see Layout).
- WSBT 2023 playoff/finals PDFs lost most math (equation objects). 2026-11-21: `hduwsc`, `k4eylm`, `7h6a04`,
  `12g4avv`, `1tdy4f8`, `1wrrd36` rebuilt by hand (`1wrrd36`'s choice Z is a guess); `19og6b2` removed.
- A few SB questions lost math in the PDF and couldn't be rebuilt without the packet (see Importing packets for where they are):
  `1q82pr0`, `18yovb0`, `1tphgvm`, `1gr5dsd`, `j2xh4p`, `1ygds1a`, `phgmf4`, `1jqnhu1`. Some
  Prometheus 2022/2023 choices with radicals (e.g. `92kdjr`, `1gz4zzj`) were rebuilt from where the
  √ landed and are best guesses for the distractors.

## Environment tips

- Serve locally with `python3 -m http.server 8000`; Playwright + Chromium are usually
  available for checking pages.
- Large CSV edits: use Python's `csv` module (DictReader/DictWriter with the column list
  above), then diff against `git show HEAD:data/questions.csv` to confirm only intended
  fields changed and IDs are untouched.
- Don't `pkill -f` broad patterns in the shell; it can kill the shell itself.
