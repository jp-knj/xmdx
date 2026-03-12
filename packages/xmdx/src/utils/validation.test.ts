import { describe, test, expect } from 'bun:test';
import { stripHeadingsMeta } from './validation.js';

describe('stripHeadingsMeta', () => {
  test('returns code unchanged when no headings metadata', () => {
    const code = `import React from 'react';\n\nexport default () => <div>Hello</div>;`;
    expect(stripHeadingsMeta(code)).toBe(code);
  });

  test('removes export const headings', () => {
    const code = `export const headings = [{depth: 1, text: "Title"}];\n\nContent`;
    const result = stripHeadingsMeta(code);
    expect(result).not.toContain('export const headings');
    expect(result).toContain('Content');
  });

  test('removes export function getHeadings', () => {
    const code = `export function getHeadings() { return []; }\n\nContent`;
    const result = stripHeadingsMeta(code);
    expect(result).not.toContain('export function getHeadings');
    expect(result).toContain('Content');
  });

  test('removes both headings exports', () => {
    const code = `export const headings = [];\nexport function getHeadings() { return headings; }\n\nContent`;
    const result = stripHeadingsMeta(code);
    expect(result).not.toContain('export const headings');
    expect(result).not.toContain('export function getHeadings');
    expect(result).toContain('Content');
  });

  test('handles multiline headings array', () => {
    const code = `export const headings = [\n  {depth: 1, text: "A"},\n  {depth: 2, text: "B"}\n];\n\nContent`;
    const result = stripHeadingsMeta(code);
    expect(result).not.toContain('export const headings');
    expect(result).toContain('Content');
  });

  test('handles multiline getHeadings function', () => {
    const code = `export function getHeadings() {\n  return [\n    {depth: 1}\n  ];\n}\n\nContent`;
    const result = stripHeadingsMeta(code);
    expect(result).not.toContain('export function getHeadings');
    expect(result).toContain('Content');
  });

  test('preserves other exports', () => {
    const code = `export const frontmatter = {};\nexport const headings = [];\nexport function MyComponent() {}`;
    const result = stripHeadingsMeta(code);
    expect(result).toContain('export const frontmatter');
    expect(result).not.toContain('export const headings');
    expect(result).toContain('export function MyComponent');
  });

  test('handles Windows line endings (CRLF)', () => {
    const code = `export const headings = [];\r\n\r\nContent`;
    const result = stripHeadingsMeta(code);
    expect(result).not.toContain('export const headings');
    expect(result).toContain('Content');
  });
});
