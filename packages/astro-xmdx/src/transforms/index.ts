/**
 * Context-aware transform wrappers for pipeline composition
 * @module transforms
 */

import {
  rewriteExpressiveCodeBlocks,
  rewriteSetHtmlCodeBlocks,
  injectExpressiveCodeComponent,
} from './expressive-code.js';
import {
  injectAstroComponents,
  injectStarlightComponents,
  injectComponentImportsFromRegistry,
} from './inject-components.js';
import { rewriteAstroSetHtml, highlightJsxCodeBlocks } from './shiki.js';
import type { TransformContext } from '../types.js';

/**
 * Transform that rewrites <pre><code> blocks to ExpressiveCode components.
 * Also handles code blocks inside set:html JSON strings (component slots).
 * Only runs if expressiveCode is configured.
 */
export function transformExpressiveCode(ctx: TransformContext): TransformContext {
  if (!ctx.config.expressiveCode || !ctx.code) {
    return ctx;
  }

  const componentName = ctx.config.expressiveCode.component;

  // First, rewrite code blocks inside set:html JSON strings (must run before
  // the loose pattern, which would otherwise match <pre> inside JSON strings
  // and corrupt the set:html wrapper)
  let { code, changed } = rewriteSetHtmlCodeBlocks(ctx.code, componentName);

  // Then, rewrite any remaining loose <pre><code> blocks
  const looseResult = rewriteExpressiveCodeBlocks(code, componentName);
  code = looseResult.code;
  changed = changed || looseResult.changed;

  if (changed) {
    return {
      ...ctx,
      code: injectExpressiveCodeComponent(code, ctx.config.expressiveCode),
    };
  }
  return { ...ctx, code };
}

/**
 * Transform that applies Shiki syntax highlighting.
 * Only runs if shiki highlighter is available.
 *
 * Processes code blocks in two passes:
 * 1. rewriteAstroSetHtml: Handles code in <_Fragment set:html={...} /> patterns
 * 2. highlightJsxCodeBlocks: Handles code in direct JSX <pre><code> elements
 *    (when slot content with components bypasses set:html)
 */
export async function transformShikiHighlight(
  ctx: TransformContext
): Promise<TransformContext> {
  if (!ctx.config.shiki || !ctx.code) {
    return ctx;
  }
  // First pass: highlight code blocks in set:html fragments
  let code = await rewriteAstroSetHtml(ctx.code, ctx.config.shiki);
  // Second pass: highlight code blocks in direct JSX (mixed slots with components)
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
  injectExpressiveCodeComponent,
} from './expressive-code.js';
export {
  injectAstroComponents,
  injectStarlightComponents,
  injectComponentImports,
  injectComponentImportsFromRegistry,
} from './inject-components.js';
export { rewriteAstroSetHtml, highlightHtmlBlocks, highlightJsxCodeBlocks } from './shiki.js';
export { blocksToJsx } from './blocks-to-jsx.js';
