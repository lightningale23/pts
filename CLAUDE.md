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
| `js/questions.js` | Loading banks, `normalizeRow` (IDs), filters, ordering, bonus pairing |
| `js/rounds.js` | Round stages (RR / early, mid, late DE) |
| `js/engine.js` | `GameEngine`: reading, buzzing, timers, scoring, negs, overrides |
| `js/game-view.js` | Reading stage, buzzer lamp/timer ring, after-question view, Search Google button |
| `js/checker.js`, `js/mathval.js` | Answer checking; math answers evaluated and compared by value |
| `js/text.js` | Tokenizing questions for display and for speech (math, degrees, charges, READ guides) |
| `js/speech.js` | Listen mode (Web Speech API), voice pace calibration, early end |
| `js/net.js` | Rooms over WebRTC (PeerJS 1.5.5); relay (TURN) handling |
| `js/settings.js`, `js/stats.js`, `js/bookmarks.js` | Settings (`DEFAULTS`), stats page, saved questions |
| `js/changelog.js`, `js/presence.js` | Help-page changelog; "● N online" badge |
| `dev.html`, `js/dev.js` | Unlinked troubleshooting page (see below) |
| `data/questions.csv` | Science Bowl bank (~42k questions, ~80 sets) |
| `data/osb-questions.csv` | Ocean Science Bowl bank (~2.6k) |
| `data/pronunciations.csv` | Respellings for hard terms (unused while respellings are off) |
| `data/changelog.json` | Changelog entries |
| `importer/` | Packet readers and bank tools (see Importing) |
| `worker/presence/` | Cloudflare Worker for the online badge |
| `tests/` | node:test suites |

`README.md` is the public setup guide. Its Google Sheet and "AI importer" parts describe the
first version; the site now runs from the CSV banks in the repo and packets are read by the
rule-based readers in `importer/`.

## Question banks

- Columns: `id,set,year,level,round,num,type,subject,format,question,w,x,y,z,answer,accept,reject,notes`
- **Never change an existing row's `id`** or drop the column: players' stats and saved
  questions point at IDs. New rows get the ID the site derives (`importer/ids.mjs`, a hash
  of set|round|num|type|question in `normalizeRow`); `merge_into_bank.py` does this.
  Fixing question text in place is fine; the stored ID stays.
- `type` TOSS-UP / BONUS; `format` Short Answer / Multiple Choice; `level` HS / MS.
- SB subjects: Biology, Chemistry, Physics, Mathematics, Earth and Space, Energy (older sets
  have General Science, excluded via `CONFIG.excludeSubjects`, and Computer Science).
  OSB: Biology, Chemistry, Geology, Physical Oceanography, Technology, Social Sciences, Geography.
- Multiple choice: options in `w`..`z`, answer `W) TEXT`.
- Math in LaTeX inside `$...$` (`$x^{2}$`, `$CH_{4}$`).
- `accept` / `reject`: alternates split on `;` **and** `|`, so never put absolute-value bars
  there.
- `notes`: `writer: AB`, `reader note: ...`, `replacement question`, anything not the answer.
- `importer/clean_questions.py BANK [--write]` tidies question text: leading round numbers
  ("[11]"), empty brackets, reader notes ("[read slowly]" → notes), headers, and trailing
  writer initials ("...? [SA]" → `writer: SA`). Imports run it automatically.
- Checks: `node importer/check_answers.mjs data/questions.csv` must accept every official
  answer; the only known failure is WSBT 2023 `m5uyxf` (a symbols-only option).

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
- The buzz timer starts when the last word ends (early end at `lastWordMs`), and a buzz on
  the last word isn't a neg.
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
editor, sample stats, per-set checker runs, network test. Keep it working when modules it
imports change; no changelog entries needed.

Browser storage keys (`pts.*`): `settings.v2`, `roomSettings.v1`, `bookmarks.v1`,
`voicePace.v1`, `comp` (SB/OSB), `iceServers.v1`, `changelog.commits.v1`, `dbPerPage`,
`dev.*`. Changing a stored format needs a new version suffix or a migration.

## Importing packets

- Full instructions: `importer/IMPORT_PROMPT.md` (also usable as a prompt for a new chat).
  Record every imported folder in `importer/IMPORTED.md`.
- Packets live on the owner's computer: `C:\Users\tobyw\Documents\scibowl-packets` (SB) and
  `C:\Users\tobyw\Documents\NOSB packets` (OSB). Reach them through the linked-computer
  tools, or ask the owner to attach them. Zips usually hold an inner folder of the same name.
- Tools: `packet_reader.py` (PDF/DOCX/TXT/IBP), `xlsx_reader.py`, `osb_reader.py`,
  `merge_into_bank.py` (dedupe, SA→MC, cleanup, IDs), `check_answers.mjs`, `ids.mjs`.
  `pip install --break-system-packages pdfplumber python-docx wordfreq openpyxl`.
- Owner decisions: **no OCR'd scans** (LOST2 was removed for that; `ocr_scan.py` is
  unused); skip meme rounds, visual bonuses and questions whose equations/diagrams are
  images; short set names like `MIT 2025`, keep names the owner chose before.
- `CHAT_PROMPT.md` and `import_packets.py` are from the old Google Sheet / API workflow.

## Known issues and ideas

- About 49 questions refer to an image or diagram the site can't show (mostly ESBOT 2023 and
  DASONI 2 2025). The owner hasn't decided whether to hide or drop them.
- `README.md` still describes the Google Sheet workflow (see Layout).

## Environment tips

- Serve locally with `python3 -m http.server 8000`; Playwright + Chromium are usually
  available for checking pages.
- Large CSV edits: use Python's `csv` module (DictReader/DictWriter with the column list
  above), then diff against `git show HEAD:data/questions.csv` to confirm only intended
  fields changed and IDs are untouched.
- Don't `pkill -f` broad patterns in the shell; it can kill the shell itself.
