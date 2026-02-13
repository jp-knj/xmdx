#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

RUNS="${1:-10}"

# Ensure setup is complete
if [ ! -d "withastro-docs" ]; then
  echo "Running setup first..."
  ./scripts/setup.sh
fi

cd withastro-docs

echo "Running benchmark with $RUNS runs..."

hyperfine \
  --warmup 2 \
  --runs "$RUNS" \
  --export-json ../results.json \
  --export-markdown ../results.md \
  --prepare "rm -rf dist .astro" \
  --command-name "@astrojs/mdx" "pnpm astro build" \
  --command-name "astro-xmdx" "pnpm astro build --config astro.config.xmdx.ts"

cd ..
echo ""
echo "=== Results ==="
cat results.md
