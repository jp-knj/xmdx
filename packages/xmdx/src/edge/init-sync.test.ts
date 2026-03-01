import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wasmBinaryPath = resolve(import.meta.dir, '../../wasm/xmdx_wasm_bg.wasm');
const wasmJsPath = resolve(import.meta.dir, '../../wasm/xmdx_wasm.js');

if (!existsSync(wasmBinaryPath) || !existsSync(wasmJsPath)) {
  describe.skip('WASM not available — initSync tests skipped', () => {
    it('skip', () => {});
  });
} else {
  describe('initSync (Vercel Edge path)', () => {
    it('compiles markdown via synchronous WASM init', async () => {
      const wasmBytes = readFileSync(wasmBinaryPath);
      const wasmModule = await WebAssembly.compile(wasmBytes);
      const glue = await import('../../wasm/xmdx_wasm.js');
      glue.initSync({ module: wasmModule });

      const result = glue.compile('# Hello', 'test.mdx', {});
      expect(result.code).toContain('Hello');
      expect(result.headings).toHaveLength(1);
      expect(result.headings[0].text).toBe('Hello');
    });

    it('handles frontmatter via initSync path', async () => {
      const wasmBytes = readFileSync(wasmBinaryPath);
      const wasmModule = await WebAssembly.compile(wasmBytes);
      const glue = await import('../../wasm/xmdx_wasm.js');
      glue.initSync({ module: wasmModule });

      const source = `---
title: Edge Test
---

# Content`;
      const result = glue.compile(source, 'edge.mdx', {});
      expect(result.code).toContain('createComponent');
      const frontmatter = JSON.parse(result.frontmatter_json);
      expect(frontmatter.title).toBe('Edge Test');
    });
  });
}
