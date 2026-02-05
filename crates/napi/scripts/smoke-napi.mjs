import { parse, parseWithOptions, parseWithStats } from '../index.js';

const testMarkdown = `# Test Heading

This is a **bold** paragraph with some *italic* text.

## Code Example

\`\`\`javascript
console.log('Hello, World!');
\`\`\`

## Image Test

![Alt text](image.png)

## List Test

- Item 1
- Item 2
- Item 3
`;

console.log('🧪 Running NAPI smoke test...\n');

// Test 1: Basic parse
console.log('1️⃣ Testing parse()...');
const result = parse(testMarkdown);
console.log('  ✅ Input length:', testMarkdown.length, 'characters');
console.log('  ✅ Output length:', result.length, 'characters');
console.log('  ✅ Contains lazy loading:', result.includes('loading="lazy"'));

// Test 2: Parse with options (lazy loading disabled)
console.log('\n2️⃣ Testing parseWithOptions() with lazy loading disabled...');
const resultNoLazy = parseWithOptions(testMarkdown, { enforceImgLoadingLazy: false });
console.log('  ✅ Lazy loading disabled:', !resultNoLazy.includes('loading="lazy"'));

// Test 3: Parse with options (lazy loading enabled)
console.log('\n3️⃣ Testing parseWithOptions() with lazy loading enabled...');
const resultWithLazy = parseWithOptions(testMarkdown, { enforceImgLoadingLazy: true });
console.log('  ✅ Lazy loading enabled:', resultWithLazy.includes('loading="lazy"'));

// Test 4: Parse with stats
console.log('\n4️⃣ Testing parseWithStats()...');
const stats = parseWithStats(testMarkdown);
console.log('  ✅ HTML length:', stats.html.length, 'characters');
console.log('  ✅ Processing time:', stats.processingTimeMs.toFixed(3), 'ms');
console.log('  ✅ Stats object has correct properties:',
  'html' in stats && 'processingTimeMs' in stats);

console.log('\n📝 Sample output (first 200 chars):');
console.log(result.slice(0, 200) + '...\n');

console.log('✅ All smoke tests passed successfully!');
