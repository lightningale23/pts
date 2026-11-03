# pts notes

- Static GitHub Pages site, no build step. Run `npm test` before pushing.
- Changelog: every user-visible change gets an entry in `data/changelog.json` (newest day
  first, plain-language one-liners for players, not developers) and a `Changelog: ...` line
  in the commit message. The help page shows both, so commits from anyone with that line
  appear even if the JSON wasn't edited. Data-only or internal changes need no entry unless
  players would notice (new questions do count).
- `dev.html` (+ `js/dev.js`) is an unlinked troubleshooting page: question inspector, answer
  checker lab, speech lab (voices, respellings, learned voice pace, room voice matching),
  local storage editor, sample stats, and per-set checker runs. Keep it working when the
  modules it imports change; it doesn't need changelog entries.

