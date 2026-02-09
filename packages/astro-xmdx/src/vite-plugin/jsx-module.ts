/**
 * JSX module generation utilities
 * @module vite-plugin/jsx-module
 */

import type { SourceMapInput } from 'rollup';
import type { Registry } from 'xmdx/registry';
import { transformWithEsbuild } from 'vite';
import { compile as compileMdx } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import { ESBUILD_JSX_CONFIG } from '../constants.js';
import { stripFrontmatter } from '../utils/frontmatter.js';
import { loadXmdxBinding } from './binding-loader.js';
import { rewriteFallbackDirectives, injectFallbackImports } from './directive-rewriter.js';
// ExpressiveCode imports kept for FallbackExpressiveCodeOptions type (for API compatibility)
import type { ExpressiveCodeConfig } from '../utils/config.js';
import type { ExpressiveCodeManager } from './expressive-code-manager.js';

/**
 * Options for ExpressiveCode pre-rendering in fallback compilation.
 */
export interface FallbackExpressiveCodeOptions {
  config: ExpressiveCodeConfig;
  manager: ExpressiveCodeManager;
}

/**
 * Compiles a fallback module using @mdx-js/mdx.
 * Used for files with patterns that xmdx-core can't handle.
 *
 * Note: ExpressiveCode pre-rendering is disabled. Code blocks are output as-is
 * and Starlight's ExpressiveCode integration handles them at runtime.
 */
export async function compileFallbackModule(
  filename: string,
  source: string,
  virtualId: string,
  registry: Registry | null,
  hasStarlightConfigured: boolean,
  _expressiveCodeOptions?: FallbackExpressiveCodeOptions // Unused - EC disabled
): Promise<{ code: string; map?: SourceMapInput }> {
  let frontmatter: Record<string, unknown> = {};
  try {
    const binding = await loadXmdxBinding();
    const frontmatterResult = binding.parseFrontmatter(source);
    frontmatter = frontmatterResult.frontmatter || {};
  } catch {
    frontmatter = {};
  }

  let sourceWithoutFrontmatter = stripFrontmatter(source);
  const directiveResult = rewriteFallbackDirectives(sourceWithoutFrontmatter, registry, hasStarlightConfigured);
  if (directiveResult.changed) {
    sourceWithoutFrontmatter = injectFallbackImports(
      directiveResult.code,
      directiveResult.usedComponents,
      registry,
      hasStarlightConfigured
    );
  }
  // Use @mdx-js/mdx to compile files that xmdx can't handle
  // (e.g., files with import/export statements)
  // Include remark-gfm for GFM features (tables, strikethrough, task lists)
  // and remark-directive to handle unconverted ::: directives gracefully
  const compiled = await compileMdx(sourceWithoutFrontmatter, {
    jsxImportSource: 'astro',
    remarkPlugins: [remarkGfm, remarkDirective],
    // Don't use providerImportSource as it requires @mdx-js/react
    // which may not be installed
  });

  // The compiled output is a VFile, get the string value
  const mdxCode = String(compiled);

  // Normalize MDX default export so we can wrap with Astro createComponent
  const mdxWithoutDefault = mdxCode
    .replace(/export default function MDXContent/g, 'function MDXContent')
    .replace(/export default MDXContent\s*;/g, '')
    .replace(/export\s*\{\s*MDXContent\s+as\s+default\s*\};?/g, '');

  // Wrap in Astro-compatible module format
  // @mdx-js/mdx outputs ESM with `export default function MDXContent(...)`
  // We need to add Content, frontmatter and getHeadings exports for Astro compatibility
  // Note: MDXContent is the default export function from @mdx-js/mdx
  const wrappedCode = `
import { createComponent, renderJSX } from 'astro/runtime/server/index.js';
import { Fragment } from 'astro/jsx-runtime';
${mdxWithoutDefault}

// Re-export for Astro compatibility
// Wrap MDXContent so it renders as an Astro component factory
const XmdxContent = createComponent(
  (result, props, _slots) =>
    renderJSX(
      result,
      MDXContent({
        ...(props ?? {}),
        // Ensure Astro's Fragment is available for <Fragment slot="..."> usage in MDX.
        components: { ...(props?.components ?? {}), Fragment },
      })
    ),
  ${JSON.stringify(filename)}
);
export { MDXContent };
export const Content = XmdxContent;
export const file = ${JSON.stringify(filename)};
export const url = undefined;
export function getHeadings() { return []; }
export const frontmatter = ${JSON.stringify(frontmatter)};
export default XmdxContent;
`;

  // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks
  // Code blocks are output as-is and Starlight's EC integration processes them at runtime
  const finalCode = wrappedCode;

  // Transform JSX through esbuild (same as the main compilation path)
  const esbuildResult = await transformWithEsbuild(finalCode, virtualId, ESBUILD_JSX_CONFIG);

  return {
    code: esbuildResult.code,
    map: esbuildResult.map as SourceMapInput | undefined,
  };
}
