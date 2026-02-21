#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XMDX_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Use /tmp to avoid workspace context issues
OFFICIAL_DIR="${OFFICIAL_DIR:-/tmp/xmdx-bench-official}"
XMDX_DIR="${XMDX_DIR:-/tmp/xmdx-bench-xmdx}"
XMDX_PKG_PATH="${XMDX_PKG_PATH:-$XMDX_ROOT/packages/astro-xmdx}"

# Clone withastro/docs for official MDX
if [ ! -d "$OFFICIAL_DIR" ]; then
  echo "Cloning withastro/docs for official @astrojs/mdx..."
  rm -rf "$OFFICIAL_DIR"
  git clone --depth 1 https://github.com/withastro/docs.git "$OFFICIAL_DIR"
fi

# Clone withastro/docs for astro-xmdx
if [ ! -d "$XMDX_DIR" ]; then
  echo "Cloning withastro/docs for astro-xmdx..."
  rm -rf "$XMDX_DIR"
  git clone --depth 1 https://github.com/withastro/docs.git "$XMDX_DIR"
fi

echo "Configuring official @astrojs/mdx variant..."
(
  cd "$OFFICIAL_DIR"
  # Remove any existing override
  pnpm pkg delete "pnpm.overrides.@astrojs/mdx" >/dev/null 2>&1 || true

  # Patch content.config.ts to use static data (avoid network fetches)
  node "$SCRIPT_DIR/patch-content-config.cjs"

  echo "Installing dependencies..."
  pnpm install --no-frozen-lockfile
)

echo "Configuring astro-xmdx variant..."
(
  cd "$XMDX_DIR"

  # pnpm overrides to replace @astrojs/mdx with astro-xmdx
  pnpm pkg set "pnpm.overrides.@astrojs/mdx=link:$XMDX_PKG_PATH"

  # Add rawContent: true for xmdx compatibility
  sed -i.bak 's/starlightLlmsTxt({/starlightLlmsTxt({ rawContent: true,/' config/plugins/llms-txt.ts
  rm -f config/plugins/llms-txt.ts.bak

  # Create ec.config.mjs for expressive-code (moves plugin config out of astro.config.ts)
  cat > ec.config.mjs << 'EOF'
import { pluginCollapsibleSections } from '@expressive-code/plugin-collapsible-sections';

export default {
  plugins: [pluginCollapsibleSections()],
};
EOF

  # Update astro.config.ts - remove pluginCollapsibleSections import and set expressiveCode: true
  node "$SCRIPT_DIR/patch-astro-config.cjs"

  # Patch content.config.ts to use static data (avoid network fetches)
  node "$SCRIPT_DIR/patch-content-config.cjs"

  # Fix content issues in withastro/docs
  # 1. Spanish making-toolbar-apps.mdx missing closing :::
  sed -i.bak 's/por sí mismo\.$/por sí mismo.\n    :::/' src/content/docs/es/recipes/making-toolbar-apps.mdx
  rm -f src/content/docs/es/recipes/making-toolbar-apps.mdx.bak

  # 2. Japanese testing.mdx: :::tip inside <Steps> needs to be moved outside
  node "$SCRIPT_DIR/patch-testing-mdx.cjs"

  echo "Installing dependencies..."
  pnpm install --no-frozen-lockfile
)

echo "Setup complete!"
echo "Official: $OFFICIAL_DIR"
echo "astro-xmdx: $XMDX_DIR"
