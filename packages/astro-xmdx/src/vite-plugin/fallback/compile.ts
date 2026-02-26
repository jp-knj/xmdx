/**
 * JSX module generation utilities
 * @module vite-plugin/jsx-module
 */

import type { SourceMapInput } from 'rollup';
import type { Registry } from 'xmdx/registry';
import { transformJsx } from '../jsx-transform.js';
import { compile as compileMdx } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import { stripFrontmatter } from '../../utils/frontmatter.js';
import { loadXmdxBinding } from '../binding-loader.js';
import { rewriteFallbackDirectives, injectFallbackImports } from './directive-rewriter.js';
// ExpressiveCode imports kept for FallbackExpressiveCodeOptions type (for API compatibility)
import type { ExpressiveCodeConfig } from '../../utils/config.js';
import type { ExpressiveCodeManager } from '../highlighting/expressive-code-manager.js';
import { rehypeHeadingIds, extractAndStripCustomIds } from './rehype-heading-ids.js';
import { rehypeTasklistEnhancer } from './rehype-tasklist.js';

function findCustomIdInLastTextNode(node: HastNode): string | null {
  const children = Array.isArray(node.children) ? (node.children as HastNode[]) : null;
  if (!children || children.length === 0) return null;

  const lastChild = children[children.length - 1];
  if (isText(lastChild) && typeof lastChild.value === 'string') {
    return extractCustomId(lastChild.value).customId;
  }
  if (isElement(lastChild)) {
    const tag = lastChild.tagName;
    // Only recurse into inline formatting elements, not <code>, <img>, etc.
    if (tag === 'strong' || tag === 'em' || tag === 'a' || tag === 'del' || tag === 'b' || tag === 'i' || tag === 's') {
      return findCustomIdInLastTextNode(lastChild);
    }
  }
  return null;
}

function stripCustomIdFromLastTextNode(node: HastNode): void {
  const children = Array.isArray(node.children) ? (node.children as HastNode[]) : null;
  if (!children || children.length === 0) return;

  const lastChild = children[children.length - 1];
  if (isText(lastChild) && typeof lastChild.value === 'string') {
    lastChild.value = lastChild.value.replace(CUSTOM_ID_RE, '');
  } else if (isElement(lastChild)) {
    stripCustomIdFromLastTextNode(lastChild);
  }
}

function hasTaskListClass(node: HastNode): boolean {
  if (!isElement(node) || node.tagName !== 'li') return false;
  const className = node.properties?.className;
  if (Array.isArray(className)) {
    return className.some((c) => typeof c === 'string' && c === 'task-list-item');
  }
  return typeof className === 'string' && className.split(/\s+/).includes('task-list-item');
}

function isCheckboxInput(node: HastNode): boolean {
  if (!isElement(node) || node.tagName !== 'input') return false;
  const props = node.properties ?? {};
  const inputType = props.type;
  return inputType === 'checkbox';
}

function isWhitespaceText(node: HastNode): boolean {
  return isText(node) && (node.value ?? '').trim().length === 0;
}

function wrapTaskItemChildren(children: HastNode[]): HastNode[] {
  const firstMeaningfulIndex = children.findIndex((child) => !isWhitespaceText(child));
  if (firstMeaningfulIndex === -1) return children;

  const firstMeaningful = children[firstMeaningfulIndex];
  if (!firstMeaningful) return children;
  if (!isCheckboxInput(firstMeaningful)) return children;

  const prefix = children.slice(0, firstMeaningfulIndex);
  const tail = children.slice(firstMeaningfulIndex + 1);
  const span: HastElement = {
    type: 'element',
    tagName: 'span',
    properties: {},
    children: tail,
  };
  const label: HastElement = {
    type: 'element',
    tagName: 'label',
    properties: {},
    children: [firstMeaningful, span],
  };
  return [...prefix, label];
}

/**
 * Rehype plugin that normalizes GFM task list items to:
 * <li class="task-list-item"><label><input ... /><span>Text</span></label></li>
 * including loose-list (<p>) variants.
 */
export function rehypeTasklistEnhancer() {
  return (tree: HastNode) => {
    const visit = (node: HastNode): void => {
      if (hasTaskListClass(node) && Array.isArray(node.children)) {
        const children = node.children as HastNode[];
        const firstMeaningfulIndex = children.findIndex((child) => !isWhitespaceText(child));
        const firstMeaningful = firstMeaningfulIndex >= 0 ? children[firstMeaningfulIndex] : undefined;

        if (isElement(firstMeaningful) && firstMeaningful.tagName === 'p' && Array.isArray(firstMeaningful.children)) {
          firstMeaningful.children = wrapTaskItemChildren(firstMeaningful.children as HastNode[]);
        } else {
          node.children = wrapTaskItemChildren(children);
        }
      }

      const children = Array.isArray(node.children) ? (node.children as HastNode[]) : null;
      if (children) {
        for (const child of children) visit(child);
      }
    };

    visit(tree);
  };
}

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

  // Pre-extract {#custom-id} from headings to prevent MDX from
  // interpreting them as JSX expressions
  const { stripped: sourceForMdx, customIds } = extractAndStripCustomIds(sourceWithoutFrontmatter);

  // Collect headings during rehype traversal for getHeadings() export
  const collectedHeadings: Array<{ depth: number; slug: string; text: string }> = [];

  // Use @mdx-js/mdx to compile files that xmdx can't handle
  // (e.g., files with import/export statements)
  // Include remark-gfm for GFM features (tables, strikethrough, task lists)
  // and remark-directive to handle unconverted ::: directives gracefully
  const compiled = await compileMdx(sourceForMdx, {
    jsxImportSource: 'astro',
    remarkPlugins: [remarkGfm, remarkDirective],
    rehypePlugins: [rehypeTasklistEnhancer, () => rehypeHeadingIds(collectedHeadings, customIds)],
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
export function getHeadings() { return ${JSON.stringify(collectedHeadings)}; }
export const frontmatter = ${JSON.stringify(frontmatter)};
export default XmdxContent;
`;

  // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks
  // Code blocks are output as-is and Starlight's EC integration processes them at runtime
  const finalCode = wrappedCode;

  // Transform JSX to JS (uses OXC on Vite 8+, esbuild otherwise)
  const jsxResult = await transformJsx(finalCode, virtualId);

  return {
    code: jsxResult.code,
    map: jsxResult.map,
  };
}
