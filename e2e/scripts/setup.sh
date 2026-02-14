#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
XMDX_ROOT="$(cd "$E2E_ROOT/.." && pwd)"
BENCH_SCRIPTS="$XMDX_ROOT/benchmarks/scripts"

DOCS_DIR="${DOCS_DIR:-$E2E_ROOT/withastro-docs}"
XMDX_PKG_PATH="${XMDX_PKG_PATH:-$XMDX_ROOT/packages/astro-xmdx}"

# Clone withastro/docs (shallow)
if [ ! -d "$DOCS_DIR" ]; then
  echo "Cloning withastro/docs..."
  git clone --depth 1 https://github.com/withastro/docs.git "$DOCS_DIR"
fi

echo "Patching withastro/docs for xmdx..."
(
  cd "$DOCS_DIR"

  # Override @astrojs/mdx with astro-xmdx
  pnpm pkg set "pnpm.overrides.@astrojs/mdx=link:$XMDX_PKG_PATH"

  # Add rawContent: true for xmdx compatibility
  perl -pi -e 's/starlightLlmsTxt\(\{/starlightLlmsTxt({ rawContent: true,/' config/plugins/llms-txt.ts 2>/dev/null || true

  # Create ec.config.mjs for expressive-code
  cat > ec.config.mjs << 'ECEOF'
import { pluginCollapsibleSections } from '@expressive-code/plugin-collapsible-sections';

export default {
  plugins: [pluginCollapsibleSections()],
};
ECEOF

  # Reuse patch scripts from benchmarks/
  node "$BENCH_SCRIPTS/patch-astro-config.cjs"
  node "$BENCH_SCRIPTS/patch-content-config.cjs"

  # Fix content issues (same as benchmarks setup)
  # Use perl instead of sed for portable newline insertion (BSD sed vs GNU sed)
  perl -pi -e 's/por sí mismo\.$/por sí mismo.\n    :::/' src/content/docs/es/recipes/making-toolbar-apps.mdx 2>/dev/null || true

  node "$BENCH_SCRIPTS/patch-testing-mdx.cjs"

  echo "Installing dependencies..."
  pnpm install --no-frozen-lockfile
)

echo "Setup complete: $DOCS_DIR"
