#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RUNS="${1:-3}"
OFFICIAL_DIR="${OFFICIAL_DIR:-/tmp/xmdx-bench-official}"
XMDX_DIR="${XMDX_DIR:-/tmp/xmdx-bench-xmdx}"
RESULT_DIR="${RESULT_DIR:-$SCRIPT_DIR/../results}"

# Ensure setup is complete
if [ ! -d "$OFFICIAL_DIR" ] || [ ! -d "$XMDX_DIR" ]; then
  echo "Running setup first..."
  "$SCRIPT_DIR/setup.sh"
fi

mkdir -p "$RESULT_DIR"

echo "Running benchmark with $RUNS runs..."

hyperfine \
  --warmup 2 \
  --runs "$RUNS" \
  --export-json "$RESULT_DIR/results.json" \
  --export-markdown "$RESULT_DIR/results.md" \
  --prepare "rm -rf '$OFFICIAL_DIR/dist' '$OFFICIAL_DIR/.astro' '$XMDX_DIR/dist' '$XMDX_DIR/.astro'" \
  --command-name "@astrojs/mdx" "cd '$OFFICIAL_DIR' && pnpm build" \
  --command-name "astro-xmdx" "cd '$XMDX_DIR' && pnpm build"

echo ""
echo "=== Results ==="
cat "$RESULT_DIR/results.md"
