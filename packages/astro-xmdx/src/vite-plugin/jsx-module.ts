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

/**
 * Options for wrapping HTML in a JSX module.
 */
export interface WrapHtmlOptions {
  /** User-defined exports from the MDX file (non-default) */
  hoistedExports?: Array<{ source: string; isDefault: boolean }>;
  /** Whether the user provided their own export default statement */
  hasUserDefaultExport?: boolean;
}

/**
 * Wraps raw HTML in an Astro-compatible JSX module.
 * Used for fast path compilation without MDX processing.
 */
export function wrapHtmlInJsxModule(
  html: string,
  frontmatter: Record<string, unknown>,
  headings: Array<{ depth: number; slug: string; text: string }>,
  filename: string,
  options?: WrapHtmlOptions
): string {
  const useRenderTemplate =
    typeof process !== 'undefined' && process.env?.XMDX_RENDER_TEMPLATE === '1';
  const enableRenderProfile =
    typeof process !== 'undefined' && process.env?.XMDX_RENDER_PROFILE === '1';
  const frontmatterJson = JSON.stringify(frontmatter);
  const headingsJson = JSON.stringify(headings);

  // Inject user-defined exports (filter out default exports as they need special handling)
  const nonDefaultExports = (options?.hoistedExports ?? [])
    .filter(e => !e.isDefault)
    .map(e => e.source)
    .join('\n');

  // Generate default export line unless user has their own
  const defaultExportLine = options?.hasUserDefaultExport
    ? '' // User's default export is in hoistedExports
    : 'export default XmdxContent;';

  // If user has default export, include it in the module
  const userDefaultExport = (options?.hoistedExports ?? [])
    .filter(e => e.isDefault)
    .map(e => e.source)
    .join('\n');

  if (useRenderTemplate && enableRenderProfile) {
    return `import { createComponent, renderTemplate } from 'astro/runtime/server/index.js';

${nonDefaultExports}

export const frontmatter = ${frontmatterJson};
export function getHeadings() { return ${headingsJson}; }
const __xmdxHtml = ${JSON.stringify(html)};
const __xmdxId = ${JSON.stringify(filename)};
  const __xmdxProfile = (() => {
    const key = '__xmdxRenderProfile';
    const g = globalThis;
    const existing = g[key];
    if (existing) return existing;
    const profile = {
      totals: new Map(),
      counts: new Map(),
      hooked: false,
      dumped: false,
      top: Number(
        (typeof process !== 'undefined' && process.env?.XMDX_RENDER_PROFILE_TOP)
          ? process.env.XMDX_RENDER_PROFILE_TOP
          : '20'
      ),
    };
    g[key] = profile;
    if (typeof process !== 'undefined' && typeof process.on === 'function' && !profile.hooked) {
      profile.hooked = true;
      const dump = () => {
        if (profile.dumped) return;
        profile.dumped = true;
        const entries = Array.from(profile.totals.entries()).map(([id, total]) => {
          const count = profile.counts.get(id) ?? 0;
          return { id, total, count, avg: count > 0 ? total / count : 0 };
        });
        entries.sort((a, b) => b.total - a.total);
        const top = entries.slice(0, profile.top);
        const total = entries.reduce((acc, entry) => acc + entry.total, 0);
        console.log(\`[xmdx-render-profiler] total=\${total.toFixed(2)}ms pages=\${entries.length}\`);
        for (const entry of top) {
          console.log(
            \`[xmdx-render-profiler] \${entry.id} total=\${entry.total.toFixed(2)}ms avg=\${entry.avg.toFixed(2)}ms n=\${entry.count}\`
          );
        }
      };
      process.on('beforeExit', dump);
      process.on('exit', dump);
    }
    return profile;
  })();
const __xmdxTotals = __xmdxProfile.totals;
const __xmdxCounts = __xmdxProfile.counts;
const __xmdxNow = () =>
  globalThis.performance && typeof globalThis.performance.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
const XmdxContent = createComponent(
  (_result, _props, _slots) => {
    const __xmdxStart = __xmdxNow();
    const __xmdxOut = renderTemplate([__xmdxHtml]);
    const __xmdxDuration = __xmdxNow() - __xmdxStart;
    __xmdxTotals.set(__xmdxId, (__xmdxTotals.get(__xmdxId) ?? 0) + __xmdxDuration);
    __xmdxCounts.set(__xmdxId, (__xmdxCounts.get(__xmdxId) ?? 0) + 1);
    return __xmdxOut;
  },
  ${JSON.stringify(filename)}
);
export const Content = XmdxContent;
${userDefaultExport}
${defaultExportLine}
`;
  }

  if (useRenderTemplate) {
    return `import { createComponent, renderTemplate } from 'astro/runtime/server/index.js';

${nonDefaultExports}

export const frontmatter = ${frontmatterJson};
export function getHeadings() { return ${headingsJson}; }
const __xmdxHtml = ${JSON.stringify(html)};
const XmdxContent = createComponent(
  (_result, _props, _slots) => renderTemplate([__xmdxHtml]),
  ${JSON.stringify(filename)}
);
export const Content = XmdxContent;
${userDefaultExport}
${defaultExportLine}
`;
  }

  if (enableRenderProfile) {
    return `import { createComponent, renderJSX } from 'astro/runtime/server/index.js';
import { Fragment as _Fragment, jsx as _jsx } from 'astro/jsx-runtime';

${nonDefaultExports}

export const frontmatter = ${frontmatterJson};
export function getHeadings() { return ${headingsJson}; }
const __xmdxHtml = ${JSON.stringify(html)};
const __xmdxId = ${JSON.stringify(filename)};
  const __xmdxProfile = (() => {
    const key = '__xmdxRenderProfile';
    const g = globalThis;
    const existing = g[key];
    if (existing) return existing;
    const profile = {
      totals: new Map(),
      counts: new Map(),
      hooked: false,
      dumped: false,
      top: Number(
        (typeof process !== 'undefined' && process.env?.XMDX_RENDER_PROFILE_TOP)
          ? process.env.XMDX_RENDER_PROFILE_TOP
          : '20'
      ),
    };
    g[key] = profile;
    if (typeof process !== 'undefined' && typeof process.on === 'function' && !profile.hooked) {
      profile.hooked = true;
      const dump = () => {
        if (profile.dumped) return;
        profile.dumped = true;
        const entries = Array.from(profile.totals.entries()).map(([id, total]) => {
          const count = profile.counts.get(id) ?? 0;
          return { id, total, count, avg: count > 0 ? total / count : 0 };
        });
        entries.sort((a, b) => b.total - a.total);
        const top = entries.slice(0, profile.top);
        const total = entries.reduce((acc, entry) => acc + entry.total, 0);
        console.log(\`[xmdx-render-profiler] total=\${total.toFixed(2)}ms pages=\${entries.length}\`);
        for (const entry of top) {
          console.log(
            \`[xmdx-render-profiler] \${entry.id} total=\${entry.total.toFixed(2)}ms avg=\${entry.avg.toFixed(2)}ms n=\${entry.count}\`
          );
        }
      };
      process.on('beforeExit', dump);
      process.on('exit', dump);
    }
    return profile;
  })();
const __xmdxTotals = __xmdxProfile.totals;
const __xmdxCounts = __xmdxProfile.counts;
const __xmdxNow = () =>
  globalThis.performance && typeof globalThis.performance.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
function _Content() {
  return (
    <_Fragment set:html={__xmdxHtml} />
  );
}
const XmdxContent = createComponent(
  (result, props, _slots) => {
    const __xmdxStart = __xmdxNow();
    const __xmdxOut = renderJSX(result, _jsx(_Content, { ...props }));
    const __xmdxDuration = __xmdxNow() - __xmdxStart;
    __xmdxTotals.set(__xmdxId, (__xmdxTotals.get(__xmdxId) ?? 0) + __xmdxDuration);
    __xmdxCounts.set(__xmdxId, (__xmdxCounts.get(__xmdxId) ?? 0) + 1);
    return __xmdxOut;
  },
  ${JSON.stringify(filename)}
);
export const Content = XmdxContent;
${userDefaultExport}
${defaultExportLine}
`;
  }

  return `import { createComponent, renderJSX } from 'astro/runtime/server/index.js';
import { Fragment as _Fragment, jsx as _jsx } from 'astro/jsx-runtime';

${nonDefaultExports}

export const frontmatter = ${frontmatterJson};
export function getHeadings() { return ${headingsJson}; }
function _Content() {
  return (
    <_Fragment set:html={${JSON.stringify(html)}} />
  );
}
const XmdxContent = createComponent(
  (result, props, _slots) => renderJSX(result, _jsx(_Content, { ...props })),
  ${JSON.stringify(filename)}
);
export const Content = XmdxContent;
${userDefaultExport}
${defaultExportLine}
`;
}

/**
 * Compiles a fallback module using @mdx-js/mdx.
 * Used for files with patterns that xmdx-core can't handle.
 */
export async function compileFallbackModule(
  filename: string,
  source: string,
  virtualId: string,
  registry: Registry | null,
  hasStarlightConfigured: boolean
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

  // Transform JSX through esbuild (same as the main compilation path)
  const esbuildResult = await transformWithEsbuild(wrappedCode, virtualId, ESBUILD_JSX_CONFIG);

  return {
    code: esbuildResult.code,
    map: esbuildResult.map as SourceMapInput | undefined,
  };
}
