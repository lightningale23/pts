#!/bin/bash
# Opens pts in its own window (Chrome, Edge or Brave app mode), or else in your default browser.
cd "$(dirname "$0")" || exit 1
PAGE="$PWD/pts.html"
URL="file://${PAGE// /%20}"
for APP in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
  if open -Ra "$APP" 2>/dev/null; then
    open -na "$APP" --args --app="$URL"
    exit 0
  fi
done
open "$PAGE"
