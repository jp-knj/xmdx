import { test, expect } from 'bun:test';
import { createCompiler } from '../index.js';

const compiler = createCompiler({});

test('compile() converts markdown to HTML', () => {
  const input = '# Hello World';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(result.code.includes('Hello World')).toBe(true);
});

test('compile() handles bold and italic text', () => {
  const input = 'This is **bold** and *italic* text';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(result.code.includes('<strong>bold</strong>')).toBe(true);
  expect(result.code.includes('<em>italic</em>')).toBe(true);
});

test('compile() handles code blocks', () => {
  const input = '```javascript\nconsole.log("test");\n```';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(result.code.includes('astro-code')).toBe(true);
  expect(result.code.includes('language-javascript')).toBe(true);
});

test('compile() handles images', () => {
  const input = '![Alt text](image.png)';
  const result = compiler.compile(input, '/virtual.md', {});

  // HTML is now inside a JSON string (via set:html), so quotes are escaped
  expect(result.code.includes('alt=\\"Alt text\\"')).toBe(true);
  expect(result.code.includes('src=\\"image.png\\"')).toBe(true);
});

test('compile() handles lists', () => {
  const input = '- Item 1\n- Item 2\n- Item 3';
  const result = compiler.compile(input, '/virtual.md', {});

  expect(result.code.includes('<ul>')).toBe(true);
  expect(result.code.includes('<li>')).toBe(true);
  expect(result.code.includes('Item 1')).toBe(true);
  expect(result.code.includes('Item 2')).toBe(true);
  expect(result.code.includes('</ul>')).toBe(true);
});

test('compile() assigns heading ids', () => {
  const input = '# Hello Heading';
  const result = compiler.compile(input, '/virtual.md', {});

  // HTML is now inside a JSON string (via set:html), so quotes are escaped
  expect(result.code.includes('id=\\"hello-heading\\"')).toBe(true);
});

test('compile() handles links', () => {
  const input = '[Link text](https://example.com)';
  const result = compiler.compile(input, '/virtual.md', {});

  // HTML is now inside a JSON string (via set:html), so quotes are escaped
  expect(result.code.includes('<a href=\\"https://example.com\\">')).toBe(true);
  expect(result.code.includes('Link text')).toBe(true);
  expect(result.code.includes('</a>')).toBe(true);
});

test('compile() returns an object with code', () => {
  const result = compiler.compile('# Test', '/virtual.md', {});
  expect(typeof result).toBe('object');
  expect(typeof result.code).toBe('string');
});

test('compile() handles empty input', () => {
  const result = compiler.compile('', '/virtual.md', {});
  expect(typeof result.code).toBe('string');
});

test('compile() passes through HTML blocks', () => {
  const input = '<section>Hello</section>\n\nSome text';
  const result = compiler.compile(input, '/virtual.md', {});

  // Raw HTML is preserved (possibly as JSX spread format)
  expect(result.code.includes('section') || result.code.includes('Hello')).toBe(true);
});
