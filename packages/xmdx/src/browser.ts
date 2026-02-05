/**
 * Browser entry point for Xmdx.
 * Uses WASM for browser/edge runtime compatibility.
 * @module browser
 */

import type { CompileOptions, CompileResult, HeadingEntry } from './types.js';

interface WasmModule {
  default: () => Promise<unknown>;
  compile: (source: string, filepath: string) => {
    code: string;
    frontmatter_json: string;
    headings: HeadingEntry[];
    has_user_default_export: boolean;
  };
}

let wasmModule: WasmModule | null = null;
let initialized = false;

async function loadWasm(): Promise<WasmModule> {
  if (!wasmModule) {
    wasmModule = await import('../wasm/xmdx_wasm.js') as WasmModule;
  }
  if (!initialized) {
    // Initialize WASM module
    await wasmModule.default();
    initialized = true;
  }
  return wasmModule;
}

/**
 * Compile MDX source to Astro-compatible module.
 *
 * @param source - MDX source code
 * @param options - Compile options
 * @returns Promise resolving to the compile result
 *
 * @example
 * ```typescript
 * import { compile } from 'xmdx/browser';
 *
 * const result = await compile(`---
 * title: Hello
 * ---
 *
 * # Welcome
 *
 * This is **bold** text.
 * `, { filepath: 'page.mdx' });
 *
 * console.log(result.code);
 * console.log(result.headings);
 * console.log(result.frontmatter);
 * ```
 */
export async function compile(
  source: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const wasm = await loadWasm();
  const result = wasm.compile(source, options.filepath ?? 'input.mdx');

  return {
    code: result.code,
    frontmatter: JSON.parse(result.frontmatter_json) as Record<string, unknown>,
    headings: result.headings,
    hasUserDefaultExport: result.has_user_default_export,
  };
}

// Re-export types
export type { CompileOptions, CompileResult, HeadingEntry } from './types.js';
