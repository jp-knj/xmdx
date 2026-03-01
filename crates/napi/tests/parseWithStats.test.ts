import { test, expect } from 'bun:test';
import { createCompiler } from '../index.js';

const compiler = createCompiler({});

test('compile() returns an object with code and headings', () => {
  const input = '# Test Heading';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(typeof result).toBe('object');
  expect('code' in result).toBe(true);
  expect('headings' in result).toBe(true);
});

test('compile() code contains correct output', () => {
  const input = '# Test Heading';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(result.code.includes('Test Heading')).toBe(true);
});

test('compile() headings contains heading metadata', () => {
  const input = '# Test\n\n## Subheading';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(Array.isArray(result.headings)).toBe(true);
  expect(result.headings.length).toBe(2);
  expect(result.headings[0].depth).toBe(1);
  expect(result.headings[0].text).toBe('Test');
  expect(result.headings[1].depth).toBe(2);
  expect(result.headings[1].text).toBe('Subheading');
});

test('compile() handles images', () => {
  const input = '![alt](image.png)';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(result.code.includes('img')).toBe(true);
  expect(result.code.includes('image.png')).toBe(true);
});

test('compile() works with large input', () => {
  const input = '# Heading\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(100);
  const result = compiler.compile(input, '/virtual.md', {});

  expect(result.code.length > input.length).toBe(true);
});

test('compile() works with empty input', () => {
  const result = compiler.compile('', '/virtual.md', {});

  expect(typeof result.code).toBe('string');
});

test('compileBatch() returns processing stats with timing', () => {
  const inputs = [
    { id: 'file1.md', source: '# Hello' },
    { id: 'file2.md', source: '# World' },
  ];
  const batchResult = compiler.compileBatch(inputs, { continueOnError: true });

  expect(typeof batchResult.stats).toBe('object');
  expect(typeof batchResult.stats.processingTimeMs).toBe('number');
  expect(batchResult.stats.processingTimeMs >= 0).toBe(true);
  expect(batchResult.stats.total).toBe(2);
  expect(batchResult.stats.succeeded).toBe(2);
});
