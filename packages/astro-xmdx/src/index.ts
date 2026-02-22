/**
 * Astro integration for Xmdx - high-performance MDX compiler.
 * @module astro-xmdx
 */

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import type { ComponentLibrary, ComponentDefinition } from 'xmdx/registry';
import { starlightLibrary, astroLibrary, expressiveCodeLibrary } from 'xmdx/registry';
import { xmdxPlugin } from './vite-plugin.js';
import { mergePresets, STARLIGHT_DEFAULT_ALLOW_IMPORTS, type PresetConfig } from './presets/index.js';
import { safeParseFrontmatter } from './utils/frontmatter.js';
import type { XmdxPlugin, MdxImportHandlingOptions } from './types.js';

/**
 * Extracts Starlight component overrides from the Starlight integration config.
 * Starlight stores user overrides as `{ components: { ComponentName: 'path/to/Override.astro' } }`.
 * Returns a map of override name -> override path for content-affecting components.
 */
function getStarlightComponentOverrides(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  starlightIntegration: any
): Map<string, string> {
  const overrides = new Map<string, string>();
  // Starlight stores its user config on the integration object at runtime
  // via config property or _dependencies.starlightConfig
  const starlightConfig =
    starlightIntegration?.config ??
    starlightIntegration?.options ??
    starlightIntegration?._dependencies?.starlightConfig;

  if (!starlightConfig?.components || typeof starlightConfig.components !== 'object') {
    return overrides;
  }

  for (const [name, importPath] of Object.entries(starlightConfig.components)) {
    if (typeof importPath === 'string' && importPath.length > 0) {
      overrides.set(name, importPath);
    }
  }
  return overrides;
}

/**
 * Applies Starlight component overrides to a library's component list.
 * Returns a new library with overridden import paths where applicable.
 */
function applyStarlightOverrides(
  library: ComponentLibrary,
  overrides: Map<string, string>
): ComponentLibrary {
  if (overrides.size === 0) return library;

  const updatedComponents: ComponentDefinition[] = library.components.map((comp) => {
    const overridePath = overrides.get(comp.name);
    if (overridePath) {
      return {
        ...comp,
        modulePath: overridePath,
        exportType: 'default' as const,
      };
    }
    return comp;
  });

  return {
    ...library,
    components: updatedComponents,
  };
}

/**
 * Options for the Xmdx integration.
 */
export interface XmdxOptions {
  /**
   * File filter function. Defaults to .md and .mdx files.
   */
  include?: (id: string) => boolean;

  /**
   * Component libraries to register.
   */
  libraries?: ComponentLibrary[];

  /**
   * Presets to apply. Presets are merged in order.
   */
  presets?: PresetConfig[];

  /**
   * Enable Starlight component injection.
   */
  starlightComponents?: boolean | {
    enabled: boolean;
    importSource?: string;
  };

  /**
   * Enable ExpressiveCode block rewriting.
   */
  expressiveCode?: boolean | {
    enabled: boolean;
    componentName?: string;
    importSource?: string;
  };

  /**
   * Compiler configuration.
   */
  compiler?: {
    jsx?: {
      code_sample_components?: string[];
    };
  };

  /**
   * Xmdx plugins for transform hooks.
   */
  plugins?: XmdxPlugin[];

  /**
   * MDX import handling configuration.
   * Controls which imports are allowed vs trigger fallback to @mdx-js/mdx.
   */
  mdx?: MdxImportHandlingOptions;
}

/**
 * Astro integration for Xmdx.
 *
 * @example
 * ```js
 * // astro.config.mjs
 * import { defineConfig } from 'astro/config';
 * import xmdx from 'astro-xmdx';
 *
 * export default defineConfig({
 *   integrations: [xmdx()],
 * });
 * ```
 *
 * @example
 * ```js
 * // With presets
 * import xmdx from 'astro-xmdx';
 * import { starlightPreset } from 'astro-xmdx/presets';
 *
 * export default defineConfig({
 *   integrations: [
 *     xmdx({
 *       presets: [starlightPreset()],
 *     })
 *   ],
 * });
 * ```
 */
export default function xmdx(options: XmdxOptions = {}): AstroIntegration {
  // Handle presets if provided
  let resolvedOptions = { ...options };

  if (Array.isArray(options.presets) && options.presets.length > 0) {
    const presetConfig = mergePresets(options.presets);

    // Apply preset config (user options override preset defaults)
    resolvedOptions = {
      libraries: options.libraries ?? presetConfig.libraries,
      starlightComponents: options.starlightComponents ?? presetConfig.starlightComponents,
      expressiveCode: options.expressiveCode ?? presetConfig.expressiveCode,
      mdx: options.mdx ?? presetConfig.mdx,
      ...options,
    };

    // Remove presets from final options (not needed by vite plugin)
    delete (resolvedOptions as Record<string, unknown>).presets;
  }

  // Auto-apply Starlight default allowImports when starlightComponents is enabled
  // This ensures imports like @astrojs/starlight/components don't trigger fallback
  const hasStarlightComponents = resolvedOptions.starlightComponents === true ||
    (typeof resolvedOptions.starlightComponents === 'object' && resolvedOptions.starlightComponents.enabled);
  const hasAllowImports = resolvedOptions.mdx?.allowImports && resolvedOptions.mdx.allowImports.length > 0;

  if (hasStarlightComponents && !hasAllowImports) {
    resolvedOptions.mdx = {
      ...resolvedOptions.mdx,
      allowImports: [...STARLIGHT_DEFAULT_ALLOW_IMPORTS],
      ignoreCodeFences: resolvedOptions.mdx?.ignoreCodeFences ?? true,
    };
  }

  return {
    name: 'astro-xmdx',
    hooks: {
      'astro:config:setup': async (options) => {
        const {
          config,
          updateConfig,
          addRenderer,
        } = options;

        // These are internal Astro APIs for content collection support
        // They exist at runtime but are not exposed in public types
        const addPageExtension = (options as Record<string, unknown>).addPageExtension as
          | ((ext: string) => void)
          | undefined;
        const addContentEntryType = (options as Record<string, unknown>).addContentEntryType as
          | ((config: {
              extensions: string[];
              getEntryInfo: (params: { fileUrl: URL; contents: string }) => Promise<{
                data: Record<string, unknown>;
                body: string;
                slug?: string;
                rawData: string;
              }>;
              contentModuleTypes: string;
              handlePropagation?: boolean;
            }) => void)
          | undefined;

        // Register the JSX renderer for MDX components.
        // Use a file URL to the built server module to work when this package
        // is consumed via an alias (e.g. @astrojs/mdx -> astro-xmdx).
        addRenderer({
          name: 'astro:jsx',
          serverEntrypoint: new URL('./server.js', import.meta.url).href,
        });

        // Register .mdx as a page extension (if available)
        if (addPageExtension) {
          addPageExtension('.mdx');
        }

        // Register MDX files with Content Collections (if available)
        if (addContentEntryType) {
          addContentEntryType({
            extensions: ['.mdx'],
            async getEntryInfo({ fileUrl, contents }: { fileUrl: URL; contents: string }) {
              const parsed = safeParseFrontmatter(contents, fileURLToPath(fileUrl));
              return {
                data: parsed.frontmatter,
                body: parsed.content.trim(),
                slug: parsed.frontmatter.slug as string | undefined,
                rawData: parsed.rawFrontmatter,
              };
            },
            contentModuleTypes: await fs.readFile(
              new URL('../template/content-module-types.d.ts', import.meta.url),
              'utf-8'
            ),
            handlePropagation: true,
          });
        }

        // Auto-detect Starlight and apply preset if not already configured
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const starlightIntegration = config.integrations?.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (i: any) => i.name === '@astrojs/starlight'
        );
        const hasStarlight = !!starlightIntegration;

        // Auto-apply Starlight defaults when Starlight is detected and user has not
        // explicitly configured these options in xmdx().
        if (hasStarlight) {
          if (resolvedOptions.starlightComponents === undefined) {
            resolvedOptions.starlightComponents = true;
          }
          if (!resolvedOptions.mdx?.allowImports || resolvedOptions.mdx.allowImports.length === 0) {
            resolvedOptions.mdx = {
              ...resolvedOptions.mdx,
              allowImports: [...STARLIGHT_DEFAULT_ALLOW_IMPORTS],
              ignoreCodeFences: true,
            };
          }
          if (resolvedOptions.expressiveCode === undefined) {
            // Starlight installs astro-expressive-code, so default to Code component
            // rewriting for MD/MDX fences to preserve EC layout + copy button UX.
            resolvedOptions.expressiveCode = true;
          }

          // Detect Starlight component overrides from user config
          const componentOverrides = getStarlightComponentOverrides(starlightIntegration);

          // Auto-register Starlight libraries when user hasn't provided their own.
          // This ensures directive mappings, slot normalizations, and component
          // injection all work without requiring an explicit starlightPreset() call.
          // Apply any component overrides to adjust import paths.
          if (!resolvedOptions.libraries) {
            const effectiveStarlightLibrary = componentOverrides.size > 0
              ? applyStarlightOverrides(starlightLibrary, componentOverrides)
              : starlightLibrary;
            resolvedOptions.libraries = [astroLibrary, effectiveStarlightLibrary, expressiveCodeLibrary];
          }
        }

        updateConfig({
          vite: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            plugins: [xmdxPlugin(resolvedOptions) as any],
          },
        });
      },
    },
  };
}

// Re-export presets for convenience
export { starlightPreset, expressiveCodePreset, astroPreset, mergePresets } from './presets/index.js';
export type { PresetConfig } from './presets/index.js';
export type { XmdxPlugin, TransformContext, PluginHooks, MdxImportHandlingOptions } from './types.js';
