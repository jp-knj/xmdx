import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileIr, createCompiler, compileBatchToModule, compileMdxBatch, parseBlocks } from '../index.js';

const fixturesDir = resolve(import.meta.dir, '../../../fixtures/core');

function readFixture(path: string): string {
  return readFileSync(resolve(fixturesDir, path), 'utf8');
}

// ── Markdown path snapshots ─────────────────────────────────────────────

test('snapshot: hello.md', () => {
  const source = readFixture('markdown/hello.md');
  const result = compileIr(source, '/hello.md');
  expect(result.html).toMatchSnapshot();
  expect(result.headings).toMatchSnapshot();
});

test('snapshot: table.md', () => {
  const source = readFixture('markdown/table.md');
  const result = compileIr(source, '/table.md');
  expect(result.html).toMatchSnapshot();
});

test('snapshot: slug_duplicates.md', () => {
  const source = readFixture('markdown/slug_duplicates.md');
  const result = compileIr(source, '/slug_duplicates.md');
  expect(result.html).toMatchSnapshot();
  expect(result.headings).toMatchSnapshot();
});

test('snapshot: footnotes.md', () => {
  const source = readFixture('markdown/footnotes.md');
  const result = compileIr(source, '/footnotes.md');
  expect(result.html).toMatchSnapshot();
  expect(result.headings).toMatchSnapshot();
});

test('snapshot: gfm_full.md', () => {
  const source = readFixture('markdown/gfm_full.md');
  const result = compileIr(source, '/gfm_full.md');
  expect(result.html).toMatchSnapshot();
  expect(result.headings).toMatchSnapshot();
});

test('snapshot: aside_directive.md', () => {
  const source = readFixture('components/aside_directive.md');
  const result = compileIr(source, '/aside_directive.md');
  expect(result.html).toMatchSnapshot();
});

// ── Directive rendering ─────────────────────────────────────────────────

test('snapshot: directives with attributes', () => {
  const source = `:::note[Important Notice]
This is **important** content with a [link](https://example.com).
:::

:::warning
Be careful!
:::

:::tip{id="my-tip"}
A tip with attributes.
:::`;
  const result = compileIr(source, '/directives.md');
  expect(result.html).toMatchSnapshot();
});

// ── Task list rendering ─────────────────────────────────────────────────

test('snapshot: task lists', () => {
  const source = `- [x] Completed task
- [ ] Incomplete task
- Regular list item

1. [x] Ordered checked
2. [ ] Ordered unchecked`;
  const result = compileIr(source, '/tasklist.md');
  expect(result.html).toMatchSnapshot();
});

// ── Custom heading IDs ──────────────────────────────────────────────────

test('snapshot: custom heading IDs', () => {
  const source = `# First Heading {#custom-first}

## Second Heading

## Second Heading

### Third with **bold** {#bold-heading}`;
  const result = compileIr(source, '/custom-ids.md');
  expect(result.html).toMatchSnapshot();
  expect(result.headings).toMatchSnapshot();
});

// ── MDX compilation path snapshots ──────────────────────────────────────

test('snapshot: simple MDX compilation', () => {
  const source = `---
title: Test
---

# Hello MDX

This is **bold** and *italic*.

- Item 1
- Item 2
`;
  const batchResult = compileMdxBatch(
    [{ id: '/test.mdx', source }],
    { continueOnError: false, config: {} }
  );

  const result = batchResult.results[0];
  expect(result?.error).toBeUndefined();
  expect(result?.result?.code).toMatchSnapshot();
  expect(result?.result?.headings).toMatchSnapshot();
});

test('snapshot: MDX with task lists', () => {
  const source = `# Tasks

- [x] Done
- [ ] Todo
`;
  const batchResult = compileMdxBatch(
    [{ id: '/tasks.mdx', source }],
    { continueOnError: false, config: {} }
  );

  const result = batchResult.results[0];
  expect(result?.error).toBeUndefined();
  expect(result?.result?.code).toMatchSnapshot();
});

test('snapshot: MDX with directives', () => {
  const source = `# Guide

:::note[Pay Attention]
This is important.
:::

:::warning
Danger ahead!
:::
`;
  const batchResult = compileMdxBatch(
    [{ id: '/directives.mdx', source }],
    { continueOnError: false, config: {} }
  );

  const result = batchResult.results[0];
  expect(result?.error).toBeUndefined();
  expect(result?.result?.code).toMatchSnapshot();
});

// ── Batch compilation (MD path) ─────────────────────────────────────────

test('snapshot: compileBatchToModule for markdown', () => {
  const source = `# Batch Test

Paragraph with **bold** and [link](https://example.com).

\`\`\`js
const x = 1;
\`\`\`
`;
  const batchResult = compileBatchToModule(
    [{ id: '/batch.md', filepath: '/batch.md', source }],
    { continueOnError: false, config: {} }
  );

  const result = batchResult.results[0];
  expect(result?.error).toBeUndefined();
  expect(result?.result?.code).toMatchSnapshot();
  expect(result?.result?.headings).toMatchSnapshot();
});

// ── Heading autolinks ───────────────────────────────────────────────────

test('heading autolinks: disabled by default', () => {
  const source = '# Hello\n\n## World\n';
  const result = compileIr(source, '/test.md');
  expect(result.html).not.toContain('<a href=');
  expect(result.html).toContain('id=\\"hello\\"');
});

test('heading autolinks: enabled via config', () => {
  const source = '# Hello\n\n## World {#custom}\n';
  const result = compileIr(source, '/test.md', undefined, {
    enableHeadingAutolinks: true,
  });
  expect(result.html).toContain('<a href=\\"#hello\\">');
  expect(result.html).toContain('<a href=\\"#custom\\">');
  expect(result.html).toContain('</a>');
});

test('heading autolinks: enabled via parseBlocks', () => {
  const source = '# Hello\n\n## World\n';
  const result = parseBlocks(source, {
    enableHeadingAutolinks: true,
  });
  const html = result.blocks.map((b: any) => b.content || '').join('');
  expect(html).toContain('<a href="#hello">');
  expect(html).toContain('<a href="#world">');
});

// ── Custom directives ───────────────────────────────────────────────────

test('custom directives: MDX path with custom component mapping', () => {
  const source = '# Test\n\n:::custom-box[Hello]\nContent here\n:::\n';
  const batchResult = compileMdxBatch(
    [{ id: '/custom.mdx', source }],
    {
      continueOnError: false,
      config: {
        customDirectiveNames: ['custom-box'],
        directiveComponentMap: { 'custom-box': 'MyBox' },
      },
    }
  );

  const result = batchResult.results[0];
  expect(result?.error).toBeUndefined();
  expect(result?.result?.code).toContain('MyBox');
  expect(result?.result?.code).toContain('custom-box');
});

test('custom directives: built-in directives still work with custom names', () => {
  const source = ':::note[Notice]\nImportant\n:::\n';
  const batchResult = compileMdxBatch(
    [{ id: '/builtin.mdx', source }],
    {
      continueOnError: false,
      config: {
        customDirectiveNames: ['custom-box'],
      },
    }
  );

  const result = batchResult.results[0];
  expect(result?.error).toBeUndefined();
  expect(result?.result?.code).toContain('Aside');
});
