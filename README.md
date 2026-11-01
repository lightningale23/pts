# pts: Science Bowl practice

A free Science Bowl practice site that runs entirely on GitHub Pages. Questions live in a Google Sheet; an AI importer reads packet PDFs and fills the sheet for you.

**What players get**

- Toss-ups read word by word at an adjustable speed (100–650 wpm, or the whole question at once)
- Optional read-aloud using the browser's built-in voices, kept in step with the words on screen by learning each voice's speed (stops on a buzz, resumes where it left off)
- A buzzer (space bar or the big lamp) with buzz-window and answer timers drawn as a ring around it
- Default mixed mode: toss-ups and bonuses shuffled, everything buzzed and scored like a toss-up, with bonuses keeping their 20-second window. Team games always use it. Other modes: toss-ups with a bonus for the winner (+4 / −4 interrupt / +10 bonus), toss-ups only, bonuses only. All timers and points are adjustable.
- Subject filters (Biology, Chemistry, Physics, Math, Earth and Space, Energy, plus legacy categories), short answer or multiple choice, specific packets, high school or middle school, random or packet order
- Automatic answer checking: multiple choice is strict (letter, exact option text, or an equal number in simplest form); short answers are lenient: ACCEPT / DO NOT ACCEPT notes, optional words in parentheses, typos and plurals, equivalent or more precise numbers (0.5 = 1/2; 9.81 for 9.8), select-all answers typed any way ("13", "1 and 3", "one, three"). "I was right" fixes a bad ruling.
- After each question: the full text with your buzz point marked and the unread part dimmed
- Rooms: create a room, share the code or link, everyone hears the same question and races to buzz. Live answer typing, scoreboard, chat, optional Team A vs B (a wrong answer locks out the whole team), host can overrule answers, late joiners catch up.
- Stats saved in the browser: accuracy by subject, average buzz point, wrong interrupts, bonus conversion, "practice missed questions", CSV export
- A searchable question bank with a "Read this one" button
- Light and dark themes, keyboard shortcuts, works on phones

No build step, no server, no accounts.

---

## 1. Put the site on GitHub Pages

1. Create a new repository on GitHub (public, so Pages is free) and upload everything in this folder, keeping the folder structure.
2. In the repo, open **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
3. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

Until you connect a sheet, the site uses the 36 sample questions in `data/sample-questions.csv`.

## 2. Make the question sheet

1. Create a Google Sheet. Rename the first tab to **Questions**.
2. Import `data/sample-questions.csv` (File → Import → Upload → *Replace current sheet*). That gives you the right header row plus some starter questions. You can delete the sample rows later, but keep row 1.
3. Let the site read it, using **one** of these:
   - **Share it:** Share → General access → *Anyone with the link* → Viewer. Copy the sheet ID (the long string between `/d/` and `/edit` in the URL) into `sheetId` in `js/config.js`.
   - **Publish it:** File → Share → Publish to web → choose the *Questions* tab and *Comma-separated values (.csv)* → Publish. Paste that link into `sheetCsvUrl` in `js/config.js`.
4. Commit the change to `js/config.js`. The site caches the sheet for 30 minutes; the **Reload questions** button on the Help page fetches it immediately.

### Columns

Only `question` and `answer` are required. Column order doesn't matter; names are case-insensitive.

| Column | What goes in it |
| --- | --- |
| `id` | Optional stable ID. The importer fills it; if blank the site derives one. |
| `set` | Packet or tournament name, e.g. `2024 Regional Set 3` |
| `year`, `level` | e.g. `2024`, `HS` or `MS` |
| `round`, `num` | Round and question number. A toss-up and bonus with the same set, round and number are paired. |
| `type` | `TOSS-UP` or `BONUS` |
| `subject` | `Biology`, `Chemistry`, `Physics`, `Mathematics`, `Earth and Space`, `Energy` (common variants like `Math` or `Earth Science` are recognized) |
| `format` | `Short Answer` or `Multiple Choice` |
| `question` | The question. Use `$...$` for math (rendered with KaTeX) and line breaks for numbered statement lists. |
| `w`, `x`, `y`, `z` | Multiple-choice options |
| `answer` | e.g. `X) STRATOSPHERE`, `MITOCHONDRIA (ACCEPT: MITOCHONDRION)`, `(PRIMARY) MOTOR CORTEX`, `1 AND 3` |
| `accept`, `reject` | Extra alternates, separated by `;` |
| `notes` | Anything else; not shown during play |

## 3. Import packets with AI

**No API credits?** `importer/CHAT_PROMPT.md` has a prompt for doing the same thing in a regular Claude chat: attach a packet, paste the prompt, download the CSV, and append it to the sheet. It uses your chat plan instead of the paid API, one packet at a time.

`importer/import_packets.py` sends each packet PDF to Claude, which returns every toss-up and bonus as structured data (category, format, question, choices, answer, alternates, math converted to LaTeX). The script then appends new rows to the sheet, skipping any already there.

### One-time setup

1. **Claude API key:** create one at [console.anthropic.com](https://console.anthropic.com). Usage is billed per request based on packet length and model; check Anthropic's pricing page for current rates.
2. **Python packages:** `pip install -r importer/requirements.txt`
3. **Permission to write to the sheet** (skip if you'd rather paste a CSV in by hand):
   1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google Sheets API**.
   2. Under *IAM & Admin → Service accounts*, create a service account, then *Keys → Add key → JSON*. Save the file as `service-account.json` next to the repo (it's in `.gitignore`; never commit it).
   3. Share your question sheet with the service account's email address as an **Editor**.

### Running it

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Try one packet first and look at the CSV
python importer/import_packets.py "packets/Round 1.pdf" --out preview.csv

# Then import straight into the sheet
python importer/import_packets.py packets/*.pdf --sheet YOUR_SHEET_ID --creds service-account.json \
    --set "2024 Regional Set 3" --level HS
```

Useful options: `--set` names the set (otherwise it's read from the packet, then the file name), `--level HS|MS`, `--year`, `--hint "answers are in a separate column"` for unusual layouts, `--model` to choose a different Claude model, `--ledger packets/imported.json` to remember which files were already done.

PDFs longer than 40 pages are split automatically (with a page of overlap so no question gets cut). Plain-text packets (`.txt`) work too. Scanned packets work because Claude reads the page images, but check those more carefully.

**Always spot-check a few imported questions** against the packet, especially math notation and multiple-choice answers, before sharing the site widely.

### Optional: import by pushing PDFs to GitHub

`.github/workflows/import-packets.yml` runs the importer whenever PDFs are pushed into `packets/`. Add these in **Settings → Secrets and variables → Actions**: secrets `ANTHROPIC_API_KEY` and `GOOGLE_SERVICE_ACCOUNT_JSON` (paste the whole key file), and a variable `SHEET_ID`.

Anything in a public repo is public, and Pages serves it. For packets that aren't yours to share (many invitationals ask teams not to post them), run the importer locally instead.

## 4. How rooms work

Rooms use WebRTC, so browsers talk to each other directly. The free PeerJS service only introduces them. The room creator's browser runs the game, so:

- The host must keep their tab open; closing it ends the room. Players who refresh rejoin with their score.
- Some school or corporate networks block direct connections. If players can't join, try a phone hotspot, or add a TURN server in `peerOptions` in `js/config.js`.
- Change `peerPrefix` in `js/config.js` to something unique to your site.

To test rooms on one computer, open the site with `?net=local` in two tabs of the same browser.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Buzz |
| Enter | Submit answer |
| N | Next question / start |
| S | Skip |
| P | Pause / resume |
| R | I was right (after a question) |
| / | Chat (rooms) |
| Esc | Leave the answer box |

## Customizing

- **Name and look:** `siteName` in `js/config.js`; colors are CSS variables at the top of `css/style.css`.
- **Defaults** (reading speed, timers, scoring): `DEFAULTS` in `js/settings.js`.
- **Answer checking rules:** `js/checker.js`.

## Developing

```bash
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # answer-checker and game-engine tests (Node 18+)
```

| File | Purpose |
| --- | --- |
| `js/questions.js` | Load the sheet, normalize rows, filters, question order and bonus pairing |
| `js/engine.js` | Reading, buzzing, timers, scoring, lockouts, overrides |
| `js/checker.js` | Answer checking |
| `js/game-view.js` | The reading stage, lamp, history |
| `js/net.js` | Rooms (PeerJS host/player, plus a same-device test transport) |
| `js/settings.js`, `js/stats.js` | Settings panel, stats page |
| `js/app.js` | Pages, routing, keyboard, wiring |
| `importer/` | AI packet importer |

Note: the sheet is readable by anyone with the site, so answers are not secret. That's fine for practice; don't put a live tournament's questions in it.
