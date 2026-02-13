#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Clone withastro/docs if not exists
if [ ! -d "withastro-docs" ]; then
  echo "Cloning withastro/docs..."
  git clone --depth 1 https://github.com/withastro/docs.git withastro-docs
fi

cd withastro-docs

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Link local astro-xmdx
echo "Linking astro-xmdx..."
pnpm add astro-xmdx@workspace:../../packages/astro-xmdx

# Create xmdx config variant
echo "Creating xmdx config..."
cat > astro.config.xmdx.ts << 'EOF'
import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';
import { defineConfig as baseConfig } from './astro.config';

// Import base config and replace mdx with xmdx
const config = baseConfig;
export default defineConfig({
  ...config,
  integrations: config.integrations?.map(i =>
    i.name === '@astrojs/mdx' ? xmdx() : i
  ) ?? [xmdx()],
});
EOF

echo "Setup complete!"
