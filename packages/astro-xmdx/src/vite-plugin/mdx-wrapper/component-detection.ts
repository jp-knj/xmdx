/**
 * Detects which registry components are referenced in compiled MDX output.
 * @module vite-plugin/component-detection
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

/**
 * Component usage information.
 */
export interface UsedComponent {
  name: string;
  modulePath: string;
  exportType: 'named' | 'default';
}

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
 * Extracts imported names from a single complete import statement string.
 * Handles default, namespace, and named imports.
 */
function processImportStatement(statement: string, imported: Set<string>): void {
  const match = IMPORT_LINE_PATTERN.exec(statement);
  if (!match) return;

  if (/^import\s+type\s/.test(statement)) return;

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

const FROM_CLAUSE_PATTERN = /from\s+['"][^'"]+['"]/;

/**
 * Extracts already-imported component names from the mdxjs-rs output.
 * This prevents duplicate imports when we add our component injections.
 *
 * Only scans top-level import statements by processing lines at the start
 * of the file, stopping when we hit actual code (function definitions, etc.).
 * This avoids matching import statements inside code strings/samples.
 *
 * Supports multi-line imports (e.g. `import {\n  Foo,\n  Bar\n} from '...'`).
 */
function extractExistingImports(code: string): Set<string> {
  const imported = new Set<string>();
  const lines = code.split('\n');
  let inImport = false;
  let currentImport = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (inImport) {
      currentImport += ' ' + trimmed;
      if (FROM_CLAUSE_PATTERN.test(trimmed)) {
        processImportStatement(currentImport, imported);
        inImport = false;
        currentImport = '';
      }
      continue;
    }

    // Skip empty lines and comments at the top
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Stop scanning when we hit non-import code
    if (!trimmed.startsWith('import ') && !trimmed.startsWith('import{')) {
      break;
    }

    // Check if import is complete on one line
    if (FROM_CLAUSE_PATTERN.test(trimmed)) {
      processImportStatement(trimmed, imported);
    } else {
      // Multi-line import — start accumulating
      inImport = true;
      currentImport = trimmed;
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
export function detectUsedComponents(code: string, registry: Registry): UsedComponent[] {
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
