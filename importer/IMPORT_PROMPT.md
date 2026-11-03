# Prompt for importing new packets in a new chat

Paste everything below the line into a new chat (one that can reach your computer, or attach
the packets). Edit the first line to say what's new if you know.

---

I added new Science Bowl packets to my packet folder. Import them into my practice site's question bank the way earlier imports were done, push to main, and give me a short report.

**The site.** pts is a static Science Bowl practice site on GitHub Pages: repo `lightningale23/pts` (public), branch `main`, no build step. Clone it and read `CLAUDE.md` first. Its rules apply: run `npm test` before pushing, and every change players would notice (new questions count) gets an entry in `data/changelog.json` plus a `Changelog: ...` line in the commit message. Always push finished work to `main`.

**Where the packets are.** On my computer: `C:\Users\tobyw\Documents\scibowl-packets` for Science Bowl and `C:\Users\tobyw\Documents\NOSB packets` for Ocean Science Bowl. Use the linked-computer tools to list and copy them; if this chat can't reach my computer, tell me and I'll attach the files. Many items are zips, and after unzipping the files are usually inside an inner folder with the same name (`X/X/...`). `importer/IMPORTED.md` lists every folder already imported and the set it became: compare the folder listing to it to find what's new, and add a row for each folder you import. Generic folder names ("Packets", "Rounds") can be new tournaments: identify them from packet headers or READMEs.

**The bank.** `data/questions.csv` (Science Bowl) and `data/osb-questions.csv` (Ocean Science Bowl), columns:
`id,set,year,level,round,num,type,subject,format,question,w,x,y,z,answer,accept,reject,notes`
- `type` TOSS-UP or BONUS; `format` Short Answer or Multiple Choice; `level` HS or MS
- `subject` for Science Bowl: Biology, Chemistry, Physics, Mathematics, Earth and Space, Energy (General Science and Computer Science exist from older sets). Ocean Science Bowl: Biology, Chemistry, Geology, Physical Oceanography, Technology, Social Sciences, Geography.
- multiple choice: options in `w`..`z`, answer like `W) MITOSIS`
- math in LaTeX between `$...$`; superscripts and subscripts as `$x^{2}$`, `$CH_{4}$`
- `accept` / `reject`: alternates separated by `;`. A `|` also separates alternates, so never put absolute-value bars in those fields (write `ln sec x + C`).
- `notes`: writer tags (`writer: AB`) and anything else that isn't the answer
- Never change existing rows or their `id`s: players' stats and saved questions point at them.

**Set names.** Short, tournament plus year, like the existing ones: `MIT 2025`, `Texas 2026`, `LOST3 2026`, `CLASH MS 2026`. Round labels stay as printed (`RR1`, `DE4`, `Round 7`, `Finals 1`). A shared or mixed folder (a roundshare, a scrimmage of other schools' rounds) is one set with rounds named by source (`Amador Valley R1`, `NCSSM R8`). If you can't identify a tournament, pick a plain name, import it, and tell me so I can rename it. When I've named a set before (`Pokahu 2024`), keep that name.

**Skip:** meme or joke rounds, visual bonuses (need their images), questions whose equations or diagrams are pictures (in a .docx, `<w:drawing>` inside a question; in text, gaps like "given by the equation ."), score sheets, READMEs and templates (read READMEs first: they often name the tournament), and duplicate files. Don't import scanned packets read by OCR: I decided OCR isn't reliable enough (that's why LOST2 was removed). List anything skipped in the report.

**Tools in the repo** (Python 3 with `pip install pdfplumber python-docx wordfreq openpyxl`, Node 18+):
- `importer/packet_reader.py FOLDER --out parsed/`: reads Science Bowl PDFs, Word files (including Word equations), `.txt` and `.ibp` packets. One folder (or zip) is one tournament. It writes a CSV per tournament and `report.json` with every packet's status (ok, ok with warnings, partial, failed, not a packet) and problems.
- `importer/xlsx_reader.py FOLDER --set NAME --year YYYY --out rows.csv`: packets kept as spreadsheets (Type, Category, Format, Question, W–Z, Answer, Accept, Do Not Accept, Writer columns).
- `importer/osb_reader.py`: Ocean Science Bowl layouts (fields, numbered, quiz bowl).
- `importer/merge_into_bank.py --map batch.json [--fixes fixes.json] [--bank ...] [--out ...]`: adds reader CSVs to a bank. Skips empty rows and repeats of questions already in the bank, turns "Short Answer" rows with W/X/Y/Z lines into multiple choice, and gives new rows the ID the site derives. `fixes.json` drops (`null`) or edits single rows, keyed `"set|round|num|type"`. The docstring has the formats.
- `importer/check_answers.mjs BANK.csv [sets.json] [fails.json]`: every official answer (multiple-choice letter and option text; each printed short answer and listed alternate) must be accepted by the site's own checker.
- `dev.html` (open the site locally): the Question tab inspects any question by ID; the Bank tab runs the answer check on one set.

**Steps**
1. Copy the new folders here and unzip. Look inside each one: tournament name, year, level, file types, layout. Skip what's listed above.
2. Read each tournament with the right reader. If packets come out failed or partial, look at the text (the reader's `pdf_pages` / `docx_pages`) and find out why. Widen the reader's patterns in `packet_reader.py` when it's a general layout (keep the change general and run `npm test`). For a one-off layout, write a small driver that imports `packet_reader`, normalizes those lines before `parse_lines`, or sets round labels by patching `round_label`.
3. Go through `report.json`:
   - **No ANSWER line:** fix it or drop the row.
   - **Multiple choice with no options:** often it's really an "identify all" question, and fine as short answer.
   - **"Very long answer":** text from the next question ran in. Trim it or drop the row.
   - **Answer letter and option text disagree:** check the packet.
   - **Numbering gaps:** a question was lost; find it if you can.

   Spot-check a few questions per set against the packet.
4. Merge as a dry run: `--out` a scratch file. Repeats are normal, because packets get shared and re-released.
5. Run `node importer/check_answers.mjs scratch.csv sets.json`. It must report 0 rejected for the new sets (the only known failure in the whole bank is WSBT 2023 `m5uyxf`, a symbols-only option). Fix data problems in `fixes.json`, such as an accept list split apart, or a name list written with commas, which belongs in one alternate.
   - If the checker itself is wrong in a general way, fix `js/checker.js`, add a test to `tests/checker.test.js`, and re-run the check on the whole bank so nothing else breaks.
6. Write the real bank, run `npm test`, serve the site (`python3 -m http.server`), and look at the new sets in the Questions tab.
7. Update `importer/IMPORTED.md` and `data/changelog.json`, commit (list the sets in the message, plus the `Changelog:` line), and push to `main`.
8. Report:
   - a table per set: questions added, rounds
   - packets or questions skipped or dropped, and why
   - set names you guessed
   - anything you changed in the reader or checker

Keep the report short; I don't need the steps recapped.
