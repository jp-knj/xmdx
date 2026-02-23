/**
 * Astro Xmdx presets for common UI libraries.
 * @module presets
 */

import type { ComponentLibrary } from 'xmdx/registry';
import { starlightLibrary, expressiveCodeLibrary, astroLibrary } from 'xmdx/registry';
import type { MdxImportHandlingOptions } from '../types.js';

/**
 * Preset configuration.
 */
export interface PresetConfig {
  /** Component libraries to register */
  libraries: ComponentLibrary[];
  /** ExpressiveCode configuration */
  expressiveCode?: boolean | { enabled: boolean; componentName?: string; importSource?: string };
  /** Starlight components configuration */
  starlightComponents?: boolean | { enabled: boolean; importSource?: string };
  /** MDX import handling configuration */
  mdx?: MdxImportHandlingOptions;
}

/**
 * Default import patterns allowed for Starlight projects.
 * These patterns won't trigger fallback to @mdx-js/mdx.
 */
export const STARLIGHT_DEFAULT_ALLOW_IMPORTS = [
  // Starlight components and subpackages
  '@astrojs/starlight/components',
  '@astrojs/starlight/*',
  // Astro virtual modules
  'astro:*',
  // Local project components (common Astro convention)
  '~/components/*',
  // Relative imports (common in MDX files)
  './*',
  '../*',
  // Astro source directory alias
  '@/*',
  // Common image imports
  '*.svg',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.webp',
  '*.avif',
  // Astro component imports
  '*.astro',
  '*.tsx',
  '*.jsx',
] as const;

/**
 * Options for the Starlight preset.
 */
export interface StarlightPresetOptions {
  /** Enable ExpressiveCode integration (default: true) */
  expressiveCode?: boolean;
  /** Strip Starlight imports - registry handles injection. @default true */
  stripStarlightImports?: boolean;
  /**
   * Additional import patterns to allow beyond the defaults.
   * Patterns matching these won't trigger fallback to @mdx-js/mdx.
   * Supports glob patterns (e.g., '~/components/*').
   * @example ['~/components/*', '../components/*', 'my-package']
   */
  allowImports?: string[];
}

/**
 * Creates a Starlight preset with Starlight components and optionally ExpressiveCode.
 *
 * @example
 * import xmdx from 'astro-xmdx';
 * import { starlightPreset } from 'astro-xmdx/presets';
 *
 * export default defineConfig({
 *   integrations: [
 *     xmdx({
 *       presets: [starlightPreset()],
 *     })
 *   ]
 * });
 */
export function starlightPreset(options: StarlightPresetOptions = {}): PresetConfig {
  const { expressiveCode = true, stripStarlightImports = true, allowImports = [] } = options;

  const libraries = [astroLibrary, starlightLibrary];
  if (expressiveCode) {
    libraries.push(expressiveCodeLibrary);
  }

  // Merge default patterns with user-provided patterns
  const mergedAllowImports = [
    ...STARLIGHT_DEFAULT_ALLOW_IMPORTS,
    ...allowImports,
  ];

  return {
    libraries,
    starlightComponents: true,
    expressiveCode: expressiveCode ? { enabled: true } : false,
    mdx: stripStarlightImports
      ? { allowImports: mergedAllowImports, ignoreCodeFences: true }
      : undefined,
  };
}

/**
 * Options for the ExpressiveCode preset.
 */
export interface ExpressiveCodePresetOptions {
  /** Component name to use (default: 'Code') */
  componentName?: string;
  /** Import source (default: 'astro-expressive-code/components') */
  importSource?: string;
}

/**
 * Creates an ExpressiveCode preset for syntax highlighting.
 *
 * @example
 * import xmdx from 'astro-xmdx';
 * import { expressiveCodePreset } from 'astro-xmdx/presets';
 *
 * export default defineConfig({
 *   integrations: [
 *     xmdx({
 *       presets: [expressiveCodePreset()],
 *     })
 *   ]
 * });
 */
export function expressiveCodePreset(options: ExpressiveCodePresetOptions = {}): PresetConfig {
  const {
    componentName = 'Code',
    importSource = 'astro-expressive-code/components',
  } = options;

  return {
    libraries: [astroLibrary, expressiveCodeLibrary],
    expressiveCode: {
      enabled: true,
      componentName,
      importSource,
    },
  };
}

/**
 * Creates a base Astro preset with core components.
 *
 * @example
 * import xmdx from 'astro-xmdx';
 * import { astroPreset } from 'astro-xmdx/presets';
 *
 * export default defineConfig({
 *   integrations: [
 *     xmdx({
 *       presets: [astroPreset()],
 *     })
 *   ]
 * });
 */
export function astroPreset(): PresetConfig {
  return {
    libraries: [astroLibrary],
  };
}

/**
 * Merges multiple presets into a single configuration.
 * Later presets override earlier ones for conflicting options.
 */
export function mergePresets(presets: PresetConfig[]): PresetConfig {
  if (!presets || presets.length === 0) {
    return { libraries: [astroLibrary] };
  }

  const merged: PresetConfig = {
    libraries: [],
    expressiveCode: false,
    starlightComponents: false,
    mdx: undefined,
  };

  const libraryIds = new Set<string>();

  for (const preset of presets) {
    // Merge libraries (deduplicate by id)
    if (Array.isArray(preset.libraries)) {
      for (const lib of preset.libraries) {
        if (!libraryIds.has(lib.id)) {
          libraryIds.add(lib.id);
          merged.libraries.push(lib);
        }
      }
    }

    // Merge expressiveCode (last wins)
    if (preset.expressiveCode !== undefined) {
      merged.expressiveCode = preset.expressiveCode;
    }

    // Merge starlightComponents (last wins)
    if (preset.starlightComponents !== undefined) {
      merged.starlightComponents = preset.starlightComponents;
    }

    // Merge mdx (combine allowImports, last wins for others)
    if (preset.mdx) {
      if (!merged.mdx) {
        merged.mdx = { ...preset.mdx };
      } else {
        const existingAllows = merged.mdx.allowImports ?? [];
        const newAllows = preset.mdx.allowImports ?? [];
        merged.mdx = {
          ...merged.mdx,
          ...preset.mdx,
          allowImports: [...new Set([...existingAllows, ...newAllows])],
        };
      }
    }
  }

  // Ensure at least astroLibrary is present
  if (merged.libraries.length === 0) {
    merged.libraries.push(astroLibrary);
  }

  return merged;
}
