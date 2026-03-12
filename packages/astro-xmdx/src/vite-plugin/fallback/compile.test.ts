/**
 * Integration tests for the fallback compilation path.
 *
 * Verifies that Rust NAPI post-processing (heading IDs, task list rewriting)
 * works correctly on @mdx-js/mdx compiled output — not just mdxjs-rs output.
 */
import { test, expect, describe } from 'bun:test';
import { compile as compileMdx } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { loadXmdxBinding } from '../binding-loader.js';
import { injectHeadingIds, repairHeadings } from '../mdx-wrapper/heading-id-injector.js';

describe('Rust post-processing on @mdx-js/mdx output', () => {
  test('rewriteTaskListItems wraps task list items from @mdx-js/mdx', async () => {
    const source = `- [x] Done task
- [ ] Pending task
- Regular item
`;
    const compiled = await compileMdx(source, {
      jsxImportSource: 'astro',
      remarkPlugins: [remarkGfm],
    });
    const mdxJsOutput = String(compiled);

    // @mdx-js/mdx with remark-gfm should produce task-list-item markers
    expect(mdxJsOutput).toContain('task-list-item');

    const binding = await loadXmdxBinding();
    const rewritten = binding.rewriteTaskListItems(mdxJsOutput);

    // Should have label/span wrapping added by Rust post-processing
    expect(rewritten).toContain('"label"');
    expect(rewritten).toContain('"span"');
  });

  test('heading IDs are injected into @mdx-js/mdx output', async () => {
    const source = `# Hello World

## Section Two

Some text.

### Third Level
`;
    const binding = await loadXmdxBinding();
    const headings = binding.extractHeadings(source);
    const stripped = binding.stripCustomIds(source);

    const compiled = await compileMdx(stripped, {
      jsxImportSource: 'astro',
    });
    const mdxJsOutput = String(compiled);

    // @mdx-js/mdx should produce heading JSX patterns
    const hasHeadingPattern =
      mdxJsOutput.includes('_components.h1') ||
      mdxJsOutput.includes('_components.h2') ||
      mdxJsOutput.includes('"h1"') ||
      mdxJsOutput.includes('"h2"');
    expect(hasHeadingPattern).toBe(true);

    // injectHeadingIds should add id props to heading elements
    const repaired = repairHeadings(mdxJsOutput, headings);
    const withIds = injectHeadingIds(mdxJsOutput, repaired);

    expect(withIds).toContain('"hello-world"');
    expect(withIds).toContain('"section-two"');
    expect(withIds).toContain('"third-level"');
  });

  test('heading IDs with custom {#id} syntax', async () => {
    const source = `# Title

## Custom Section {#my-custom-id}

Content here.
`;
    const binding = await loadXmdxBinding();
    const headings = binding.extractHeadings(source);
    expect(headings[1]?.slug).toBe('my-custom-id');

    const stripped = binding.stripCustomIds(source);
    expect(stripped).not.toContain('{#my-custom-id}');

    const compiled = await compileMdx(stripped, {
      jsxImportSource: 'astro',
    });
    const mdxJsOutput = String(compiled);

    const repaired = repairHeadings(mdxJsOutput, headings);
    const withIds = injectHeadingIds(mdxJsOutput, repaired);

    expect(withIds).toContain('"title"');
    expect(withIds).toContain('"my-custom-id"');
  });

  test('directive rewriting produces valid MDX for @mdx-js/mdx', async () => {
    const source = `# Title

:::note[Important]
This is a **bold** note.
:::

Some text.
`;
    const binding = await loadXmdxBinding();
    const result = binding.rewriteDirectives(source);
    expect(result.directiveCount).toBe(1);

    // The rewritten source should compile without errors through @mdx-js/mdx
    // (note: Aside component won't resolve, but compilation should succeed)
    const compiled = await compileMdx(result.code, {
      jsxImportSource: 'astro',
    });
    const output = String(compiled);

    // Should contain the Aside component reference
    expect(output).toContain('Aside');
    expect(output).toContain('bold');
  });
});

describe('stripFencedCodeBlocks (via injectComponentImports)', () => {
  test('PascalCase tags inside code fences are not matched', async () => {
    const source = `# Title

\`\`\`jsx
<FakeComponent prop="value" />
\`\`\`

Regular paragraph.
`;
    const binding = await loadXmdxBinding();
    // rewriteDirectives won't find directives, so injectComponentImports won't be called.
    // But we can verify that the source compiles without spurious imports
    // by checking that the fallback compilation doesn't inject <FakeComponent>
    const headings = binding.extractHeadings(source);
    expect(headings).toHaveLength(1);

    const compiled = await compileMdx(source, {
      jsxImportSource: 'astro',
    });
    const output = String(compiled);
    // FakeComponent appears in code block output but should not have an import
    expect(output).not.toMatch(/^import.*FakeComponent/m);
  });
});
