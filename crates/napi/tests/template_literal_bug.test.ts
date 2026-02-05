import { test, expect } from 'bun:test';
import { createCompiler } from '../index.js';

const compiler = createCompiler();

test('inline code with template literal syntax should not be evaluated', async () => {
  // This is the pattern that causes runtime errors:
  // The ${variable} inside backticks should be treated as literal text
  const source = 'Use `style={`--myVar:${value}`}` to set the style.';
  const result = await compiler.compile(source, '/virtual.mdx');

  // The output should NOT contain an actual template literal that would
  // evaluate ${value} as a JavaScript expression
  // It should contain escaped or quoted content
  expect(
    result.code.includes('`--myVar:${value}`')
  ).toBe(false);

  // The content should be safely rendered as a string
  expect(
    result.code.includes('<code>')
  ).toBe(true);
});

test('inline code with dollar sign should be safe in JSX', async () => {
  const source = 'Use `${variable}` in template literals.';
  const result = await compiler.compile(source, '/virtual.mdx');

  // Should not cause reference errors when evaluated
  // The ${variable} should be escaped or rendered as text
  expect(
    result.code.includes('<code>')
  ).toBe(true);
});

test('double backtick inline code preserves content', async () => {
  // Double backticks are used to include backticks in inline code
  const source = 'Use `` `template` `` for templates.';
  const result = await compiler.compile(source, '/virtual.mdx');

  expect(
    result.code.includes('<code>')
  ).toBe(true);
});

test('REPRO: double backtick with template literal causes runtime error', async () => {
  // This is the exact pattern from astro-syntax.mdx that causes:
  // "value is not defined" runtime error
  const source = 'then you can manually add a ``style={`--myVar:${value}`}`` to your Element.';
  const result = await compiler.compile(source, '/virtual.mdx');

  console.log('Generated code:', result.code);

  // The output should NOT contain an unescaped template literal
  // that would cause ${value} to be evaluated
  expect(
    /`[^`]*\$\{value\}[^`]*`/.test(result.code)
  ).toBe(false);

  expect(
    result.code.includes('<code>')
  ).toBe(true);
});
