/**
 * MDX wrapper module for Astro component integration.
 * Wraps mdxjs-rs compiled output in Astro-compatible component format.
 * @module vite-plugin/mdx-wrapper
 */

import type { Registry } from 'xmdx/registry';

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

  return `import { createComponent, renderJSX } from 'astro/runtime/server/index.js';
import { Fragment } from 'astro/jsx-runtime';
${componentImports}

// MDX compiled content
${normalizedMdxCode}

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

/**
 * Component usage information.
 */
interface UsedComponent {
  name: string;
  modulePath: string;
  exportType: 'named' | 'default';
}

/**
 * Extracts already-imported component names from the mdxjs-rs output.
 * This prevents duplicate imports when we add our component injections.
 *
 * Only scans top-level import statements by processing lines at the start
 * of the file, stopping when we hit actual code (function definitions, etc.).
 * This avoids matching import statements inside code strings/samples.
 */
function extractExistingImports(code: string): Set<string> {
  const imported = new Set<string>();
  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments at the top
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Stop scanning when we hit non-import code
    if (!trimmed.startsWith('import ') && !trimmed.startsWith('import{')) {
      break;
    }

    // Process this import line
    const importPattern = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/;
    const match = importPattern.exec(trimmed);
    if (!match) continue;

    if (/^import\s+type\s/.test(trimmed)) {
      continue;
    }

    let clause = match[1]?.trim() ?? '';
    if (clause.startsWith('type ')) {
      clause = clause.slice('type '.length).trim();
    }

    // Default import: import Foo from 'module' or import Foo, { Bar } from 'module'
    const defaultMatch = clause.match(/^([A-Za-z$_][\w$]*)\s*(?:,|$)/);
    if (defaultMatch?.[1]) {
      imported.add(defaultMatch[1]);
    }

    // Namespace import: import * as Foo from 'module'
    const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z$_][\w$]*)/);
    if (namespaceMatch?.[1]) {
      imported.add(namespaceMatch[1]);
    }

    // Named imports: import { Foo, Bar as Baz } from 'module'
    // Also handles: import Default, { Foo, Bar } from 'module'
    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch?.[1]) {
      const parts = namedMatch[1].split(',');
      for (const part of parts) {
        const item = part.trim();
        if (!item) continue;
        const withoutType = item.replace(/^type\s+/, '');
        const segments = withoutType.split(/\s+as\s+/);
        const name = segments[1] ?? segments[0];
        if (name) {
          imported.add(name.trim());
        }
      }
    }
  }

  return imported;
}

/**
 * Extracts locally declared component names from the MDX module.
 * This prevents injecting registry imports that would conflict with local declarations.
 *
 * Matches patterns like:
 * - const Name = ...
 * - let Name = ...
 * - function Name(...
 * - class Name ...
 * - export const Name = ...
 * - export function Name(...
 * - export class Name ...
 *
 * Only matches PascalCase names (starting with uppercase) since those are component names.
 */
function extractLocalDeclarations(code: string): Set<string> {
  const declarations = new Set<string>();

  // Match: const/let/var NAME, function NAME, class NAME
  // Also match export variants
  const patterns = [
    /(?:export\s+)?(?:const|let|var)\s+([A-Z][a-zA-Z0-9]*)\s*=/g,
    /(?:export\s+)?function\s+([A-Z][a-zA-Z0-9]*)\s*\(/g,
    /(?:export\s+)?class\s+([A-Z][a-zA-Z0-9]*)\s*[{<]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      if (match[1]) declarations.add(match[1]);
    }
  }

  return declarations;
}

/**
 * Detects which components from the registry are used in the MDX code.
 * Looks for PascalCase JSX tags in the compiled output.
 * Excludes components that are already imported or locally declared in the mdxjs-rs output.
 */
function detectUsedComponents(code: string, registry: Registry): UsedComponent[] {
  const usedComponents: UsedComponent[] = [];
  const seenNames = new Set<string>();

  // Get components already imported in the mdxjs-rs output
  const existingImports = extractExistingImports(code);
  // Get locally declared components (const Foo = ..., function Foo, etc.)
  const localDeclarations = extractLocalDeclarations(code);

  // Match potential component references in JSX
  // This includes both direct usage like <Tabs> and indirect like jsx(Tabs, ...)
  const componentPattern = /\b([A-Z][a-zA-Z0-9]*)\b/g;
  let match;

  while ((match = componentPattern.exec(code)) !== null) {
    const name = match[1]!;

    // Skip common JSX/React internals and already seen components
    if (seenNames.has(name)) continue;
    if (['Fragment', 'Component', 'MDXContent', 'React', 'Props'].includes(name)) continue;

    // Skip if already imported or locally declared in the mdxjs-rs output
    if (existingImports.has(name) || localDeclarations.has(name)) continue;

    // Check if this component is in the registry
    const definition = registry.getComponent(name);
    if (definition) {
      seenNames.add(name);
      usedComponents.push({
        name: definition.name,
        modulePath: definition.modulePath,
        exportType: definition.exportType as 'named' | 'default',
      });
    }
  }

  return usedComponents;
}

/**
 * Generates import statements for the used components.
 */
function generateComponentImports(components: UsedComponent[], registry: Registry): string {
  // Group components by module path for cleaner imports
  const byModule = new Map<string, UsedComponent[]>();

  for (const component of components) {
    const existing = byModule.get(component.modulePath) ?? [];
    existing.push(component);
    byModule.set(component.modulePath, existing);
  }

  const imports: string[] = [];

  for (const [modulePath, moduleComponents] of byModule) {
    const namedImports = moduleComponents
      .filter(c => c.exportType === 'named')
      .map(c => c.name);

    const defaultImport = moduleComponents.find(c => c.exportType === 'default');

    if (defaultImport && namedImports.length > 0) {
      imports.push(`import ${defaultImport.name}, { ${namedImports.join(', ')} } from '${modulePath}';`);
    } else if (defaultImport) {
      imports.push(`import ${defaultImport.name} from '${modulePath}';`);
    } else if (namedImports.length > 0) {
      imports.push(`import { ${namedImports.join(', ')} } from '${modulePath}';`);
    }
  }

  return imports.join('\n');
}

/**
 * Normalizes the mdxjs-rs export to ensure MDXContent is available.
 * Handles both direct exports and function reference exports.
 */
function normalizeMdxExport(code: string): string {
  // Remove the default export line(s) - we'll create our own wrapper
  let normalized = code
    // Remove: export default function MDXContent
    .replace(/export\s+default\s+function\s+MDXContent/g, 'function MDXContent')
    // Remove: export default MDXContent;
    .replace(/export\s+default\s+MDXContent\s*;?/g, '')
    // Remove: export { MDXContent as default };
    .replace(/export\s*\{\s*MDXContent\s+as\s+default\s*\}\s*;?/g, '')
    // Remove: export default _createMdxContent;
    .replace(/export\s+default\s+_createMdxContent\s*;?/g, '');

  // If there's a _createMdxContent function that was the default export,
  // alias it to MDXContent for consistency
  if (normalized.includes('function _createMdxContent') && !normalized.includes('function MDXContent')) {
    normalized += '\nconst MDXContent = _createMdxContent;';
  }

  return normalized;
}
