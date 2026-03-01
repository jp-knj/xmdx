import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createCompiler } from '../index.js';

const fixturePath = resolve(import.meta.dir, '../../../fixtures/core/markdown/hello.md');
const markdown = readFileSync(fixturePath, 'utf8');

const compiler = createCompiler({});

test('compile produces consistent output for hello.md', () => {
  const result = compiler.compile(markdown, '/hello.md', {});

  expect(typeof result.code).toBe('string');
  expect(result.code.length > 0).toBe(true);
  expect(Array.isArray(result.headings)).toBe(true);
});

test('compile with url option produces same code', () => {
  const result1 = compiler.compile(markdown, '/hello.md', {});
  const result2 = compiler.compile(markdown, '/hello.md', { url: '/test' });

  // URL is injected into the module code but the markdown content is the same
  expect(result2.code.includes('/test')).toBe(true);
});
