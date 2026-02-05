import { test, expect } from 'bun:test';
import { createCompiler } from '../index.js';

const compiler = createCompiler();

test('compile converts directive to Aside component', () => {
  const source = ':::note\nBody\n:::';
  const result = compiler.compile(source, '/virtual.mdx');

  // Directive should be converted to Aside component with type in spread props
  expect(result.code.includes('<Aside')).toBe(true);
  expect(result.code.includes('"type": "note"')).toBe(true);
});

test('compile preserves existing Aside import without duplication', () => {
  const source = "import { Aside } from '@astrojs/starlight/components';\n\n:::note\nBody\n:::";
  const result = compiler.compile(source, '/virtual.mdx');

  // User-provided import should be preserved
  expect(result.code.includes("import { Aside } from '@astrojs/starlight/components';")).toBe(true);

  // Should not be duplicated
  const occurrences = result.code.split("import { Aside } from '@astrojs/starlight/components';").length - 1;
  expect(occurrences).toBe(1);
});
