/**
 * Tests for the new NAPI utility functions used by the fallback compilation path.
 */
import { test, expect, describe } from 'bun:test';
import {
  rewriteDirectives,
  extractHeadings,
  stripCustomIds,
  rewriteTaskListItems,
  rewriteHeadingAutolinks,
  createCompiler,
} from '../index.js';

describe('rewriteDirectives', () => {
  test('rewrites directive syntax to Aside JSX', () => {
    const source = `# Title

:::note[Important]
This is a note.
:::

Some text.
`;
    const result = rewriteDirectives(source);
    expect(result.directiveCount).toBe(1);
    expect(result.code).toContain('<Aside');
    expect(result.code).toContain('type="note"');
    expect(result.code).toContain('title="Important"');
    expect(result.code).toContain('</Aside>');
    expect(result.code).not.toContain(':::note');
  });

  test('returns unchanged source when no directives', () => {
    const source = '# Just a heading\n\nSome paragraph.\n';
    const result = rewriteDirectives(source);
    expect(result.directiveCount).toBe(0);
    expect(result.code).toBe(source);
  });

  test('handles multiple directive types', () => {
    const source = `:::note
Note content.
:::

:::tip[Pro Tip]
Tip content.
:::

:::warning
Warning content.
:::
`;
    const result = rewriteDirectives(source);
    expect(result.directiveCount).toBe(3);
    expect(result.code).toContain('type="note"');
    expect(result.code).toContain('type="tip"');
    expect(result.code).toContain('type="warning"');
  });

  test('supports custom directive names and component map', () => {
    const source = `:::custom-box[Title]
Content.
:::
`;
    const result = rewriteDirectives(source, ['custom-box'], { 'custom-box': 'Box' });
    expect(result.directiveCount).toBe(1);
    expect(result.code).toContain('<Box');
    expect(result.code).toContain('</Box>');
    expect(result.code).toContain('type="custom-box"');
    expect(result.code).toContain('title="Title"');
  });

  test('ignores unknown directives with custom names', () => {
    const source = `:::note
Content.
:::
`;
    // When custom names are specified, only those are recognized
    const result = rewriteDirectives(source, ['custom-box']);
    expect(result.directiveCount).toBe(0);
    expect(result.code).toContain(':::note');
  });
});

describe('extractHeadings', () => {
  test('extracts heading metadata from source', () => {
    const source = `# Title

## Section One

### Subsection {#custom-id}

## Section Two
`;
    const headings = extractHeadings(source);
    expect(headings).toHaveLength(4);
    expect(headings[0]).toEqual({ depth: 1, slug: 'title', text: 'Title' });
    expect(headings[1]).toEqual({ depth: 2, slug: 'section-one', text: 'Section One' });
    expect(headings[2]).toEqual({ depth: 3, slug: 'custom-id', text: 'Subsection' });
    expect(headings[3]).toEqual({ depth: 2, slug: 'section-two', text: 'Section Two' });
  });

  test('skips headings inside code fences', () => {
    const source = `# Real Heading

\`\`\`
# Not a heading
\`\`\`

## Another Real
`;
    const headings = extractHeadings(source);
    expect(headings).toHaveLength(2);
    expect(headings[0]?.text).toBe('Real Heading');
    expect(headings[1]?.text).toBe('Another Real');
  });
});

describe('stripCustomIds', () => {
  test('strips {#id} from heading lines', () => {
    const source = `# Title

## Section {#my-section}

Some text.

### Another {#another-id}
`;
    const stripped = stripCustomIds(source);
    expect(stripped).not.toContain('{#my-section}');
    expect(stripped).not.toContain('{#another-id}');
    expect(stripped).toContain('## Section');
    expect(stripped).toContain('### Another');
  });

  test('preserves non-heading content', () => {
    const source = '# Title\n\nSome `{#not-id}` in code.\n';
    const stripped = stripCustomIds(source);
    expect(stripped).toContain('# Title');
    // Content within inline code is not a heading so should be preserved
    expect(stripped).toContain('`{#not-id}`');
  });
});

describe('rewriteTaskListItems', () => {
  test('handles no task lists gracefully', () => {
    const code = 'function foo() { return "hello"; }';
    const result = rewriteTaskListItems(code);
    expect(result).toBe(code);
  });

  test('works on mdxjs-rs compiled task list output (already rewritten)', () => {
    // mdxjs-rs already applies task list rewriting during compilation,
    // so rewriteTaskListItems should be a no-op (already wrapped)
    const source = `- [x] Done task
- [ ] Pending task
- Regular item
`;
    const compiler = createCompiler({});
    const batch = compiler.compileMdxBatch(
      [{ id: 'test.mdx', source, filepath: 'test.mdx' }],
      { continueOnError: false }
    );
    const mdxrsOutput = batch.results[0]?.result?.code ?? '';
    expect(mdxrsOutput).toContain('task-list-item');
    // Already has label/span wrapping from mdxjs-rs
    expect(mdxrsOutput).toContain('"label"');
    expect(mdxrsOutput).toContain('"span"');

    // rewriteTaskListItems should be a no-op since already wrapped
    const rewritten = rewriteTaskListItems(mdxrsOutput);
    expect(rewritten).toBe(mdxrsOutput);
  });
});

describe('rewriteHeadingAutolinks', () => {
  test('handles empty headings', () => {
    const code = 'function foo() { return "hello"; }';
    const result = rewriteHeadingAutolinks(code, []);
    expect(result).toBe(code);
  });

  test('works on mdxjs-rs compiled heading output', () => {
    const source = `# Hello World

## Section Two

Some text.
`;
    const compiler = createCompiler({});
    const batch = compiler.compileMdxBatch(
      [{ id: 'test.mdx', source, filepath: 'test.mdx' }],
      { continueOnError: false }
    );
    const mdxrsOutput = batch.results[0]?.result?.code ?? '';

    const hasHeadingPattern = mdxrsOutput.includes('_jsx(_components.h1,') ||
      mdxrsOutput.includes('_jsxs(_components.h1,') ||
      mdxrsOutput.includes('_jsx("h1",') ||
      mdxrsOutput.includes('_jsxs("h1",');
    expect(hasHeadingPattern).toBe(true);

    const headings = [
      { depth: 1, slug: 'hello-world', text: 'Hello World' },
      { depth: 2, slug: 'section-two', text: 'Section Two' },
    ];
    const rewritten = rewriteHeadingAutolinks(mdxrsOutput, headings);
    expect(rewritten).toContain('href: "#hello-world"');
    expect(rewritten).toContain('href: "#section-two"');
  });
});
