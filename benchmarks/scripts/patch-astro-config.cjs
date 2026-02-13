#!/usr/bin/env node
// Patches astro.config.ts to use expressiveCode: true and remove pluginCollapsibleSections import

const fs = require('fs');
const path = require('path');

const configPath = path.join(process.cwd(), 'astro.config.ts');
let content = fs.readFileSync(configPath, 'utf8');

// Remove pluginCollapsibleSections import
content = content.replace(/import { pluginCollapsibleSections }.*\n?/g, '');

// Replace expressiveCode block with just true
content = content.replace(
  /expressiveCode: \{[\s\S]*?plugins: \[pluginCollapsibleSections\(\)\][\s\S]*?\}/,
  'expressiveCode: true'
);

fs.writeFileSync(configPath, content);
console.log('Updated astro.config.ts');
