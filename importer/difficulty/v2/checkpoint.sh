#!/bin/sh
# Commit the ratings so far (and the unfinished site changes as a patch) and push to main.
cd "$(dirname "$0")/../../.." || exit 1
git diff -- js css index.html sw.js offline tests CLAUDE.md data/changelog.json > importer/difficulty/v2/site-changes.patch
git add importer/difficulty/v2/ratings importer/difficulty/v2/qc.log importer/difficulty/v2/key-issues.txt importer/difficulty/v2/site-changes.patch importer/difficulty/v2/*.mjs importer/difficulty/v2/*.md importer/difficulty/v2/*.sh importer/difficulty/v2/*.txt importer/difficulty/RUBRIC.md 2>/dev/null
git commit -q -m "Difficulty v2: ratings checkpoint ($(node importer/difficulty/v2/rate.mjs status | tail -1 | awk '{print $2"/"$4}'))

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ku7BivVQ8vY1w8nXMiduvS" || exit 0
git pull -q --rebase --autostash origin main && git push -q origin HEAD:main
git log --oneline -1
