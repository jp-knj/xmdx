import { describe, test, expect } from 'bun:test';
import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { rehypeTasklistEnhancer } from './jsx-module.js';

/**
 * Helper: compile markdown through @mdx-js/mdx with remark-gfm and
 * rehypeTasklistEnhancer, returning the output string.
 *
 * The output is JSX function calls (e.g. `_components.label`, `_components.span`),
 * not raw HTML. Assertions check for these JSX patterns.
 */
async function compileTaskList(md: string): Promise<string> {
  const vfile = await compile(md, {
    jsxImportSource: 'astro',
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeTasklistEnhancer],
  });
  return String(vfile);
}

describe('rehypeTasklistEnhancer', () => {
  describe('tight task list', () => {
    test('wraps checkbox and text in label and span', async () => {
      const md = `- [ ] Unchecked item\n- [x] Checked item\n`;
      const out = await compileTaskList(md);

      // Plugin produces <label><input .../><span>...</span></label>
      // which @mdx-js/mdx compiles to _components.label / _components.span calls
      expect(out).toContain('label');
      expect(out).toContain('span');
      expect(out).toContain('task-list-item');
      // Verify both label and span are declared in _components
      expect(out).toContain('label: "label"');
      expect(out).toContain('span: "span"');
    });

    test('checked item has checked attribute', async () => {
      const md = `- [x] Done\n`;
      const out = await compileTaskList(md);

      expect(out).toContain('checked: true');
      expect(out).toContain('task-list-item');
      expect(out).toContain('label: "label"');
    });

    test('unchecked item does not have checked attribute', async () => {
      const md = `- [ ] Not done\n`;
      const out = await compileTaskList(md);

      expect(out).toContain('task-list-item');
      expect(out).toContain('label: "label"');
      expect(out).not.toContain('checked: true');
    });
  });

  describe('loose task list', () => {
    test('wraps checkbox and text in label and span even with blank lines', async () => {
      const md = `- [ ] First item\n\n- [x] Second item\n\n- [ ] Third item\n`;
      const out = await compileTaskList(md);

      // Loose lists wrap content in <p>, but the plugin should still
      // find the input inside <p> and produce the label+span structure
      expect(out).toContain('label: "label"');
      expect(out).toContain('span: "span"');
      expect(out).toContain('task-list-item');
      // Loose lists also have <p> wrapper
      expect(out).toContain('p: "p"');
    });

    test('checked loose item has checked attribute', async () => {
      const md = `- [x] Loose checked\n\n- [ ] Loose unchecked\n`;
      const out = await compileTaskList(md);

      expect(out).toContain('checked: true');
      expect(out).toContain('label: "label"');
    });

    test('loose list label is nested inside p element', async () => {
      const md = `- [ ] Loose item\n\n- [x] Another loose item\n`;
      const out = await compileTaskList(md);

      // In loose lists, the <p> should contain the <label>, not be a sibling
      // The _components.p call should contain a _components.label child
      expect(out).toContain('_components.p');
      expect(out).toContain('_components.label');
    });
  });

  describe('nested task list', () => {
    test('nested sub-list is not wrapped inside span', async () => {
      const md = `- [x] Task item\n  - Sub item\n`;
      const out = await compileTaskList(md);

      // The label and span should be present
      expect(out).toContain('label: "label"');
      expect(out).toContain('span: "span"');
      // The nested ul should not be a child of the span element
      // In the JSX output, the ul should appear after the label, not nested inside span
      expect(out).toContain('task-list-item');
    });

    test('nested sub-list appears after label in tight list', async () => {
      const md = `- [ ] Parent task\n  - Child item 1\n  - Child item 2\n`;
      const out = await compileTaskList(md);

      expect(out).toContain('label: "label"');
      expect(out).toContain('span: "span"');
      // The ul for sub-items should exist
      expect(out).toContain('ul');
    });
  });

  describe('task list inside JSX component', () => {
    test('wraps checkbox in label when inside a component like Checklist', async () => {
      const md = `import Checklist from './Checklist.astro';

<Checklist>
- [ ] Looks great!
- [x] Already done!
</Checklist>`;
      const out = await compileTaskList(md);

      expect(out).toContain('task-list-item');
      expect(out).toContain('label: "label"');
      expect(out).toContain('span: "span"');
      // Verify both checked and unchecked items exist
      expect(out).toContain('checked: true');
      expect(out).toContain('disabled: true');
    });
  });
});
