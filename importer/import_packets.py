#!/usr/bin/env python3
"""
AI packet importer for the pts Science Bowl site.

Reads Science Bowl packets (PDF or plain text), asks Claude to extract every
toss-up and bonus into structured rows, and appends them to your Google Sheet
(and/or writes a CSV you can paste in yourself).

Examples
--------
  # Preview what Claude extracts, write it to a CSV, don't touch the sheet
  python importer/import_packets.py packets/round1.pdf --out new.csv

  # Import a whole folder straight into the sheet
  python importer/import_packets.py packets/*.pdf --sheet YOUR_SHEET_ID \
      --creds service-account.json --set "2025 Regional Set 1"

Environment
-----------
  ANTHROPIC_API_KEY             required
  ANTHROPIC_MODEL               optional, defaults to claude-sonnet-5-5
  GOOGLE_SERVICE_ACCOUNT_JSON   optional, the service-account key as a JSON string
                                (used instead of --creds, handy in GitHub Actions)
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import re
import sys
from pathlib import Path

HEADERS = ["id", "set", "year", "level", "round", "num", "type", "subject", "format",
           "question", "w", "x", "y", "z", "answer", "accept", "reject", "notes"]

SUBJECTS = ["Biology", "Chemistry", "Physics", "Mathematics", "Earth and Space", "Energy",
            "General Science", "Astronomy", "Computer Science"]

DEFAULT_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")
MAX_PAGES_PER_REQUEST = 40  # longer PDFs are split into overlapping chunks

# ── Prompt + output schema ─────────────────────────────────────────────────

SYSTEM_PROMPT = """You convert U.S. Department of Energy National Science Bowl style packets into structured data.

A packet is a list of numbered TOSS-UP and BONUS questions, usually paired (Toss-up 1, Bonus 1, Toss-up 2, ...).
Each one names a category (BIOLOGY, CHEMISTRY, PHYSICS, MATH, EARTH AND SPACE, ENERGY, and in older sets
EARTH SCIENCE, ASTRONOMY, GENERAL SCIENCE, COMPUTER SCIENCE), a format (Short Answer or Multiple Choice),
the question, and an ANSWER line.

Rules for every question you extract:
- Copy the question text faithfully. Do not paraphrase, fix, or answer anything yourself.
- Do not include the number, category or format in the question text; put them in their own fields.
- Multiple choice: put the W, X, Y, Z options in `choices` (text only, no letter), not in the question.
  The answer must be the letter, a closing parenthesis and the option text, e.g. "X) STRATOSPHERE".
- Short answer: put the main answer in `answer` in the packet's capitalization. Keep optional words in
  parentheses, e.g. "(PRIMARY) MOTOR CORTEX". Move "ACCEPT: ..." alternates into `accept` and
  "DO NOT ACCEPT: ..." into `reject` (one entry per alternate). Drop moderator notes like "PROMPT ON" into `notes`.
- Numbered statement lists ("Identify all of the following...", "Rank the following...") keep each
  numbered item on its own line in the question, written "1) ...". Answers to these look like "1 AND 3".
- Math and science notation: wrap mathematical expressions in $...$ using LaTeX, e.g. $x^2 + 3x$,
  $3.0 \\times 10^8$, $\\frac{1}{2}$, $\\sqrt{2}$. Chemical formulas use subscripts in $...$, e.g. $H_2O$, $CO_2$.
  Restore superscripts/subscripts that were flattened by the PDF (e.g. "10 8" that is clearly 10^8).
  Units stay in plain words.
- Map categories: MATH → Mathematics; EARTH SCIENCE, EARTH AND SPACE SCIENCE, EARTH & SPACE → Earth and Space.
  Keep ASTRONOMY, GENERAL SCIENCE and COMPUTER SCIENCE as they are.
- `round` is the round name or number printed on the packet (e.g. "3", "Round Robin 4", "Double Elimination 2").
- Tiebreaker or extra questions: include them with round "Tiebreaker".
- Skip anything that is not a question: cover pages, rules, scoring sheets, page headers and footers.
- If a question is illegible or cut off, still include it with what is there and explain in `notes`.

Call the save_questions tool exactly once with every question in the document, in order."""

TOOL = {
    "name": "save_questions",
    "description": "Save every toss-up and bonus question extracted from the packet.",
    "input_schema": {
        "type": "object",
        "properties": {
            "packet": {
                "type": "object",
                "description": "Information printed on the packet itself, if any.",
                "properties": {
                    "title": {"type": "string", "description": "Tournament or set name, e.g. '2024 Regional High School Set 3'"},
                    "year": {"type": "string"},
                    "level": {"type": "string", "enum": ["HS", "MS", ""]},
                },
            },
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "round": {"type": "string"},
                        "number": {"type": "integer"},
                        "type": {"type": "string", "enum": ["TOSS-UP", "BONUS"]},
                        "subject": {"type": "string", "enum": SUBJECTS},
                        "format": {"type": "string", "enum": ["Short Answer", "Multiple Choice"]},
                        "question": {"type": "string"},
                        "choices": {
                            "type": "object",
                            "properties": {k: {"type": "string"} for k in "wxyz"},
                        },
                        "answer": {"type": "string"},
                        "accept": {"type": "array", "items": {"type": "string"}},
                        "reject": {"type": "array", "items": {"type": "string"}},
                        "notes": {"type": "string"},
                    },
                    "required": ["number", "type", "subject", "format", "question", "answer"],
                },
            },
        },
        "required": ["questions"],
    },
}

# ── Helpers ─────────────────────────────────────────────────────────────────


def fnv1a_base36(text: str) -> str:
    """Same ID hash as js/util.js (FNV-1a over UTF-16 code units, base 36)."""
    h = 0x811C9DC5
    data = text.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if h == 0:
        return "0"
    out = ""
    while h:
        h, r = divmod(h, 36)
        out = digits[r] + out
    return out


def question_id(row: dict) -> str:
    t = "bonus" if row["type"].upper().startswith("B") else "tossup"
    return fnv1a_base36("|".join([row["set"], row["round"], row["num"], t, row["question"]]))


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pdf_chunks(path: Path):
    """Yield (label, base64 PDF) chunks small enough for one request."""
    raw = path.read_bytes()
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        yield path.name, base64.standard_b64encode(raw).decode()
        return
    reader = PdfReader(io.BytesIO(raw))
    n = len(reader.pages)
    if n <= MAX_PAGES_PER_REQUEST:
        yield path.name, base64.standard_b64encode(raw).decode()
        return
    step = MAX_PAGES_PER_REQUEST - 1  # one page of overlap so no question is cut in half
    for start in range(0, n, step):
        end = min(n, start + MAX_PAGES_PER_REQUEST)
        w = PdfWriter()
        for i in range(start, end):
            w.add_page(reader.pages[i])
        buf = io.BytesIO()
        w.write(buf)
        yield f"{path.name} pages {start + 1}-{end}", base64.standard_b64encode(buf.getvalue()).decode()
        if end == n:
            break


def extract(client, model: str, path: Path, hint: str) -> dict:
    """Send one packet to Claude and return the tool input it produced (merged across chunks)."""
    if path.suffix.lower() == ".pdf":
        parts = [(label, {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}})
                 for label, data in pdf_chunks(path)]
    else:
        text = path.read_text(encoding="utf-8", errors="replace")
        parts = [(path.name, {"type": "document", "source": {"type": "text", "media_type": "text/plain", "data": text}})]

    merged = {"packet": {}, "questions": []}
    for label, doc in parts:
        print(f"  · reading {label} with {model}…", file=sys.stderr)
        user_text = "Extract every question from this Science Bowl packet."
        if hint:
            user_text += f" Context from the person importing it: {hint}"
        with client.messages.stream(
            model=model,
            max_tokens=32000,
            system=SYSTEM_PROMPT,
            tools=[TOOL],
            tool_choice={"type": "tool", "name": "save_questions"},
            messages=[{"role": "user", "content": [doc, {"type": "text", "text": user_text}]}],
        ) as stream:
            msg = stream.get_final_message()
        if msg.stop_reason == "max_tokens":
            print(f"  ! {label}: the response hit the length limit, so the last questions may be missing. "
                  "Split the PDF into smaller files and import them separately.", file=sys.stderr)
        block = next((b for b in msg.content if b.type == "tool_use"), None)
        if not block:
            print(f"  ! {label}: no questions returned", file=sys.stderr)
            continue
        data = block.input or {}
        merged["packet"] = merged["packet"] or data.get("packet") or {}
        merged["questions"].extend(data.get("questions") or [])
        u = msg.usage
        print(f"    {len(data.get('questions') or [])} questions (tokens in {u.input_tokens}, out {u.output_tokens})", file=sys.stderr)
    return merged


def to_rows(result: dict, path: Path, set_name: str | None, level: str | None, year: str | None) -> tuple[list[dict], list[str]]:
    packet = result.get("packet") or {}
    set_value = set_name or packet.get("title") or path.stem.replace("_", " ")
    warnings, rows, seen = [], [], set()
    for q in result.get("questions", []):
        question = (q.get("question") or "").strip()
        answer = (q.get("answer") or "").strip()
        if not question or not answer:
            warnings.append(f"skipped an entry with no question or answer: {q.get('type')} {q.get('number')}")
            continue
        is_mc = q.get("format") == "Multiple Choice"
        choices = q.get("choices") or {}
        if is_mc and not all(choices.get(k) for k in "wxyz"):
            warnings.append(f"{q.get('type')} {q.get('number')}: multiple choice without all four options")
        row = {h: "" for h in HEADERS}
        row.update({
            "set": set_value,
            "year": year or packet.get("year") or (re.search(r"\b(19|20)\d{2}\b", set_value) or [""])[0],
            "level": level or packet.get("level") or "",
            "round": str(q.get("round") or ""),
            "num": str(q.get("number") or ""),
            "type": "BONUS" if q.get("type") == "BONUS" else "TOSS-UP",
            "subject": q.get("subject") or "",
            "format": "Multiple Choice" if is_mc else "Short Answer",
            "question": question,
            "answer": answer,
            "accept": "; ".join(a.strip() for a in q.get("accept") or [] if a.strip()),
            "reject": "; ".join(a.strip() for a in q.get("reject") or [] if a.strip()),
            "notes": (q.get("notes") or "").strip(),
        })
        if is_mc:
            for k in "wxyz":
                row[k] = (choices.get(k) or "").strip()
        row["id"] = question_id(row)
        if row["id"] in seen:  # duplicates from overlapping PDF chunks
            continue
        seen.add(row["id"])
        rows.append(row)
    return rows, warnings


# ── Google Sheets ───────────────────────────────────────────────────────────


def open_worksheet(sheet_id: str, tab: str, creds_path: str | None):
    import gspread

    if creds_path:
        gc = gspread.service_account(filename=creds_path)
    elif os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON"):
        gc = gspread.service_account_from_dict(json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]))
    else:
        sys.exit("To write to the sheet, pass --creds service-account.json or set GOOGLE_SERVICE_ACCOUNT_JSON.")
    sh = gc.open_by_key(sheet_id)
    try:
        ws = sh.worksheet(tab)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=tab, rows=1000, cols=len(HEADERS))
    header = ws.row_values(1)
    if not header:
        ws.update("A1", [HEADERS], value_input_option="RAW")
        header = HEADERS
    return ws, [h.strip().lower() for h in header]


def append_to_sheet(ws, header: list[str], rows: list[dict]) -> int:
    id_col = header.index("id") + 1 if "id" in header else None
    existing = set(ws.col_values(id_col)[1:]) if id_col else set()
    fresh = [r for r in rows if r["id"] not in existing]
    if fresh:
        # RAW keeps answers like "1/6" or "=" from turning into dates or formulas.
        ws.append_rows([[r.get(h, "") for h in header] for r in fresh], value_input_option="RAW")
    return len(fresh)


# ── Main ────────────────────────────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(description="Import Science Bowl packets into the question sheet using Claude.")
    ap.add_argument("files", nargs="+", type=Path, help="PDF or .txt packets")
    ap.add_argument("--sheet", help="Google Sheet ID to append to")
    ap.add_argument("--tab", default="Questions", help="Worksheet/tab name (default: Questions)")
    ap.add_argument("--creds", help="Path to a Google service-account JSON key")
    ap.add_argument("--out", type=Path, help="Also write the extracted rows to this CSV file")
    ap.add_argument("--set", dest="set_name", help="Set/tournament name for these packets (default: read from the packet, else the file name)")
    ap.add_argument("--level", choices=["HS", "MS"], help="High school or middle school")
    ap.add_argument("--year", help="Year, if it isn't printed on the packet")
    ap.add_argument("--hint", default="", help="Extra context for the model, e.g. 'answers are on the right-hand page'")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--ledger", type=Path, help="JSON file recording packets already imported (skips repeats)")
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY first (get a key at https://console.anthropic.com).")
    if not args.sheet and not args.out:
        sys.exit("Nothing to do: pass --sheet to append to Google Sheets and/or --out to write a CSV.")

    import anthropic
    client = anthropic.Anthropic()

    ledger = json.loads(args.ledger.read_text()) if args.ledger and args.ledger.exists() else {}
    ws = header = None
    if args.sheet:
        ws, header = open_worksheet(args.sheet, args.tab, args.creds)

    all_rows, total_added = [], 0
    for path in args.files:
        if not path.exists():
            print(f"! {path} not found", file=sys.stderr)
            continue
        sha = file_sha(path)
        if sha in ledger:
            print(f"= {path.name} already imported on {ledger[sha]['date']}, skipping", file=sys.stderr)
            continue
        print(f"> {path.name}", file=sys.stderr)
        result = extract(client, args.model, path, args.hint)
        rows, warnings = to_rows(result, path, args.set_name, args.level, args.year)
        for w in warnings:
            print(f"  ! {w}", file=sys.stderr)
        tu = sum(r["type"] == "TOSS-UP" for r in rows)
        print(f"  {len(rows)} questions ({tu} toss-ups, {len(rows) - tu} bonuses)", file=sys.stderr)
        all_rows.extend(rows)
        if ws is not None:
            added = append_to_sheet(ws, header, rows)
            total_added += added
            print(f"  added {added} new rows to the sheet ({len(rows) - added} were already there)", file=sys.stderr)
        if args.ledger:
            from datetime import date
            ledger[sha] = {"file": path.name, "date": date.today().isoformat(), "questions": len(rows)}
            args.ledger.write_text(json.dumps(ledger, indent=2))

    if args.out:
        with args.out.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=HEADERS)
            w.writeheader()
            w.writerows(all_rows)
        print(f"wrote {len(all_rows)} rows to {args.out}", file=sys.stderr)
    if ws is not None:
        print(f"done: {total_added} new questions in the sheet", file=sys.stderr)


if __name__ == "__main__":
    main()
