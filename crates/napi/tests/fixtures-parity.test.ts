import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compileIr } from '../index.js';

const fixturePath = resolve(import.meta.dir, '../../../fixtures/core/markdown/hello.md');
const markdown = readFileSync(fixturePath, 'utf8');

test('compileIr produces consistent output for hello.md', () => {
  const result = compileIr(markdown, '/hello.md');

  expect(typeof result.html).toBe('string');
  expect(result.html.length > 0).toBe(true);
  expect(Array.isArray(result.headings)).toBe(true);
});

test('compileIr with url option produces same html', () => {
  const result1 = compileIr(markdown, '/hello.md');
  const result2 = compileIr(markdown, '/hello.md', { url: '/test' });

  expect(result1.html).toBe(result2.html);
  expect(result2.url).toBe('/test');
});
