#!/usr/bin/env bash
# Render docs/screenshots/character-memory-week.html → character-memory-week.png
# using whichever headless browser is available. macOS-only.
set -euo pipefail

cd "$(dirname "$0")"
SRC="${1:-character-memory-week.html}"
OUT="${SRC%.html}.png"
case "$SRC" in
  haunted-hero-cards.html) WIDTH=1600; HEIGHT=600 ;;
  *) WIDTH=1600; HEIGHT=1400 ;;
esac

if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

if command -v wkhtmltoimage >/dev/null 2>&1; then
  echo "→ using wkhtmltoimage"
  wkhtmltoimage --width "$WIDTH" --height "$HEIGHT" --quality 92 "$SRC" "$OUT"
  exit 0
fi

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ -x "$CHROME" ]]; then
  echo "→ using Chrome headless"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --window-size="$WIDTH,$HEIGHT" \
    --screenshot="$PWD/$OUT" \
    "file://$PWD/$SRC"
  exit 0
fi

CHROMIUM="/Applications/Chromium.app/Contents/MacOS/Chromium"
if [[ -x "$CHROMIUM" ]]; then
  echo "→ using Chromium headless"
  "$CHROMIUM" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --window-size="$WIDTH,$HEIGHT" \
    --screenshot="$PWD/$OUT" \
    "file://$PWD/$SRC"
  exit 0
fi

cat >&2 <<MSG
No renderer found. Install one of:
  brew install --cask wkhtmltopdf      # easiest, ships wkhtmltoimage
  brew install --cask google-chrome    # used in headless mode
or open $SRC in Safari and File → Export as PDF / take a screenshot manually.
MSG
exit 1
