#!/usr/bin/env node
// Patches ja/guides/testing.mdx to fix :::tip inside <Steps>
// The :::tip directive at wrong indentation level causes xmdx to process it
// as a sibling of <ol> rather than inside a list item

const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/content/docs/ja/guides/testing.mdx');

if (!fs.existsSync(filePath)) {
  console.log('Japanese testing.mdx not found, skipping');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

// Move </Steps> before :::tip[`baseUrl`を設定する] blocks
// Pattern: :::tip[`baseUrl`...] followed by content, :::, then </Steps>
content = content.replace(
  /(\n    :::tip\[`baseUrl`を設定する\]\n[\s\S]*?\n    :::)\n<\/Steps>/g,
  '\n</Steps>$1'
);

fs.writeFileSync(filePath, content);
console.log('Patched ja/guides/testing.mdx');
