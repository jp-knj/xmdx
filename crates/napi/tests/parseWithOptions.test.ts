import { test, expect } from 'bun:test';
import { compileIr, FileInputType } from '../index.js';

test('compileIr() handles images', () => {
  const input = '![alt](image.png)';
  const result = compileIr(input, '/virtual.md');

  // HTML is now inside a JSON string (via set:html), so quotes are escaped
  expect(result.html.includes('alt=\\"alt\\"')).toBe(true);
  expect(result.html.includes('src=\\"image.png\\"')).toBe(true);
});

test('compileIr() handles raw HTML img tags', () => {
  const input = '<img src="/hero.png" />';
  const result = compileIr(input, '/virtual.md');

  // Raw HTML is converted to JSX spread format
  expect(result.html.includes('img')).toBe(true);
  expect(result.html.includes('/hero.png')).toBe(true);
});

test('compileIr() with url option sets the url in result', () => {
  const input = '# Test';
  const result = compileIr(input, '/virtual.md', { url: '/test-page' });

  expect(result.url).toBe('/test-page');
});

test('compileIr() with fileType option can force MDX mode', () => {
  // Even with .md extension, can force MDX processing
  const input = '# Header\n\n**Bold** text';
  const result = compileIr(input, '/virtual.md', { fileType: FileInputType.Mdx });

  expect(result.html.includes('<h1')).toBe(true);
  expect(result.html.includes('Header')).toBe(true);
  expect(result.html.includes('<strong>Bold</strong>')).toBe(true);
});

test('compileIr() converts markdown to HTML correctly', () => {
  const input = '# Header\n\n**Bold** text';
  const result = compileIr(input, '/virtual.md');

  expect(result.html.includes('<h1')).toBe(true);
  expect(result.html.includes('Header')).toBe(true);
  expect(result.html.includes('<strong>Bold</strong>')).toBe(true);
});

test('compileIr() returns an object with html property', () => {
  const result = compileIr('# Test', '/virtual.md');
  expect(typeof result).toBe('object');
  expect(typeof result.html).toBe('string');
});
