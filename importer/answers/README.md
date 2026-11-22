# Answer-key check

Owner, 2026-11-22: **don't change answers that were printed on the packet, for now.** Nothing here has been
applied to the banks; it's a list for the owner to decide on later.

- `check_keys.mjs`: sends every question (SB, OSB, visual bonuses; General Science skipped) to the Claude API's
  Message Batches and asks the model to flag WRONG / AMBIGUOUS / BROKEN keys. Not run yet: it needs the owner's
  API key (`$env:ANTHROPIC_API_KEY`, or `importer/answers/.api-key`, gitignored). `run --dry-run` shows the size and
  a rough cost; `run --sample 200` tries a small paid sample first; `status`, then `collect` → `flags.tsv`.
- `proposed-fixes.jsonl`: answer keys checked by hand so far, starting from the ~3,100 that Haiku flagged during
  the difficulty rating (`importer/difficulty/v2/key-issues.txt`). Done: OSB, and SB Biology up to ID `ctrox2`
  in the order IDs sort within a subject (~500 of the 3,084 flagged). Only real errors are listed; flags that were
  wrong, matters of taste, or "two choices fit" multiple choice questions with no clean fix were left out.
  One JSON object per line: `id`, then any of `answer`, `accept` (replaces the field), `accept_add` (adds
  alternates), `choice` ({letter: new text}), `question_replace` ([old, new] or a list of pairs), and `why`.
  Applying one would keep the old answer in `notes` as `packet answer: ...`.
- Visual bonuses flagged whose picture still needs a look before deciding: `17qk6u5` (MRI, not an
  echocardiogram?), `17r6d0k` (pseudostratified, not stratified columnar?), `1h847mb` (Mobitz I vs II), `1xa36ft`
  (is B dermal?).
