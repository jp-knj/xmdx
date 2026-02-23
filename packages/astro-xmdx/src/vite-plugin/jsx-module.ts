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

type HastNode = {
  type: string;
  [key: string]: unknown;
};

type HastElement = HastNode & {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

type HastText = HastNode & {
  type: 'text';
  value?: string;
};

function isElement(node: HastNode | undefined): node is HastElement {
  return node?.type === 'element' && typeof node.tagName === 'string';
}

function isText(node: HastNode | undefined): node is HastText {
  return node?.type === 'text';
}

function extractText(node: HastNode): string {
  if (isText(node)) {
    return typeof node.value === 'string' ? node.value : '';
  }
  if (!isElement(node) || !Array.isArray(node.children)) {
    return '';
  }
  return node.children.map(extractText).join('');
}

export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
  return slug || 'heading';
}

const CUSTOM_ID_RE = /\s*\{#([a-zA-Z0-9_-]+)\}\s*$/;

export function extractCustomId(text: string): { text: string; customId: string | null } {
  const match = CUSTOM_ID_RE.exec(text);
  if (match) {
    const customId = match[1];
    if (customId !== undefined) {
      return { text: text.slice(0, match.index), customId };
    }
  }
  return { text, customId: null };
}

export function rehypeHeadingIds(
  collectedHeadings?: Array<{ depth: number; slug: string; text: string }>
) {
  return (tree: HastNode) => {
    const usedSlugs = new Map<string, number>();

    const assignHeadingId = (node: HastNode) => {
      if (isElement(node) && /^h[1-6]$/.test(node.tagName)) {
        const properties = (node.properties ??= {});
        const existingId = properties.id;
        const depth = Number.parseInt(node.tagName.slice(1), 10);

        // Extract {#custom-id} from the last text node (not from <code> elements)
        const rawText = extractText(node);
        const customId = findCustomIdInLastTextNode(node);
        const cleanText = customId
          ? extractCustomId(rawText).text
          : rawText;

        if (customId) {
          // Strip {#...} from the last text node in the rendered output
          stripCustomIdFromLastTextNode(node);
          properties.id = customId;
          usedSlugs.set(customId, (usedSlugs.get(customId) ?? 0) + 1);
          if (collectedHeadings) {
            collectedHeadings.push({ depth, slug: customId, text: cleanText });
          }
        } else if (typeof existingId !== 'string' || existingId.length === 0) {
          const baseSlug = slugifyHeading(cleanText);
          const count = usedSlugs.get(baseSlug) ?? 0;
          const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
          usedSlugs.set(baseSlug, count + 1);
          properties.id = slug;
          if (collectedHeadings) {
            collectedHeadings.push({ depth, slug, text: cleanText });
          }
        } else {
          const count = usedSlugs.get(existingId) ?? 0;
          usedSlugs.set(existingId, count + 1);
          if (collectedHeadings) {
            collectedHeadings.push({ depth, slug: existingId, text: cleanText });
          }
        }
      }

      const children = Array.isArray(node.children) ? (node.children as HastNode[]) : null;
      if (children) {
        for (const child of children) {
          assignHeadingId(child);
        }
      }
    };

    assignHeadingId(tree);
  };
}

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
  // Collect headings during rehype traversal for getHeadings() export
  const collectedHeadings: Array<{ depth: number; slug: string; text: string }> = [];

  // Use @mdx-js/mdx to compile files that xmdx can't handle
  // (e.g., files with import/export statements)
  // Include remark-gfm for GFM features (tables, strikethrough, task lists)
  // and remark-directive to handle unconverted ::: directives gracefully
  const compiled = await compileMdx(sourceWithoutFrontmatter, {
    jsxImportSource: 'astro',
    remarkPlugins: [remarkGfm, remarkDirective],
    rehypePlugins: [rehypeTasklistEnhancer, () => rehypeHeadingIds(collectedHeadings)],
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

  // Transform JSX through esbuild (same as the main compilation path)
  const esbuildResult = await transformWithEsbuild(finalCode, virtualId, ESBUILD_JSX_CONFIG);

  return {
    code: esbuildResult.code,
    map: esbuildResult.map as SourceMapInput | undefined,
  };
}
