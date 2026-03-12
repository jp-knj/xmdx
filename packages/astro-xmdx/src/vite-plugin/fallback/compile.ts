/**
 * Fallback MDX compilation using @mdx-js/mdx.
 *
 * Used for files with patterns that xmdx-core can't handle (e.g., import/export
 * statements). Delegates directive rewriting, heading extraction, and task list
 * processing to the Rust NAPI binding instead of reimplementing them in TypeScript.
 *
 * @module vite-plugin/fallback/compile
 */

import type { SourceMapInput } from 'rollup';
import type { Registry } from 'xmdx/registry';
import { starlightLibrary } from 'xmdx/registry';
import { transformJsx, loadXmdxBinding } from '@xmdx/vite';
import type { XmdxBinding, ExpressiveCodeManager } from '@xmdx/vite';
import { compile as compileMdx } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import { stripFrontmatter } from 'xmdx/utils/frontmatter';
import { injectHeadingIds, repairHeadings } from '../mdx-wrapper/heading-id-injector.js';
import { collectImportedNames, insertAfterImports } from 'xmdx/utils/imports';
import type { ExpressiveCodeConfig } from 'xmdx/utils/config';

/**
 * Options for ExpressiveCode pre-rendering in fallback compilation.
 */
export interface FallbackExpressiveCodeOptions {
  config: ExpressiveCodeConfig;
  manager: ExpressiveCodeManager;
}

/**
 * Builds the directive configuration from the registry and Starlight settings.
 * Returns custom directive names and a component name mapping.
 */
function buildDirectiveConfig(
  registry: Registry | null,
  hasStarlightConfigured: boolean,
): {
  customNames: string[] | null;
  componentMap: Record<string, string> | null;
} {
  const registryDirectives = registry?.getSupportedDirectives().map((name) => name.toLowerCase()) ?? [];
  const useDefaultDirectives = registryDirectives.length === 0 && hasStarlightConfigured;

  if (registryDirectives.length === 0 && !useDefaultDirectives) {
    // No registry directives and no Starlight — use Rust defaults
    return { customNames: null, componentMap: null };
  }

  const customNames: string[] = [...registryDirectives];
  const componentMap: Record<string, string> = {};

  if (useDefaultDirectives) {
    const starlightDirectives = starlightLibrary.directiveMappings ?? [];
    for (const mapping of starlightDirectives) {
      const name = mapping.directive.toLowerCase();
      customNames.push(name);
      componentMap[name] = mapping.component;
    }
  } else {
    for (const name of registryDirectives) {
      const mapping = registry?.getDirectiveMapping(name);
      if (mapping) {
        componentMap[name] = mapping.component;
      }
    }
  }

  return {
    customNames: customNames.length > 0 ? customNames : null,
    componentMap: Object.keys(componentMap).length > 0 ? componentMap : null,
  };
}

/**
 * Strips fenced code blocks from source so tag scanning doesn't match
 * PascalCase identifiers inside code examples.
 */
function stripFencedCodeBlocks(source: string): string {
  return source.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?^\1\s*$/gm, '');
}

/**
 * Detects components used in the rewritten source and injects their import statements.
 * Scans for PascalCase JSX tags like `<Aside`, `<Callout`, etc., skipping code fences.
 */
function injectComponentImports(
  source: string,
  registry: Registry | null,
  hasStarlightConfigured: boolean,
): string {
  // Find PascalCase opening tags, ignoring fenced code blocks
  const sourceWithoutFences = stripFencedCodeBlocks(source);
  const componentPattern = /<([A-Z][A-Za-z0-9]*)\b/g;
  const usedComponents = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = componentPattern.exec(sourceWithoutFences)) !== null) {
    if (match[1]) usedComponents.add(match[1]);
  }

  if (usedComponents.size === 0) return source;

  const imported = collectImportedNames(source);
  const importLines: string[] = [];

  for (const componentName of usedComponents) {
    if (imported.has(componentName)) continue;

    const def = registry?.getComponent(componentName);
    if (def) {
      if (def.exportType === 'named') {
        importLines.push(`import { ${componentName} } from '${def.modulePath}';`);
      } else {
        const hasExtension = /\.(astro|[cm]?[jt]sx?|svelte|vue)$/.test(def.modulePath);
        const rawPath = hasExtension ? def.modulePath : `${def.modulePath}/${componentName}.astro`;
        const isAbsolute = rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath);
        const importPath = isAbsolute ? `/@fs/${rawPath.replace(/\\/g, '/')}` : rawPath;
        importLines.push(`import ${componentName} from '${importPath}';`);
      }
    } else if (componentName === 'Aside' && hasStarlightConfigured) {
      importLines.push(`import { Aside } from '@astrojs/starlight/components';`);
    }
  }

  if (importLines.length === 0) return source;
  return insertAfterImports(source, importLines.join('\n'));
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
  // Try to load the NAPI binding. If it fails, fall back to a minimal
  // compilation without directive rewriting, heading extraction, or
  // task list post-processing — the same resilience the old code had.
  let binding: XmdxBinding | null = null;
  try {
    binding = await loadXmdxBinding();
  } catch {
    // Binding unavailable — degrade gracefully below
  }

  // Extract frontmatter
  let frontmatter: Record<string, unknown> = {};
  if (binding) {
    try {
      const frontmatterResult = binding.parseFrontmatter(source);
      frontmatter = frontmatterResult.frontmatter || {};
    } catch {
      frontmatter = {};
    }
  }

  let processed = stripFrontmatter(source);
  let headings: Array<{ depth: number; slug: string; text: string }> = [];

  if (binding) {
    // Rewrite directives (:::note, :::tip, etc.) to JSX component tags
    const { customNames, componentMap } = buildDirectiveConfig(registry, hasStarlightConfigured);
    const directiveResult = binding.rewriteDirectives(processed, customNames, componentMap);
    if (directiveResult.directiveCount > 0) {
      processed = injectComponentImports(directiveResult.code, registry, hasStarlightConfigured);
    }

    // Extract headings and strip {#custom-id} syntax before MDX compilation
    headings = binding.extractHeadings(processed);
    processed = binding.stripCustomIds(processed);
  }

  // Compile with @mdx-js/mdx
  // - remark-gfm for GFM features (tables, strikethrough, task lists)
  // - remark-directive to handle unconverted ::: directives gracefully
  // No rehype plugins: heading IDs and task list enhancement are done post-compilation
  const compiled = await compileMdx(processed, {
    jsxImportSource: 'astro',
    remarkPlugins: [remarkGfm, remarkDirective],
  });

  let mdxCode = String(compiled);

  // Post-process task list items: wrap in <label>/<span> for accessibility
  if (binding) {
    mdxCode = binding.rewriteTaskListItems(mdxCode);
  }

  // Normalize MDX default export so we can wrap with Astro createComponent
  const mdxWithoutDefault = mdxCode
    .replace(/export default function MDXContent/g, 'function MDXContent')
    .replace(/export default MDXContent\s*;/g, '')
    .replace(/export\s*\{\s*MDXContent\s+as\s+default\s*\};?/g, '');

  // Inject heading IDs into the compiled JSX
  const repairedHeadings = repairHeadings(mdxWithoutDefault, headings);
  const mdxWithIds = injectHeadingIds(mdxWithoutDefault, repairedHeadings);

  // Wrap in Astro-compatible module format
  const wrappedCode = `
import { createComponent, renderJSX } from 'astro/runtime/server/index.js';
import { Fragment } from 'astro/jsx-runtime';
${mdxWithIds}

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
export function getHeadings() { return ${JSON.stringify(repairedHeadings)}; }
export const frontmatter = ${JSON.stringify(frontmatter)};
export default XmdxContent;
`;

  // Transform JSX to JS (uses OXC on Vite 8+, esbuild otherwise)
  const jsxResult = await transformJsx(wrappedCode, virtualId);

  return {
    code: jsxResult.code,
    map: jsxResult.map,
  };
}
