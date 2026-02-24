/**
 * Generates import statements for registry components used in MDX output.
 * @module vite-plugin/component-imports
 */

import type { Registry } from 'xmdx/registry';
import type { UsedComponent } from './component-detection.js';

/**
 * Generates import statements for the used components.
 * For default exports, uses the convention: ${modulePath}/${name}.astro
 * to match the rest of the codebase (blocks-to-jsx, inject-components, directive-rewriter).
 */
export function generateComponentImports(components: UsedComponent[], registry: Registry): string {
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
    const rawPath = /\.(astro|[cm]?[jt]sx?|svelte|vue)$/.test(comp.modulePath)
      ? comp.modulePath
      : `${comp.modulePath}/${comp.name}.astro`;
    // Absolute filesystem paths must use Vite's /@fs/ prefix to be valid
    // specifiers in virtual modules (especially on Windows where C:/ is invalid ESM)
    const importPath = isAbsoluteFilePath(rawPath) ? `/@fs/${rawPath.replace(/^\//, '')}` : rawPath;
    imports.push(`import ${comp.name} from '${importPath}';`);
  }

  return imports.join('\n');
}

/** Detects absolute filesystem paths (POSIX /foo or Windows C:/) */
function isAbsoluteFilePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}
