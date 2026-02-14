#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
XMDX_ROOT="$(cd "$E2E_ROOT/.." && pwd)"

DOCS_DIR="${DOCS_DIR:-$E2E_ROOT/withastro-docs}"

echo "=== E2E: examples/basic ==="
(
  cd "$XMDX_ROOT/examples/basic"
  rm -rf dist .astro
  pnpm build
)
"$SCRIPT_DIR/verify-build.sh" "$XMDX_ROOT/examples/basic/dist"

echo ""
echo "=== E2E: examples/starlight ==="
(
  cd "$XMDX_ROOT/examples/starlight"
  rm -rf dist .astro
  pnpm build
)
"$SCRIPT_DIR/verify-build.sh" "$XMDX_ROOT/examples/starlight/dist"

echo ""
echo "=== E2E: withastro/docs ==="
if [ ! -d "$DOCS_DIR" ]; then
  echo "withastro/docs not set up. Run e2e/scripts/setup.sh first."
  echo "Skipping docs build."
  exit 0
fi

(
  cd "$DOCS_DIR"
  rm -rf dist .astro
  pnpm build
)
MIN_HTML_FILES=100 "$SCRIPT_DIR/verify-build.sh" "$DOCS_DIR/dist"

echo ""
echo "=== All E2E checks passed ==="
