/**
 * Advanced example: Using custom options to control HTML rewriting
 */

import { parseWithOptions } from '../index.js';

const markdown = `
# Image Loading Control

Here are some example images:

![Hero Image](hero.png)
![Logo](logo.svg)
![Screenshot](screenshot.jpg)
`;

console.log('⚙️  Parsing with Custom Options\n');

// Example 1: With lazy loading enabled (default behavior)
console.log('1️⃣ With lazy loading ENABLED:');
console.log('─'.repeat(50));
const htmlWithLazy = parseWithOptions(markdown, {
  enforceImgLoadingLazy: true
});
console.log(htmlWithLazy);
console.log('─'.repeat(50));

// Example 2: With lazy loading disabled
console.log('\n2️⃣ With lazy loading DISABLED:');
console.log('─'.repeat(50));
const htmlWithoutLazy = parseWithOptions(markdown, {
  enforceImgLoadingLazy: false
});
console.log(htmlWithoutLazy);
console.log('─'.repeat(50));

// Comparison
console.log('\n📊 Comparison:');
console.log(`  With lazy loading:    ${htmlWithLazy.match(/loading="lazy"/g)?.length || 0} images`);
console.log(`  Without lazy loading: ${htmlWithoutLazy.match(/loading="lazy"/g)?.length || 0} images`);
console.log(`  Total images:         ${markdown.match(/!\[/g)?.length || 0} images`);
