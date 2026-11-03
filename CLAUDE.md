# pts notes

- Static GitHub Pages site, no build step. Run `npm test` before pushing.
- Changelog: every user-visible change gets an entry in `data/changelog.json` (newest day
  first, plain-language one-liners for players, not developers) and a `Changelog: ...` line
  in the commit message. The help page shows both, so commits from anyone with that line
  appear even if the JSON wasn't edited. Data-only or internal changes need no entry unless
  players would notice (new questions do count).
