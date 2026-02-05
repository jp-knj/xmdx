import { test, expect } from 'bun:test';
import { compileIr, compileBatch } from '../index.js';

test('compileIr() returns an object with html and headings', () => {
  const input = '# Test Heading';
  const result = compileIr(input, '/virtual.md');

  expect(typeof result).toBe('object');
  expect('html' in result).toBe(true);
  expect('headings' in result).toBe(true);
});

test('compileIr() html contains correct output', () => {
  const input = '# Test Heading';
  const result = compileIr(input, '/virtual.md');

  expect(result.html.includes('<h1')).toBe(true);
  expect(result.html.includes('Test Heading')).toBe(true);
});

test('compileIr() headings contains heading metadata', () => {
  const input = '# Test\n\n## Subheading';
  const result = compileIr(input, '/virtual.md');

  expect(Array.isArray(result.headings)).toBe(true);
  expect(result.headings.length).toBe(2);
  expect(result.headings[0].depth).toBe(1);
  expect(result.headings[0].text).toBe('Test');
  expect(result.headings[1].depth).toBe(2);
  expect(result.headings[1].text).toBe('Subheading');
});

test('compileIr() includes filePath in result', () => {
  const input = '# Test';
  const result = compileIr(input, '/path/to/file.md');

  expect(result.filePath).toBe('/path/to/file.md');
});

test('compileIr() handles images', () => {
  const input = '![alt](image.png)';
  const result = compileIr(input, '/virtual.md');

  expect(result.html.includes('img')).toBe(true);
  expect(result.html.includes('image.png')).toBe(true);
});

test('compileIr() works with large input', () => {
  const input = '# Heading\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(100);
  const result = compileIr(input, '/virtual.md');

  expect(result.html.length > input.length).toBe(true);
});

test('compileIr() works with empty input', () => {
  const result = compileIr('', '/virtual.md');

  expect(typeof result.html).toBe('string');
});

test('compileBatch() returns processing stats with timing', () => {
  const inputs = [
    { id: 'file1.md', source: '# Hello' },
    { id: 'file2.md', source: '# World' },
  ];
  const batchResult = compileBatch(inputs);

  expect(typeof batchResult.stats).toBe('object');
  expect(typeof batchResult.stats.processingTimeMs).toBe('number');
  expect(batchResult.stats.processingTimeMs >= 0).toBe(true);
  expect(batchResult.stats.total).toBe(2);
  expect(batchResult.stats.succeeded).toBe(2);
});
