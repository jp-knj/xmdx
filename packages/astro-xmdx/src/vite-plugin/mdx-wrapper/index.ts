/**
 * MDX wrapper module for Astro component integration.
 * Wraps mdxjs-rs compiled output in Astro-compatible component format.
 * @module vite-plugin/mdx-wrapper
 */

import type { Registry } from 'xmdx/registry';
import { detectUsedComponents } from './component-detection.js';
import { generateComponentImports } from './component-imports.js';
import { injectHeadingIds } from './heading-id-injector.js';
import { normalizeMdxExport } from './export-normalizer.js';

/**
 * Options for wrapping MDX module output.
 */
export interface WrapMdxOptions {
  /** Frontmatter extracted from the MDX file */
  frontmatter: Record<string, unknown>;
  /** Headings extracted from the MDX file */
  headings: Array<{ depth: number; slug: string; text: string }>;
  /** Component registry for import generation */
  registry: Registry;
}

/**
 * Wraps mdxjs-rs compiled JavaScript output in an Astro-compatible module.
 *
 * The mdxjs-rs output is a complete JavaScript module with an MDXContent function
 * that accepts a `components` prop for runtime component resolution. This wrapper:
 *
 * 1. Imports the compiled MDX content via a virtual module
 * 2. Generates imports for components used in the document
 * 3. Creates an Astro component that injects components at render time
 * 4. Exports frontmatter, getHeadings, and Content for Astro compatibility
 *
 * @param mdxCode - The compiled JavaScript code from mdxjs-rs
 * @param options - Wrapper options including frontmatter, headings, and registry
 * @param filename - The original MDX file path
 * @returns Astro-compatible module code
 *
 * @example
 * ```typescript
 * const wrappedModule = wrapMdxModule(compiledCode, {
 *   frontmatter: { title: 'Hello' },
 *   headings: [{ depth: 1, slug: 'hello', text: 'Hello' }],
 *   registry,
 * }, 'page.mdx');
 * ```
 */
export function wrapMdxModule(
  mdxCode: string,
  options: WrapMdxOptions,
  filename: string
): string {
  const { frontmatter, headings, registry } = options;
  const frontmatterJson = JSON.stringify(frontmatter);
  const headingsJson = JSON.stringify(headings);

  // Analyze the MDX code to find components that need to be injected
  const usedComponents = detectUsedComponents(mdxCode, registry);

  // Generate import statements for used components
  const componentImports = generateComponentImports(usedComponents, registry);

  // Generate the components object for injection
  // Always include Fragment for MDX compatibility
  const componentNames = usedComponents.map(c => c.name);
  const allComponents = ['Fragment', ...componentNames];
  const componentsObject = `{ ${allComponents.join(', ')}, ...(props?.components ?? {}) }`;

  // The mdxjs-rs output needs to be normalized to work with our wrapper.
  // It exports `default` as the MDXContent function.
  // We need to handle both:
  // 1. Direct function: `export default function MDXContent(props) { ... }`
  // 2. Function reference: `function _createMdxContent(props) { ... } export default _createMdxContent;`
  const normalizedMdxCode = normalizeMdxExport(mdxCode);
  const mdxWithIds = injectHeadingIds(normalizedMdxCode, headings);

  return `import { createComponent, renderJSX } from 'astro/runtime/server/index.js';
import { Fragment } from 'astro/jsx-runtime';
${componentImports}

// MDX compiled content
${mdxWithIds}

// Astro exports
export const frontmatter = ${frontmatterJson};
export function getHeadings() { return ${headingsJson}; }
export const file = ${JSON.stringify(filename)};
export const url = undefined;

// Wrap MDXContent in Astro component with component injection
const XmdxContent = createComponent(
  (result, props, _slots) =>
    renderJSX(
      result,
      MDXContent({
        ...(props ?? {}),
        components: ${componentsObject},
      })
    ),
  ${JSON.stringify(filename)}
);

export const Content = XmdxContent;
export default XmdxContent;
`;
}
