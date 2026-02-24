/**
 * MDX wrapper module for Astro component integration.
 * Wraps mdxjs-rs compiled output in Astro-compatible component format.
 * @module vite-plugin/mdx-wrapper
 */

import { createHash } from 'node:crypto';
import type { Registry } from 'xmdx/registry';

// PERF: Pre-compiled regex patterns at module level
const IMPORT_LINE_PATTERN = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/;
const DEFAULT_IMPORT_PATTERN = /^([A-Za-z$_][\w$]*)\s*(?:,|$)/;
const NAMESPACE_IMPORT_PATTERN = /\*\s+as\s+([A-Za-z$_][\w$]*)/;
const NAMED_IMPORT_PATTERN = /\{([^}]+)\}/;
const LOCAL_CONST_PATTERN = /(?:export\s+)?(?:const|let|var)\s+([A-Z][a-zA-Z0-9]*)\s*=/g;
const LOCAL_FUNC_PATTERN = /(?:export\s+)?function\s+([A-Z][a-zA-Z0-9]*)\s*\(/g;
const LOCAL_CLASS_PATTERN = /(?:export\s+)?class\s+([A-Z][a-zA-Z0-9]*)\s*[{<]/g;
const COMPONENT_REF_PATTERN = /\b([A-Z][a-zA-Z0-9]*)\b/g;

// PERF: Cache for component detection results
// Key: hash of (code + registry components), Value: detected components
const componentDetectionCache = new Map<string, UsedComponent[]>();
const MAX_CACHE_SIZE = 1000;

function computeCodeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16);
}

function computeRegistryHash(registry: Registry): string {
  // Create a stable hash from component definitions
  const components = registry.getAllComponents();
  const key = components
    .map(c => `${c.name}:${c.modulePath}:${c.exportType}`)
    .sort()
    .join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

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

    // Process this import line using pre-compiled pattern
    const match = IMPORT_LINE_PATTERN.exec(trimmed);
    if (!match) continue;

    if (/^import\s+type\s/.test(trimmed)) {
      continue;
    }

    let clause = match[1]?.trim() ?? '';
    if (clause.startsWith('type ')) {
      clause = clause.slice('type '.length).trim();
    }

    // Default import: import Foo from 'module' or import Foo, { Bar } from 'module'
    const defaultMatch = clause.match(DEFAULT_IMPORT_PATTERN);
    if (defaultMatch?.[1]) {
      imported.add(defaultMatch[1]);
    }

    // Namespace import: import * as Foo from 'module'
    const namespaceMatch = clause.match(NAMESPACE_IMPORT_PATTERN);
    if (namespaceMatch?.[1]) {
      imported.add(namespaceMatch[1]);
    }

    // Named imports: import { Foo, Bar as Baz } from 'module'
    // Also handles: import Default, { Foo, Bar } from 'module'
    const namedMatch = clause.match(NAMED_IMPORT_PATTERN);
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
  // PERF: Use pre-compiled patterns and reset lastIndex for reuse
  const patterns = [LOCAL_CONST_PATTERN, LOCAL_FUNC_PATTERN, LOCAL_CLASS_PATTERN];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
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
 *
 * PERF: Results are cached by code hash to avoid redundant parsing.
 */
function detectUsedComponents(code: string, registry: Registry): UsedComponent[] {
  // PERF: Check cache first (keyed by both code and registry identity)
  const codeHash = computeCodeHash(code);
  const registryHash = computeRegistryHash(registry);
  const cacheKey = `${codeHash}:${registryHash}`;
  const cached = componentDetectionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const usedComponents: UsedComponent[] = [];
  const seenNames = new Set<string>();

  // Get components already imported in the mdxjs-rs output
  const existingImports = extractExistingImports(code);
  // Get locally declared components (const Foo = ..., function Foo, etc.)
  const localDeclarations = extractLocalDeclarations(code);

  // Match potential component references in JSX
  // This includes both direct usage like <Tabs> and indirect like jsx(Tabs, ...)
  // PERF: Use pre-compiled pattern and reset lastIndex
  COMPONENT_REF_PATTERN.lastIndex = 0;
  let match;

  while ((match = COMPONENT_REF_PATTERN.exec(code)) !== null) {
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

  // PERF: Cache the result (with LRU-style eviction)
  if (componentDetectionCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entries (first 100)
    const keys = Array.from(componentDetectionCache.keys()).slice(0, 100);
    for (const key of keys) {
      componentDetectionCache.delete(key);
    }
  }
  componentDetectionCache.set(cacheKey, usedComponents);

  return usedComponents;
}

/**
 * Generates import statements for the used components.
 * For default exports, uses the convention: ${modulePath}/${name}.astro
 * to match the rest of the codebase (blocks-to-jsx, inject-components, directive-rewriter).
 */
function generateComponentImports(components: UsedComponent[], registry: Registry): string {
  // Group components by module path for cleaner imports (named exports only)
  const byModule = new Map<string, UsedComponent[]>();
  const defaultExports: UsedComponent[] = [];

  for (const component of components) {
    if (component.exportType === 'default') {
      // Default exports use individual imports with full path
      defaultExports.push(component);
    } else {
      const existing = byModule.get(component.modulePath) ?? [];
      existing.push(component);
      byModule.set(component.modulePath, existing);
    }
  }

  const imports: string[] = [];

  // Generate named imports grouped by module
  for (const [modulePath, moduleComponents] of byModule) {
    const namedImports = moduleComponents.map(c => c.name);
    if (namedImports.length > 0) {
      imports.push(`import { ${namedImports.join(', ')} } from '${modulePath}';`);
    }
  }

  // Generate individual default imports with full path convention
  for (const comp of defaultExports) {
    // If modulePath already has a file extension (e.g. Starlight component overrides
    // like './src/CustomAside.astro'), import directly from it. Otherwise, use the
    // convention: ${modulePath}/${name}.astro
    const importPath = /\.\w+$/.test(comp.modulePath)
      ? comp.modulePath
      : `${comp.modulePath}/${comp.name}.astro`;
    imports.push(`import ${comp.name} from '${importPath}';`);
  }

  return imports.join('\n');
}

// PERF: Pre-compiled pattern for heading JSX calls
const HEADING_JSX_PATTERN = /_jsxs?\(_components\.h([1-6]),\s*\{/g;

/**
 * Extracts a plain-text string from the children value following a heading JSX call.
 *
 * Handles both simple string children (`children: "Hello"`) and array children
 * where we concatenate all string literals (`children: ["Hello", " ", "World"]`).
 * Returns null if children cannot be reliably extracted.
 */
function extractChildrenText(code: string, propsStart: number): string | null {
  const searchRegion = code.slice(propsStart, propsStart + 500);
  const childrenMatch = /children:\s*/.exec(searchRegion);
  if (!childrenMatch) return null;

  const afterChildren = searchRegion.slice(childrenMatch.index + childrenMatch[0].length);

  // Case 1: children: "simple string"
  if (afterChildren.startsWith('"')) {
    const endQuote = afterChildren.indexOf('"', 1);
    if (endQuote > 0) return afterChildren.slice(1, endQuote);
  }

  // Case 2: children: ["part1", _jsx(...), "part2", ...]
  // Concatenate only string literals for matching.
  if (afterChildren.startsWith('[')) {
    let text = '';
    const STR_RE = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    // Only scan up to the closing bracket
    let depth = 1;
    let end = 1;
    for (let i = 1; i < afterChildren.length && depth > 0; i++) {
      if (afterChildren[i] === '[') depth++;
      else if (afterChildren[i] === ']') depth--;
      if (depth === 0) { end = i; break; }
    }
    const inner = afterChildren.slice(1, end);
    let m: RegExpExecArray | null;
    while ((m = STR_RE.exec(inner)) !== null) {
      text += m[1];
    }
    return text || null;
  }

  return null;
}

/**
 * Injects `id` props into heading JSX calls in mdxjs-rs compiled output.
 *
 * mdxjs-rs generates `_jsx(_components.h2, { children: "..." })` without `id` attributes.
 * This function adds the corresponding slug from the extracted headings array so that
 * the rendered HTML has proper fragment anchors (e.g., `<h2 id="getting-started">`).
 *
 * Matches heading calls to the extracted headings by depth and text content rather than
 * sequential order, so setext or other heading types that aren't in the extracted headings
 * array don't cause ID misalignment.
 */
function injectHeadingIds(
  code: string,
  headings: Array<{ depth: number; slug: string; text: string }>
): string {
  if (headings.length === 0) return code;

  // Build a queue of headings to match, indexed by "depth:text" for O(1) lookup.
  // Use a Map of arrays to handle duplicate heading text at the same depth.
  const headingMap = new Map<string, Array<{ slug: string; used: boolean }>>();
  for (const h of headings) {
    const key = `${h.depth}:${h.text}`;
    let list = headingMap.get(key);
    if (!list) {
      list = [];
      headingMap.set(key, list);
    }
    list.push({ slug: h.slug, used: false });
  }

  // Also keep a sequential fallback index for cases where text extraction fails
  let fallbackIndex = 0;

  HEADING_JSX_PATTERN.lastIndex = 0;
  return code.replace(
    HEADING_JSX_PATTERN,
    (match, depthStr: string, offset: number) => {
      const depth = Number.parseInt(depthStr, 10);

      // Try to extract children text to match by content
      const propsStart = offset + match.length;
      const childrenText = extractChildrenText(code, propsStart);

      if (childrenText !== null) {
        const key = `${depth}:${childrenText}`;
        const entries = headingMap.get(key);
        if (entries) {
          const entry = entries.find(e => !e.used);
          if (entry) {
            entry.used = true;
            return `${match}\n                id: ${JSON.stringify(entry.slug)},`;
          }
        }
        // No match found — this heading call is not in the extracted headings (e.g., setext)
        return match;
      }

      // Fallback: text extraction failed, use sequential matching
      while (fallbackIndex < headings.length) {
        const h = headings[fallbackIndex]!;
        fallbackIndex++;
        if (h.depth === depth) {
          return `${match}\n                id: ${JSON.stringify(h.slug)},`;
        }
      }
      return match;
    }
  );
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
