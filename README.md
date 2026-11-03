# pts: Science Bowl practice

A free Science Bowl practice site that runs entirely on GitHub Pages. Questions live in a Google Sheet; an AI importer reads packet PDFs and fills the sheet for you.

**What players get**

- Toss-ups read word by word at an adjustable speed (100–650 wpm, or the whole question at once)
- Optional listen mode: the question is read aloud by the browser's built-in voice with no text on screen until the answer (stops on a buzz, resumes where it left off). Pronunciation guides printed in questions are skipped. Saying hard terms from respellings (the packet's guides, or `data/pronunciations.csv`) is built but off for now, since some voices spell them out; set `respellings: true` in `js/config.js` to turn it on
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

## 2. Questions

The site always loads `data/questions.csv` (the question bank stored in this repo, listed under `bankFiles` in `js/config.js`). A Google Sheet is optional and is added on top, which makes it the easy place to add new questions. If neither exists, the site uses the samples in `data/sample-questions.csv`.

### Optional: a Google Sheet for new questions

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
| `id` | Optional stable ID. Every row in `data/questions.csv` has one (practice stats are saved against it), so keep it when editing a question. If blank, the site derives one from the set, round, number, type and question text. |
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

**Free, no AI:** `importer/packet_reader.py` reads packets by their printed layout (TOSS-UP / BONUS headers, `12) PHYSICS – Multiple Choice`, W/X/Y/Z options, `ANSWER:` lines) and writes CSVs in this format. It handles PDFs, Word files (including Word equations) and plain-text `.ibp` packets, loose or in .zip archives, one folder or zip per tournament, and turns superscripts, subscripts and stacked fractions into LaTeX. It needs `pip install pdfplumber python-docx` (`wordfreq` is optional and improves joining of hyphenated line breaks).

```bash
python importer/packet_reader.py "path/to/Tournament folder" more.zip --out parsed/
```

It writes one CSV per tournament, `all.csv`, and `report.json`, which lists every packet with its question count and anything to check. Visual bonuses are skipped because they need their images. Scanned packets with no text layer need OCR first: `python importer/ocr_scan.py scans/*.pdf --out text/` (needs `tesseract`, poppler's `pdfimages`, Pillow, numpy and scipy) writes a `.txt` per packet for the reader; check OCR'd questions closely, since formulas and exponents in scans are hard to read. Set names come from the packet title, so shorten them (for example to `MIT 2025`) before adding rows to the bank, and give new rows an `id`.

**Ocean Science Bowl:** the SB / OSB switch at the top of the site picks the competition. OSB questions live in `data/osb-questions.csv` (set in `competitions` in `js/config.js`, which also holds the NOSB scoring: toss-up 4, bonus 6). `importer/osb_reader.py` reads NOSB packets in their field layout ("Question Type: / Category: / Correct Answer:"), the numbered "Toss-Up 1 (Biology):" layout, and quiz bowl style packets (pyramidal toss-ups with `(*)` power marks, `[10]` bonuses and `[accept …; prompt on …] <Category>` answers):

```bash
python importer/osb_reader.py packet.pdf more.txt --out parsed/ --set "NOSB 2018" --set "..."
```

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

## Changelog

The help page ends with a collapsed changelog. It shows `data/changelog.json` (newest day first) plus any line starting with `Changelog:` in the repo's recent commit messages, so a commit like

```
Faster question loading

Changelog: Questions load about twice as fast.
```

shows up on the site as soon as it's pushed. Set `repo` in `js/config.js` to the GitHub repo (owner/name); leave it blank to use only the JSON file.

## Troubleshooting

`dev.html` (not linked from the site) has tools for checking what the site does on a given device: look up a question by ID and hear exactly what the voice is given, try typed answers against any key and see why each is accepted or rejected, test voices, respellings and room voice matching, view or edit the browser's saved data, add sample stats, and run every official answer of a set through the checker.

