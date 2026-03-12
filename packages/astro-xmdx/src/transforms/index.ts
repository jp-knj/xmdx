/**
 * Context-aware transform wrappers for pipeline composition
 * @module transforms
 */

import {
  rewriteExpressiveCodeBlocks,
  rewriteSetHtmlCodeBlocks,
  rewriteJsStringCodeBlocks,
  injectExpressiveCodeComponent,
} from './expressive-code.js';
import {
  injectComponentImportsFromRegistry,
} from './inject-components.js';
import { rewriteAstroSetHtml, highlightJsStringCodeBlocks, highlightJsxCodeBlocks } from './shiki.js';
import type { TransformContext } from '../types.js';

/**
 * Quick check for code block markers to short-circuit expensive transforms.
 * Files without these markers can skip Shiki highlighting entirely.
 */
function hasCodeBlockMarkers(code: string): boolean {
  return code.includes('<pre') || code.includes('<code');
}

/**
 * Transform that rewrites <pre><code> blocks to ExpressiveCode components.
 * Also handles code blocks inside set:html JSON strings (component slots).
 * Also handles code blocks in JS string literals from mdxjs-rs.
 * Only runs if expressiveCode is configured.
 */
export function transformExpressiveCode(ctx: TransformContext): TransformContext {
  if (!ctx.config.expressiveCode || ctx.config.expressiveCodeCanRewrite === false || !ctx.code) {
    return ctx;
  }

  // PERF: Early-exit if no code block markers present
  // This avoids 3 regex passes on files without code blocks
  if (!hasCodeBlockMarkers(ctx.code)) {
    return ctx;
  }

  const componentName = ctx.config.expressiveCode.component;

  // First, rewrite code blocks inside set:html JSON strings (must run before
  // other patterns to avoid matching <pre> inside JSON strings and corrupting
  // the set:html wrapper)
  let { code, changed } = rewriteSetHtmlCodeBlocks(ctx.code, componentName);

  // Second, rewrite code blocks in JS string literals (from mdxjs-rs)
  // This handles: "<pre class=\"astro-code\" ...>...</pre>"
  // Runs after set:html handling so it doesn't interfere with those contexts
  const jsStringResult = rewriteJsStringCodeBlocks(code, componentName);
  code = jsStringResult.code;
  changed = changed || jsStringResult.changed;

  // Then, rewrite any remaining loose <pre><code> blocks
  const looseResult = rewriteExpressiveCodeBlocks(code, componentName);
  code = looseResult.code;
  changed = changed || looseResult.changed;

  // Inject the ExpressiveCode component import when code blocks were rewritten
  if (changed) {
    code = injectExpressiveCodeComponent(code, ctx.config.expressiveCode);
  }

  return { ...ctx, code };
}

/**
 * Transform that applies Shiki syntax highlighting.
 * Only runs if shiki highlighter is available.
 *
 * Handles two patterns:
 * 1. Code blocks in set:html fragments: <_Fragment set:html={...} />
 * 2. Code blocks in direct JSX: <pre><code> elements
 *
 * Handles three patterns in fallback mode:
 * 1. Code blocks in set:html fragments
 * 2. mdxjs-rs code fences emitted as JS string literals
 * 3. Direct JSX <pre><code> elements
 *
 * Skips when ExpressiveCode is configured and canRewrite is true,
 * since EC already converts these patterns itself.
 */
export async function transformShikiHighlight(
  ctx: TransformContext
): Promise<TransformContext> {
  if (!ctx.config.shiki || !ctx.code) {
    return ctx;
  }

  // Skip Shiki when ExpressiveCode has already rewritten all code blocks
  // (EC handles set:html, JS strings, and loose blocks)
  if (ctx.config.expressiveCode && ctx.config.expressiveCodeCanRewrite !== false) {
    return ctx;
  }

  // Short-circuit: skip expensive transforms if no code blocks present
  if (!hasCodeBlockMarkers(ctx.code)) {
    return ctx;
  }

  // Three-pass highlighting: set:html fragments, mdxjs-rs string literals,
  // then direct JSX code blocks.
  let code = await rewriteAstroSetHtml(ctx.code, ctx.config.shiki);
  code = await highlightJsStringCodeBlocks(code, ctx.config.shiki);
  code = await highlightJsxCodeBlocks(code, ctx.config.shiki);
  return { ...ctx, code };
}

/**
 * Transform that injects component imports from the registry.
 * Unified replacement for transformInjectAstroComponents and transformInjectStarlightComponents.
 * Uses the registry from context to find all component modules and inject missing imports.
 */
export function transformInjectComponentsFromRegistry(ctx: TransformContext): TransformContext {
  if (!ctx.code || !ctx.registry) {
    return ctx;
  }
  return {
    ...ctx,
    code: injectComponentImportsFromRegistry(ctx.code, ctx.registry),
  };
}

// Re-export from sub-modules
export {
  rewriteExpressiveCodeBlocks,
  rewriteSetHtmlCodeBlocks,
  rewriteJsStringCodeBlocks,
  injectExpressiveCodeComponent,
  stripExpressiveCodeImport,
} from './expressive-code.js';
export {
  injectAstroComponents,
  injectStarlightComponents,
  injectComponentImports,
  injectComponentImportsFromRegistry,
} from './inject-components.js';
export { rewriteAstroSetHtml, highlightHtmlBlocks, highlightJsStringCodeBlocks, highlightJsxCodeBlocks } from './shiki.js';
export { blocksToJsx } from './blocks-to-jsx.js';
