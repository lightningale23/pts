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
| `index.html`, `css/style.css` | The whole site UI (hash routes: practice, rooms, questions, saved, stats, help) |
| `js/config.js` | Site settings: banks, competitions (SB/OSB), PeerJS prefix, relay servers, presence URL, `repo`, `respellings` |
| `js/app.js` | Pages, routing, keyboard, wiring |
| `js/questions.js` | Loading banks, `normalizeRow` (IDs), subcategory list, filters, ordering, bonus pairing |
| `js/rounds.js` | Round stages (RR / early, mid, late DE) |
| `js/engine.js` | `GameEngine`: reading, buzzing, timers, scoring, negs, overrides |
| `js/game-view.js` | Reading stage, buzzer lamp/timer ring, after-question view, Search Google button |
| `js/checker.js`, `js/mathval.js` | Answer checking; math answers evaluated and compared by value |
| `js/text.js` | Tokenizing questions for display and for speech (math, degrees, charges, READ guides) |
| `js/speech.js` | Listen mode (Web Speech API), voice pace calibration, end of reading |
| `js/net.js` | Rooms over WebRTC (PeerJS 1.5.5); relay (TURN) handling |
| `js/settings.js`, `js/stats.js`, `js/bookmarks.js` | Settings (`DEFAULTS`), stats page, saved questions |
| `js/changelog.js`, `js/presence.js` | Help-page changelog; "● N online" badge |
| `dev.html`, `js/dev.js` | Unlinked troubleshooting page (see below) |
| `js/review.js`, `review/` | Review queue of left-out questions (see Review queue) |
| `data/questions.csv` | Science Bowl bank (~42k questions, ~80 sets) |
| `data/osb-questions.csv` | Ocean Science Bowl bank (~2.6k) |
| `data/visual-bonuses.csv`, `data/visuals/` | SB visual bonuses (bank columns + `image`) and their pictures (`<id>.webp`); see Visual bonuses |
| `data/pronunciations.csv` | Respellings for hard terms (unused while respellings are off) |
| `data/changelog.json` | Changelog entries |
| `importer/` | Packet readers and bank tools (see Importing); `visual_bonuses.py` finds visual bonus pictures |
| `worker/presence/` | Cloudflare Worker for the online badge |
| `.github/workflows/apply-review.yml` | Adds questions approved on the Review tab to the bank |
| `tests/` | node:test suites |

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
- Checks: `node importer/check_answers.mjs data/questions.csv` must accept every official
  answer; the only known failure is WSBT 2023 `m5uyxf` (a symbols-only option).

## Visual bonuses

Questions that come with a picture. They live apart from the bank in `data/visual-bonuses.csv`
(the bank's columns plus `image`, a path like `data/visuals/<id>.webp`), listed in the SB
competition's `bankFiles` in `js/config.js`, so they load with the bank (`normalizeRow` keeps
`image`). Built 2026-11-11: 294 SB bonuses from 22 sets (160 from slide decks); OSB has none yet
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
- `review_queue.Bank` counts the visual file as part of the bank, so imported visual bonuses
  don't come back into the queue.

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
- When fixing a wrong ruling, add a test to `tests/checker.test.js` and re-run
  `check_answers.mjs` on both banks.

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

## Online badge

`worker/presence` is a Cloudflare Worker + SQLite Durable Object with hibernating WebSockets
(auto-response ping/pong, so idle tabs cost nothing). Deployed by the owner at
`wss://pts-presence.albertsonseinstein.workers.dev/online` (`CONFIG.presenceUrl`), allowed
origin `https://lightningale23.github.io`. Tabs disconnect after 5 minutes hidden. It stores
and logs nothing about visitors (no IPs); keep it that way. Redeploying is the owner's step
(`npx wrangler deploy` in that folder).

## dev.html

Unlinked troubleshooting page: question inspector by ID (what the voice is given), answer
checker lab, speech lab (voices, respellings, voice pace, room voice matching), localStorage
editor, sample stats, per-set checker runs, review queue (below), network test. Keep it working when modules it
imports change; no changelog entries needed.

Browser storage keys (`pts.*`): `settings.v2`, `roomSettings.v1`, `bookmarks.v1`,
`voicePace.v1`, `comp` (SB/OSB), `iceServers.v1`, `changelog.commits.v1`, `dbPerPage`,
`dev.*`. Changing a stored format needs a new version suffix or a migration.

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
  unused); skip meme rounds and questions whose equations/diagrams are images; visual
  bonuses don't go in the bank but in `data/visual-bonuses.csv` (see Visual bonuses);
  short set names like `MIT 2025`, keep names the owner chose before.
- Answer lines come in many spellings (ANSWR, ANWER, "ANSWER X)", "Answer-", "[ANSWER] 180", all-caps "ANSWER 2, 3, 1");
  `ANSWER_RE` in `packet_reader.py` (and `ANSWERISH` in `review_queue.py`) takes them all. A missed one ends up
  glued to choice Z or the question text with no answer.
- After an import, `importer/review_queue.py --sb ROOT --only "FOLDER"` adds what it left out
  to the review queue, then `importer/visual_bonuses.py --sb ROOT --only "FOLDER"` adds its
  visual bonuses with pictures (commit `review/` and `data/`).
- `pip install --break-system-packages python-pptx` too for the slide decks.
- `CHAT_PROMPT.md` and `import_packets.py` are from the old Google Sheet / API workflow.

## Known issues and ideas

- About 49 bank questions refer to an image or diagram the site can't show (mostly ESBOT 2023
  and DASONI 2 2025). The owner hasn't decided whether to hide or drop them. (Not the visual
  bonuses: the reader left those out; they're in `data/visual-bonuses.csv` with pictures.)
- `README.md` still describes the Google Sheet workflow (see Layout).
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
