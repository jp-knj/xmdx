import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wasmPath = resolve(import.meta.dir, '../wasm/xmdx_wasm_bg.wasm');

if (!existsSync(wasmPath)) {
  describe.skip('WASM not available', () => {
    it('skip', () => {});
  });
} else {
  const { compile } = await import('./browser.js');

  describe('browser.ts WASM compile', () => {
    it('compiles basic markdown', async () => {
      const result = await compile('# Hello World\n\nThis is **bold** text.');
      expect(result.code).toContain('createComponent');
      expect(result.headings).toHaveLength(1);
      expect(result.headings[0].depth).toBe(1);
      expect(result.headings[0].text).toBe('Hello World');
      expect(result.headings[0].slug).toBe('hello-world');
    });

    it('extracts frontmatter', async () => {
      const source = `---
title: My Page
description: A test page
---

# Content here`;
      const result = await compile(source);
      expect(result.frontmatter.title).toBe('My Page');
      expect(result.frontmatter.description).toBe('A test page');
    });

    it('extracts multiple headings', async () => {
      const source = `# First
## Second
### Third`;
      const result = await compile(source);
      expect(result.headings).toHaveLength(3);
      expect(result.headings.map((h: { depth: number }) => h.depth)).toEqual([1, 2, 3]);
      expect(result.headings.map((h: { text: string }) => h.text)).toEqual([
        'First',
        'Second',
        'Third',
      ]);
    });

    it('handles empty input', async () => {
      const result = await compile('');
      expect(result.code).toBeDefined();
      expect(result.frontmatter).toEqual({});
      expect(result.headings).toEqual([]);
    });

    it('detects user default export', async () => {
      const source = `export default function Layout() { return null; }

# Hello`;
      const result = await compile(source);
      expect(result.hasUserDefaultExport).toBe(true);
    });

    it('reports no user default export for normal content', async () => {
      const result = await compile('# Just a heading');
      expect(result.hasUserDefaultExport).toBe(false);
    });

    describe('fixtures', () => {
      const fixturesDir = resolve(import.meta.dir, '../../../fixtures/core/markdown');

      it('compiles hello.md', async () => {
        const source = readFileSync(resolve(fixturesDir, 'hello.md'), 'utf8');
        const result = await compile(source, { filepath: 'hello.md' });
        expect(result.code).toContain('createComponent');
        expect(result.headings.length).toBeGreaterThanOrEqual(1);
      });

      it('compiles gfm_full.md', async () => {
        const source = readFileSync(resolve(fixturesDir, 'gfm_full.md'), 'utf8');
        const result = await compile(source, { filepath: 'gfm_full.md' });
        expect(result.code).toContain('createComponent');
        expect(result.headings.length).toBeGreaterThanOrEqual(3);
      });
    });
  });
}
