/**
 * Basic example: Converting markdown to HTML
 */

import { parse } from '../index.js';

const markdown = `
# Welcome to Markflow

Markflow is a **high-performance** streaming Markdown parser built with Rust.

## Features

- Fast markdown parsing
- Automatic image lazy loading
- Zero-copy streaming architecture
- Built with Rust for maximum performance

## Code Example

\`\`\`javascript
import { parse } from 'markflow';

const html = parse('# Hello World');
console.log(html);
\`\`\`

![Example Image](example.png)
`;

console.log('🚀 Basic Markdown Parsing Example\n');
console.log('Input markdown:');
console.log('─'.repeat(50));
console.log(markdown);
console.log('─'.repeat(50));

const html = parse(markdown);

console.log('\n✨ Generated HTML:');
console.log('─'.repeat(50));
console.log(html);
console.log('─'.repeat(50));

console.log('\n📊 Stats:');
console.log(`  Input length: ${markdown.length} characters`);
console.log(`  Output length: ${html.length} characters`);
console.log(`  Lazy loading enabled: ${html.includes('loading="lazy"')}`);
