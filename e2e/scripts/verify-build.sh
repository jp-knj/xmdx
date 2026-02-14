#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="${1:?Usage: verify-build.sh <dist-dir>}"

echo "Verifying build output: $DIST_DIR"

# 1. dist/ directory exists
if [ ! -d "$DIST_DIR" ]; then
  echo "FAIL: dist directory not found: $DIST_DIR"
  exit 1
fi
echo "  OK: dist directory exists"

# 2. At least one HTML file exists
HTML_COUNT=$(find "$DIST_DIR" -name '*.html' | wc -l | tr -d ' ')
if [ "$HTML_COUNT" -eq 0 ]; then
  echo "FAIL: no HTML files found in $DIST_DIR"
  exit 1
fi
echo "  OK: $HTML_COUNT HTML files found"

# 3. For large sites (withastro/docs), expect 100+ HTML files
MIN_FILES="${MIN_HTML_FILES:-0}"
if [ "$MIN_FILES" -gt 0 ] && [ "$HTML_COUNT" -lt "$MIN_FILES" ]; then
  echo "FAIL: expected at least $MIN_FILES HTML files, got $HTML_COUNT"
  exit 1
fi
if [ "$MIN_FILES" -gt 0 ]; then
  echo "  OK: meets minimum $MIN_FILES HTML files"
fi

# 4. Spot-check: at least one HTML file contains an <h1>
H1_FOUND=false
while IFS= read -r f; do
  if grep -q '<h1' "$f" 2>/dev/null; then
    H1_FOUND=true
    break
  fi
done < <(find "$DIST_DIR" -name '*.html' -print | head -20)

if [ "$H1_FOUND" = false ]; then
  echo "FAIL: no <h1> found in sampled HTML files"
  exit 1
fi
echo "  OK: <h1> headings present"

echo "All checks passed."
