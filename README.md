# pts: Science Bowl practice

A free buzzer-practice site for Science Bowl and Ocean Science Bowl, live at
**https://lightningale23.github.io/pts/**. It's a static site on GitHub Pages: no build step,
no accounts, no server of its own. Every question lives in CSV files in this repo.

## What's on the site

**Questions.** About 42,500 Science Bowl questions from 80+ sets, 385 visual bonuses with their
pictures, and about 2,500 Ocean Science Bowl questions. The SB / OSB switch at the top picks the
competition; each keeps its own settings, stats and scoring (OSB: 4 a toss-up, 6 a bonus, −4 a neg).

**Practice**
- Questions read word by word (250–1000 wpm) or shown all at once, after a lead-in with the
  subject, type and format.
- Listen mode: the browser's voice reads the question and nothing shows until the answer; the time
  to buzz starts when the voice stops.
- A buzzer (Space, the lamp, or tapping the answer box) with buzz and answer timers drawn as a ring.
- National Science Bowl scoring and timing by default (+4 / +10, −4 neg, 5 s to buzz, 7 s to answer,
  20 s for a bonus, 30 s for a visual bonus), all adjustable.
- Modes: mixed (buzz on everything, the default), toss-ups then bonuses, toss-ups only, bonuses only,
  visual bonuses only.
- Filters: subjects and subcategories (Optics, Calculus, Genetics…), short answer / multiple choice,
  round stages (RR, early/mid/late DE), packets, high school / middle school.
- Visual bonuses show their picture from the start (click to zoom).
- After each question: the full text with your buzz point marked, the difficulty, the set and round,
  I was right / I was wrong, Search Google, Save, Report. Give up, Skip and Pause while it's read.

**Answer checking.** Multiple choice is strict (letter, exact option text, or an equal number). Short
answers are lenient: ACCEPT / DO NOT ACCEPT notes, optional words, typos and plurals, numbers and
expressions compared by value (`1/4 omega` = `ω/4`), select-all and ordering answers typed any way,
and questions in parts checked part by part. A key that was wrong on the packet is fixed, and the packet's
answer shows crossed out under it with the reason. On touch screens, multiple choice and list questions get
tap buttons.

**Difficulty.** Every question has a number (gold, like 4.37): roughly how many teams at an average
online invitational would get it right, d = 5·log10(1/share), so 0 is every team, 5 is 1 in 10, 10 is
1 in 100. Rated by AI against a rubric (`importer/difficulty/RUBRIC.md`); sets and rounds show their
average. The Questions page filters and sorts by it.

**Other pages**
- **Questions:** search and filter the whole bank (subject, subcategory, type, set, round, difficulty),
  sort it, find a question by its ID, open a whole round in order, "Read this one".
- **Saved:** starred questions (B while practicing), to review or practice.
- **Stats:** accuracy, negs and buzz point by subject, recent questions, practice missed questions,
  CSV export. Kept in the browser.
- **Rooms:** create a room, share the code, everyone races to buzz on the same question. Scoreboard,
  chat, optional Team A vs B, host overrules, read-aloud with the host's voice.
- **Help:** how everything works, keyboard keys (`?` anywhere), and the changelog.

It works on phones (bottom tab bar, buzzer and buttons pinned in place) and keeps working with no
internet after one visit, including as an iPhone/iPad home-screen app.

## Running it locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # node:test suites (Node 18+)
```

`?net=local` on the URL lets you try rooms in two tabs of one browser; `?nosw` skips the offline
service worker.

## Code

| Path | What it is |
| --- | --- |
| `index.html`, `css/style.css` | The whole site UI (hash routes: practice, rooms, questions, saved, stats, help) |
| `js/config.js` | Site settings: banks, competitions, room and relay settings, online badge and report addresses |
| `js/app.js` | Pages, routing, keyboard, wiring |
| `js/questions.js` | Loading banks, IDs, subcategories, filters, ordering, bonus pairing |
| `js/engine.js` | Reading, buzzing, timers, scoring, negs, overrides |
| `js/game-view.js` | The reading stage, buzzer, after-question view |
| `js/checker.js`, `js/mathval.js` | Answer checking; math compared by value |
| `js/text.js`, `js/speech.js` | Question text for display and for speech; listen mode |
| `js/net.js` | Rooms over WebRTC (PeerJS), with TURN relays for school networks |
| `js/settings.js`, `js/stats.js`, `js/bookmarks.js` | Settings, stats page, saved questions |
| `js/difficulty.js` | Stored difficulty ratings and the fallback model for unrated questions |
| `js/report.js`, `js/presence.js`, `js/changelog.js` | Report form, "● N online" badge, help-page changelog |
| `sw.js` | Service worker that makes the site work offline |
| `offline/` | Builds a download-and-unzip copy that runs from disk (`node build.mjs`) |
| `worker/presence/` | Cloudflare Worker: online badge, question reports → GitHub issues, dev page password |
| `dev.html` | Unlinked troubleshooting and editing page (password protected) |
| `rate.html` | Unlinked difficulty grid: a question per subject at every 0.25 of rating, to check the ratings by eye |
| `tests/` | node:test suites |

`CLAUDE.md` has the detailed notes on every part: conventions, decisions and known issues.

## Question banks

| File | What's in it |
| --- | --- |
| `data/questions.csv` | Science Bowl bank |
| `data/visual-bonuses.csv`, `data/visuals/` | SB visual bonuses (same columns plus `image`) and their pictures |
| `data/osb-questions.csv` | Ocean Science Bowl bank |
| `data/difficulty.csv` | Every question's difficulty rating (`id,d`) |

Columns: `id,set,year,level,round,num,type,subject,format,question,w,x,y,z,answer,accept,reject,notes,subcategory`.

- **Never change an existing `id`**: players' stats and saved questions point at it. New rows get
  the ID the site derives from set, round, number, type and question text (`importer/ids.mjs`).
- `type` is `TOSS-UP` or `BONUS`, `format` `Short Answer` or `Multiple Choice` (options in `w`–`z`,
  answer like `W) TEXT`), `level` `HS` or `MS`.
- Math is LaTeX in `$...$` (rendered with KaTeX); a literal dollar sign is `\$`.
- `accept` / `reject` alternates are split on `;` and `|`.

### Adding and fixing questions

- **Importing packets:** rule-based readers in `importer/` (`packet_reader.py` for PDF / Word /
  text, `xlsx_reader.py`, `osb_reader.py`), then `merge_into_bank.py` (dedupe, cleanup, LaTeX fixes,
  IDs, subcategories) and `check_answers.mjs`. `importer/IMPORT_PROMPT.md` has the full steps and
  `importer/IMPORTED.md` lists every folder imported. No OCR'd scans.
- **Visual bonuses:** `importer/visual_bonuses.py` finds each one's picture in the slide deck or packet.
- **Review queue:** `importer/review_queue.py` collects packet questions that didn't make it into the
  bank (with screenshots); they're fixed and approved on dev.html → Review, and the Apply review
  workflow adds them.
- **Editing:** dev.html → Edit changes any question in place; the Apply edits workflow writes it to
  the bank and closes the reports it fixes.
- **Reports:** the Report button opens a GitHub issue labeled `question-report` through the presence
  Worker; dev.html → Reports lists them.
- **Difficulty:** new questions use the fallback model until rated with
  `importer/difficulty/v2/batch_api.mjs` (Claude API).

## Online services

- **Rooms** use the public PeerJS broker to connect browsers; the host's browser runs the game. Metered
  TURN relays in `js/config.js` get through school Wi-Fi, VPNs and managed Chromebooks.
- **Presence Worker** (`worker/presence`, Cloudflare Workers free plan): the online badge, question
  reports (needs a `GITHUB_TOKEN` secret) and the dev page password. Deploy steps are in its README.

## Changelog

Every change players would notice gets a plain-language line in `data/changelog.json` (newest day
first) and the same text as a `Changelog: ...` line in the commit message. The Help page shows the
JSON, plus commit lines from commits newer than the JSON's last change.

## Old parts

The first version loaded questions from a Google Sheet filled by an AI importer. That path is no
longer used: `sheetCsvUrl` / `sheetId` in `js/config.js` are blank, and `importer/import_packets.py`,
`importer/CHAT_PROMPT.md`, `importer/ocr_scan.py` and `.github/workflows/import-packets.yml` are left
from it.
