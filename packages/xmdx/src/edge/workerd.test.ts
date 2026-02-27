import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wasmBinaryPath = resolve(import.meta.dir, '../../wasm/xmdx_wasm_bg.wasm');
const wasmJsPath = resolve(import.meta.dir, '../../wasm/xmdx_wasm.js');

if (!existsSync(wasmBinaryPath) || !existsSync(wasmJsPath)) {
  describe.skip('WASM not available — workerd tests skipped', () => {
    it('skip', () => {});
  });
} else {
  let Miniflare: typeof import('miniflare').Miniflare;
  let mf: InstanceType<typeof import('miniflare').Miniflare> | null = null;

  try {
    ({ Miniflare } = await import('miniflare'));
  } catch {
    describe.skip('miniflare not installed — workerd tests skipped', () => {
      it('skip', () => {});
    });
  }

  if (Miniflare!) {
    const workerScript = `
import wasmModule from './xmdx.wasm';
import { initSync, compile } from './xmdx_wasm.js';

let initialized = false;

export default {
  async fetch(request) {
    if (!initialized) {
      initSync({ module: wasmModule });
      initialized = true;
    }
    const { source, filepath } = await request.json();
    const result = compile(source, filepath, {});
    return Response.json(result);
  }
};`;

    describe('workerd (miniflare) integration', () => {
      beforeAll(async () => {
        mf = new Miniflare({
          modules: [
            { type: 'ESModule', path: 'worker.js', contents: workerScript },
            {
              type: 'ESModule',
              path: 'xmdx_wasm.js',
              contents: readFileSync(wasmJsPath, 'utf8'),
            },
            {
              type: 'CompiledWasm',
              path: 'xmdx.wasm',
              contents: readFileSync(wasmBinaryPath),
            },
          ],
        });
      });

      afterAll(async () => {
        if (mf) await mf.dispose();
      });

      async function compileInWorker(source: string, filepath = 'test.mdx') {
        const resp = await mf!.dispatchFetch('http://localhost/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, filepath }),
        });
        expect(resp.ok).toBe(true);
        return resp.json() as Promise<{
          code: string;
          frontmatter_json: string;
          headings: Array<{ depth: number; slug: string; text: string }>;
          has_user_default_export: boolean;
        }>;
      }

      it('compiles basic markdown in workerd', async () => {
        const result = await compileInWorker('# Hello World\n\nSome text.');
        expect(result.code).toContain('createComponent');
        expect(result.headings).toHaveLength(1);
        expect(result.headings[0].text).toBe('Hello World');
      });

      it('handles frontmatter in workerd', async () => {
        const source = `---
title: Worker Test
---

# Content`;
        const result = await compileInWorker(source, 'worker.mdx');
        const frontmatter = JSON.parse(result.frontmatter_json);
        expect(frontmatter.title).toBe('Worker Test');
      });

      it('extracts headings in workerd', async () => {
        const source = `# First
## Second
### Third`;
        const result = await compileInWorker(source);
        expect(result.headings).toHaveLength(3);
        expect(result.headings.map((h) => h.depth)).toEqual([1, 2, 3]);
      });
    });
  }
}
