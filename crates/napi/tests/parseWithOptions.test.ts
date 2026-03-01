import { test, expect } from 'bun:test';
import { createCompiler } from '../index.js';

const compiler = createCompiler({});

test('compile() handles images', () => {
  const input = '![alt](image.png)';
  const result = compiler.compile(input, '/virtual.md', {});

  // HTML is now inside a JSON string (via set:html), so quotes are escaped
  expect(result.code.includes('alt=\\"alt\\"')).toBe(true);
  expect(result.code.includes('src=\\"image.png\\"')).toBe(true);
});

test('compile() handles raw HTML img tags', () => {
  const input = '<img src="/hero.png" />';
  const result = compiler.compile(input, '/virtual.md', {});

  // Raw HTML is converted to JSX spread format
  expect(result.code.includes('img')).toBe(true);
  expect(result.code.includes('/hero.png')).toBe(true);
});

test('compile() with url option sets the url in result', () => {
  const input = '# Test';
  const result = compiler.compile(input, '/virtual.md', { url: '/test-page' });

  // URL is embedded in the generated module code
  expect(result.code.includes('/test-page')).toBe(true);
});

test('compile() converts markdown to HTML correctly', () => {
  const input = '# Header\n\n**Bold** text';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(result.code.includes('Header')).toBe(true);
  expect(result.code.includes('Bold')).toBe(true);
});

test('compile() returns an object with code property', () => {
  const result = compiler.compile('# Test', '/virtual.md', {});
  expect(typeof result).toBe('object');
  expect(typeof result.code).toBe('string');
});
