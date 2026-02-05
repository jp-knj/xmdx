/**
 * Node.js entry point for Xmdx.
 * Uses native NAPI bindings for maximum performance.
 * @module node
 */

import { createCompiler, type XmdxCompiler } from 'xmdx-napi';
import type { CompileOptions, CompileResult, HeadingEntry } from './types.js';

let compiler: XmdxCompiler | null = null;

/**
 * Compile MDX source to Astro-compatible module.
 *
 * @param source - MDX source code
 * @param options - Compile options
 * @returns Promise resolving to the compile result
 *
 * @example
 * ```typescript
 * import { compile } from 'xmdx';
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
  if (!compiler) {
    compiler = createCompiler({});
  }

  const result = compiler.compile(source, options.filepath ?? 'input.mdx', {
    file: options.filepath,
    url: options.url,
  });

  return {
    code: result.code,
    frontmatter: JSON.parse(result.frontmatterJson) as Record<string, unknown>,
    headings: result.headings as HeadingEntry[],
    hasUserDefaultExport: false, // TODO: expose from NAPI
  };
}

// Re-export types
export type { CompileOptions, CompileResult, HeadingEntry } from './types.js';
