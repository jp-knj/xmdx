import { test, expect } from 'bun:test';
import { compileIr } from '../index.js';

test('compileIr() converts markdown to HTML', () => {
  const input = '# Hello World';
  const result = compileIr(input, '/virtual.md');

  expect(result.html.includes('<h1')).toBe(true);
  expect(result.html.includes('Hello World')).toBe(true);
  expect(result.html.includes('</h1>')).toBe(true);
});

test('compileIr() handles bold and italic text', () => {
  const input = 'This is **bold** and *italic* text';
  const result = compileIr(input, '/virtual.md');

  expect(result.html.includes('<strong>bold</strong>')).toBe(true);
  expect(result.html.includes('<em>italic</em>')).toBe(true);
});

test('compileIr() handles code blocks', () => {
  const input = '```javascript\nconsole.log("test");\n```';
  const result = compileIr(input, '/virtual.md');

  expect(result.html.includes('<pre')).toBe(true);
  expect(result.html.includes('<code')).toBe(true);
  expect(result.html.includes('language-javascript')).toBe(true);
});

test('compileIr() handles images', () => {
  const input = '![Alt text](image.png)';
  const result = compileIr(input, '/virtual.md');

  // HTML is now inside a JSON string (via set:html), so quotes are escaped
  expect(result.html.includes('alt=\\"Alt text\\"')).toBe(true);
  expect(result.html.includes('src=\\"image.png\\"')).toBe(true);
});

test('compileIr() handles lists', () => {
  const input = '- Item 1\n- Item 2\n- Item 3';
  const result = compileIr(input, '/virtual.md');

  expect(result.html.includes('<ul>')).toBe(true);
  expect(result.html.includes('<li>')).toBe(true);
  expect(result.html.includes('Item 1')).toBe(true);
  expect(result.html.includes('Item 2')).toBe(true);
  expect(result.html.includes('</ul>')).toBe(true);
});

test('compileIr() assigns heading ids', () => {
  const input = '# Hello Heading';
  const result = compileIr(input, '/virtual.md');

  // HTML is now inside a JSON string (via set:html), so quotes are escaped
  expect(result.html.includes('id=\\"hello-heading\\"')).toBe(true);
});

test('compileIr() handles links', () => {
  const input = '[Link text](https://example.com)';
  const result = compileIr(input, '/virtual.md');

  // HTML is now inside a JSON string (via set:html), so quotes are escaped
  expect(result.html.includes('<a href=\\"https://example.com\\">')).toBe(true);
  expect(result.html.includes('Link text')).toBe(true);
  expect(result.html.includes('</a>')).toBe(true);
});

test('compileIr() returns an object with html', () => {
  const result = compileIr('# Test', '/virtual.md');
  expect(typeof result).toBe('object');
  expect(typeof result.html).toBe('string');
});

test('compileIr() handles empty input', () => {
  const result = compileIr('', '/virtual.md');
  expect(typeof result.html).toBe('string');
});

test('compileIr() passes through HTML blocks', () => {
  const input = '<section>Hello</section>\n\nSome text';
  const result = compileIr(input, '/virtual.md');

  // Raw HTML is preserved (possibly as JSX spread format)
  expect(result.html.includes('section') || result.html.includes('Hello')).toBe(true);
});
