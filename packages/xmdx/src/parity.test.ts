import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wasmPath = resolve(import.meta.dir, '../wasm/xmdx_wasm_bg.wasm');

if (!existsSync(wasmPath)) {
  describe.skip('WASM not available — parity tests skipped', () => {
    it('skip', () => {});
  });
} else {
  const { compile: wasmCompile } = await import('./browser.js');
  const { compile: napiCompile } = await import('./node.js');

  describe('NAPI vs WASM parity', () => {
    async function assertParity(source: string, filepath = 'test.mdx') {
      const [napi, wasm] = await Promise.all([
        napiCompile(source, { filepath }),
        wasmCompile(source, { filepath }),
      ]);

      // Frontmatter must match
      expect(wasm.frontmatter).toEqual(napi.frontmatter);

      // Headings must match (depth, slug, text)
      expect(wasm.headings.map((h: { depth: number; slug: string; text: string }) => ({
        depth: h.depth,
        slug: h.slug,
        text: h.text,
      }))).toEqual(napi.headings.map((h: { depth: number; slug: string; text: string }) => ({
        depth: h.depth,
        slug: h.slug,
        text: h.text,
      })));

      // hasUserDefaultExport must match
      expect(wasm.hasUserDefaultExport).toBe(napi.hasUserDefaultExport);

      // Both code outputs should contain the same key markers
      for (const marker of ['Fragment', 'createComponent', 'export const frontmatter']) {
        expect(wasm.code).toContain(marker);
        expect(napi.code).toContain(marker);
      }

      return { napi, wasm };
    }

    it('basic markdown', async () => {
      await assertParity('# Hello World\n\nThis is **bold** text.');
    });

    it('frontmatter', async () => {
      await assertParity(`---
title: Parity Test
count: 42
---

# Welcome`);
    });

    it('empty input', async () => {
      await assertParity('');
    });

    it('user default export', async () => {
      await assertParity(`export default function Layout() { return null; }

# Hello`);
    });

    describe('fixtures', () => {
      const fixturesDir = resolve(import.meta.dir, '../../../fixtures/core/markdown');
      const fixtures = [
        'hello.md',
        'gfm_full.md',
        'table.md',
        'slug_duplicates.md',
        'footnotes.md',
      ];

      for (const fixture of fixtures) {
        it(fixture, async () => {
          const source = readFileSync(resolve(fixturesDir, fixture), 'utf8');
          await assertParity(source, fixture);
        });
      }
    });
  });
}
