# Importing packets for free with Claude chat

This uses your regular Claude chat (claude.ai or the Claude app) instead of the paid API, so it counts against your chat plan's usage limits, not API credits. It's more hands-on than the script: one packet per chat, and you add the result to the sheet yourself.

## Steps

1. Start a new chat and attach one packet PDF.
2. Paste the prompt below and send it.
3. Download the CSV file Claude makes.
4. In your Google Sheet, open the **Questions** tab, then **File → Import → Upload**, pick the CSV, choose **Append to current sheet**, and click **Import data**.
5. Spot-check a few rows against the packet.

If the packet is long and the reply stops partway, say "continue from where you stopped" and append that file too. Don't import the same packet twice: rows added this way have no duplicate check.

## Prompt

```
Convert the attached Science Bowl packet into a CSV file I can download. Use exactly these columns, in this order, with this header row:

id,set,year,level,round,num,type,subject,format,question,w,x,y,z,answer,accept,reject,notes

Rules:
- One row per question, every toss-up and bonus in the packet, in order. Leave id blank.
- set: the tournament/set name printed on the packet. year: the year if shown. level: HS or MS.
- round: the round name or number. num: the question number.
- type: TOSS-UP or BONUS.
- subject: one of Biology, Chemistry, Physics, Mathematics, Earth and Space, Energy (map MATH to Mathematics and EARTH SCIENCE / EARTH AND SPACE SCIENCE to Earth and Space; keep older categories like General Science or Astronomy as written).
- format: Short Answer or Multiple Choice.
- question: copy the text exactly. Don't include the number, category or format. Put each numbered statement of "identify all" / "rank" questions on its own line as "1) ...".
- Multiple choice: put the four options' text (without letters) in w, x, y, z, and write the answer as the letter plus a parenthesis plus the text, e.g. X) STRATOSPHERE.
- answer: the main answer as printed, keeping optional words in parentheses. Move "ACCEPT:" alternates into accept and "DO NOT ACCEPT:" into reject, separated by semicolons.
- Math: wrap expressions in $...$ LaTeX, e.g. $x^2$, $3.0 \times 10^8$, $\frac{1}{2}$, $H_2O$. Restore superscripts and subscripts the PDF flattened.
- Skip cover pages, rules and headers. Don't answer, fix or paraphrase anything.
- Quote every field that contains a comma, quote mark or line break, using standard CSV escaping.
```
