/**
 * Astro integration for Xmdx - high-performance MDX compiler.
 * @module astro-xmdx
 */

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import type { ComponentLibrary } from 'xmdx/registry';
import { xmdxPlugin } from './vite-plugin.js';
import { mergePresets, STARLIGHT_DEFAULT_ALLOW_IMPORTS, type PresetConfig } from './presets/index.js';
import { safeParseFrontmatter } from './utils/frontmatter.js';
import type { XmdxPlugin, MdxImportHandlingOptions } from './types.js';

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

        // Register the JSX renderer for MDX components
        // Use URL resolution to work regardless of how the package is installed
        addRenderer({
          name: 'astro:jsx',
          serverEntrypoint: new URL('./server.ts', import.meta.url).href,
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
        const hasStarlight = config.integrations?.some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (i: any) => i.name === '@astrojs/starlight'
        );

        // Auto-apply Starlight preset when Starlight is detected and no explicit config
        if (hasStarlight && resolvedOptions.starlightComponents === undefined && !resolvedOptions.mdx?.allowImports) {
          resolvedOptions.mdx = {
            ...resolvedOptions.mdx,
            allowImports: [...STARLIGHT_DEFAULT_ALLOW_IMPORTS],
            ignoreCodeFences: true,
          };
          resolvedOptions.starlightComponents = true;
          // Note: Do NOT auto-enable expressiveCode here - Starlight handles its own code blocks
          // and the astro-expressive-code/components module may not be installed
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
