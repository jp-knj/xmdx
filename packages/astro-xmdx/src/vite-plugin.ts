/**
 * Xmdx Vite plugin for MDX compilation.
 * @module vite-plugin
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig, Plugin } from 'vite';
import MagicString from 'magic-string';
import { DiskCache } from './vite-plugin/disk-cache.js';
import {
  starlightLibrary,
} from 'xmdx/registry';
import { createPipeline } from './pipeline/index.js';
import { resolveExpressiveCodeConfig } from './utils/config.js';
import { ExpressiveCodeManager } from './vite-plugin/expressive-code-manager.js';
import { detectProblematicMdxPatterns } from './utils/mdx-detection.js';
import { stripQuery, shouldCompile } from './utils/paths.js';
import {
  VIRTUAL_MODULE_PREFIX,
  OUTPUT_EXTENSION,
  STARLIGHT_LAYER_ORDER,
} from './constants.js';
// Import from extracted vite-plugin modules
import type {
  XmdxBinding,
  XmdxCompiler,
  XmdxPluginOptions,
} from './vite-plugin/types.js';
import { resolveLibraries } from './vite-plugin/resolve-libraries.js';
import { collectHooks } from './vite-plugin/collect-hooks.js';
import { loadXmdxBinding, ENABLE_SHIKI } from './vite-plugin/binding-loader.js';
import { ShikiManager } from './vite-plugin/shiki-manager.js';
import { createLoadProfiler } from './vite-plugin/load-profiler.js';
import type {
  CachedMdxResult,
  CachedModuleResult,
  EsbuildCacheEntry,
  PersistentCache,
} from './vite-plugin/cache-types.js';
import { handleBuildStart } from './vite-plugin/batch-compiler.js';
import { handleLoad } from './vite-plugin/load-handler.js';

// Preserve public API — resolveLibraries was exported from this module
export { resolveLibraries } from './vite-plugin/resolve-libraries.js';

/**
 * Creates the Xmdx Vite plugin that intercepts `.md`/`.mdx` files
 * before `@astrojs/mdx` runs.
 */
export function xmdxPlugin(userOptions: XmdxPluginOptions = {}): Plugin {
  let compiler: XmdxCompiler | undefined;
  let resolvedConfig: ResolvedConfig | undefined;
  const loadProfiler = createLoadProfiler();
  const sourceLookup = new Map<string, string>();
  const originalSourceCache = new Map<string, string>();   // Raw markdown before preprocess hooks
  const processedSourceCache = new Map<string, string>();  // Preprocessed markdown fed to compiler
  const moduleCompilationCache = new Map<string, CachedModuleResult>();  // MD files compiled to modules via Rust
  const mdxCompilationCache = new Map<string, CachedMdxResult>();        // MDX files compiled via mdxjs-rs
  const esbuildCache = new Map<string, EsbuildCacheEntry>();  // Pre-compiled esbuild results
  const fallbackFiles = new Set<string>();

  // PERF: Cache parsed frontmatter to avoid redundant JSON.parse calls
  const frontmatterCache = new Map<string, Record<string, unknown>>();

  /**
   * Parse frontmatter JSON with caching.
   * Returns cached result if available, otherwise parses and caches.
   */
  function parseFrontmatterCached(json: string | undefined, filename: string): Record<string, unknown> {
    if (!json) return {};

    // Include JSON content in cache key to invalidate on content change
    const cacheKey = `${filename}:${json}`;
    const cached = frontmatterCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      frontmatterCache.set(cacheKey, parsed);
      return parsed;
    } catch {
      frontmatterCache.set(cacheKey, {});
      return {};
    }
  }

  // Persistent cache for SSR/Client 2-pass builds
  // These survive between buildStart calls, avoiding redundant recompilation
  const buildState = {
    buildPassCount: 0,
    diskCache: null as DiskCache | null,
  };
  const persistentCache: PersistentCache = {
    esbuild: new Map<string, EsbuildCacheEntry>(),
    moduleCompilation: new Map<string, CachedModuleResult>(),
    mdxCompilation: new Map<string, CachedMdxResult>(),
    fallbackFiles: new Set<string>(),
    fallbackReasons: new Map<string, string>(),
  };
  const fallbackReasons = new Map<string, string>();
  const processedFiles = new Set<string>();
  const loadState = { totalProcessingTimeMs: 0 };

  // Disk cache for cross-build persistence (enabled by default, opt-out via XMDX_DISK_CACHE=0 or options.cache=false)
  const diskCacheEnabled =
    userOptions.cache !== false && process.env.XMDX_DISK_CACHE !== '0';

  const providedBinding = userOptions.binding ?? null;

  // Collect hooks from plugins
  const plugins = userOptions.plugins ?? [];
  const hooks = collectHooks(plugins);

  // Create pipeline once (shared across buildStart and load hooks)
  const transformPipeline = createPipeline({
    afterParse: hooks.afterParse,
    beforeInject: hooks.beforeInject,
    beforeOutput: hooks.beforeOutput,
  });

  const include = userOptions.include ?? shouldCompile;
  const starlightComponents = userOptions.starlightComponents ?? false;

  // Resolve libraries and create registry early (needed for expressiveCode resolution)
  const { registry } = resolveLibraries(userOptions);

  // Resolve ExpressiveCode config with registry to use correct module paths
  // (e.g., @astrojs/starlight/components when Starlight is configured)
  const expressiveCode = resolveExpressiveCodeConfig(
    userOptions.expressiveCode ?? false,
    registry
  );

  // Build compiler options with default code_sample_components
  // Note: rewrite_code_blocks is set based on whether ExpressiveCode is enabled
  const compilerOptions = {
    ...(userOptions.compiler ?? {}),
    jsx: {
      ...(userOptions.compiler?.jsx ?? {}),
      code_sample_components:
        userOptions.compiler?.jsx?.code_sample_components ?? ['Code', 'Prism'],
    },
    // Enable code block rewriting so Rust outputs <Code> components
    // Starlight's EC integration processes these at runtime
    rewriteCodeBlocks: !!expressiveCode,
  };

  // Track whether Starlight is configured for gating default directive handling.
  // Prefer the explicit flag set by the integration during auto-detection;
  // fall back to the legacy derivation for preset-based users.
  const hasStarlightConfigured = userOptions.starlightDetected ??
    (Boolean(userOptions.starlightComponents) ||
     (Array.isArray(userOptions.libraries) &&
      userOptions.libraries.some(lib => lib === starlightLibrary)));

  // MDX import handling options
  const mdxOptions = userOptions.mdx;

  const unwrapVirtual = (value: string | undefined): string | undefined =>
    value && value.startsWith(VIRTUAL_MODULE_PREFIX)
      ? value.slice(VIRTUAL_MODULE_PREFIX.length)
      : value;

  // Enable Shiki when:
  // 1. XMDX_SHIKI=1 env var is set, OR
  // 2. ExpressiveCode is explicitly disabled (fallback highlighting)
  const shikiManager = new ShikiManager(ENABLE_SHIKI || !expressiveCode);

  // ExpressiveCode pre-rendering manager for build-time code highlighting.
  // When Starlight is configured, its EC integration handles rendering --
  // skip our own engine to avoid double-processing and theme mismatches.
  const starlightHandlesEC = hasStarlightConfigured;
  const ecManager = new ExpressiveCodeManager(expressiveCode, starlightHandlesEC);

  // Lazy compiler initialization to avoid Vite module runner timing issues
  const getCompiler = async (): Promise<XmdxCompiler> => {
    if (!compiler) {
      const binding = providedBinding ?? (await loadXmdxBinding());
      const createCompiler = binding.createCompiler
        ? binding.createCompiler
        : (cfg: Record<string, unknown>) => new binding.XmdxCompiler!(cfg);
      compiler = createCompiler(compilerOptions);
    }
    return compiler;
  };

  return {
    name: 'vite-plugin-xmdx',
    enforce: 'pre',

    configResolved(config) {
      resolvedConfig = config;
      loadProfiler?.setRoot(config.root);

      // Vite 8+: use oxc config; Vite 7 and below: use esbuild config
      const configAny = config as Record<string, unknown>;
      if ('oxc' in configAny && configAny.oxc !== false) {
        // Vite 8+ with OXC support
        const oxcConfig = (configAny.oxc ?? {}) as Record<string, unknown>;
        if (oxcConfig.jsx == null) {
          oxcConfig.jsx = {
            runtime: 'automatic',
            importSource: 'astro',
          };
        }
        configAny.oxc = oxcConfig;
      } else if (config.esbuild == null) {
        (config as { esbuild: object }).esbuild = {
          jsx: 'automatic',
          jsxImportSource: 'astro',
        };
      } else if (config.esbuild !== false) {
        const esbuildConfig = config.esbuild as Record<string, unknown>;
        if (esbuildConfig.jsx == null) {
          esbuildConfig.jsx = 'automatic';
        }
        if (esbuildConfig.jsxImportSource == null) {
          esbuildConfig.jsxImportSource = 'astro';
        }
      }
      // Ensure native binding is treated as external to avoid Vite SSR runner involvement
      const optimizeDeps = (config as Record<string, any>).optimizeDeps ?? {};
      const exclude: string[] = optimizeDeps.exclude ?? [];
      if (!exclude.includes('@xmdx/napi')) {
        exclude.push('@xmdx/napi');
      }
      optimizeDeps.exclude = exclude;
      (config as Record<string, any>).optimizeDeps = optimizeDeps;

      const ssr = (config as Record<string, any>).ssr ?? {};
      const ssrExternal: string[] = ssr.external ?? [];
      if (!ssrExternal.includes('@xmdx/napi')) {
        ssrExternal.push('@xmdx/napi');
      }
      ssr.external = ssrExternal;
      (config as Record<string, any>).ssr = ssr;
      // Note: Binding/compiler initialization deferred to buildStart/load hooks
      // to avoid Vite module runner timing issues with async imports
    },

    transform(code, id) {
      // Dev mode only — build uses Head.astro overlay for layer ordering.
      if (resolvedConfig?.command !== 'serve' || !hasStarlightConfigured) return;
      // Target .astro files containing <head> (root layouts like Page.astro)
      if (!id.endsWith('.astro') || !code.includes('<head>')) return;

      const ms = new MagicString(code, { filename: id });
      ms.replace('<head>', `<head><style is:inline>${STARLIGHT_LAYER_ORDER}</style>`);
      return {
        code: ms.toString(),
        map: ms.generateMap({ hires: 'boundary' }),
      };
    },

    async buildStart() {
      await handleBuildStart({
        resolvedConfig,
        state: buildState,
        diskCacheEnabled,
        persistentCache,
        originalSourceCache,
        processedSourceCache,
        moduleCompilationCache,
        mdxCompilationCache,
        esbuildCache,
        fallbackFiles,
        fallbackReasons,
        processedFiles,
        hooks,
        mdxOptions,
        providedBinding,
        loadBinding: loadXmdxBinding,
        compilerOptions,
        shikiManager,
        ecManager,
        starlightComponents,
        parseFrontmatterCached,
        transformPipeline,
        expressiveCode,
        registry,
        warn: this.warn.bind(this),
      });
    },

    async resolveId(sourceId, importer) {
      if (sourceId.startsWith(VIRTUAL_MODULE_PREFIX)) {
        return sourceId;
      }
      const normalizedImporter = stripQuery(unwrapVirtual(importer) ?? '');
      const normalizedSource = unwrapVirtual(sourceId) ?? sourceId;
      const cleanId = stripQuery(normalizedSource);
      if (!include(cleanId)) {
        if (
          importer?.startsWith(VIRTUAL_MODULE_PREFIX) &&
          normalizedImporter &&
          !path.isAbsolute(sourceId) &&
          sourceId.startsWith('.')
        ) {
          return path.resolve(path.dirname(normalizedImporter), sourceId);
        }
        return null;
      }
      const resolved = await this.resolve(cleanId, normalizedImporter, {
        skipSelf: true,
      });
      const fallback = (): string => {
        if (path.isAbsolute(cleanId)) {
          return cleanId;
        }
        if (normalizedImporter) {
          return path.resolve(path.dirname(normalizedImporter), cleanId);
        }
        return cleanId;
      };
      const resolvedId =
        resolved && resolved.id
          ? stripQuery(unwrapVirtual(resolved.id) ?? resolved.id)
          : fallback();

      // Note: We no longer return null for fallback files because xmdx IS the MDX plugin.
      // Returning null would cause Vite to try parsing raw MDX as JS, which fails.
      // Instead, we resolve all MDX files and use compileFallbackModule in the load hook
      // for files with problematic patterns.

      // Dev mode pre-detection: mark files for fallback before proceeding
      // These will be compiled with @mdx-js/mdx in the load hook
      if (resolvedConfig?.command !== 'build' && !fallbackFiles.has(resolvedId)) {
        try {
          const source = await readFile(resolvedId, 'utf8');
          let processedSource = source;
          for (const preprocessHook of hooks.preprocess) {
            processedSource = preprocessHook(processedSource, resolvedId);
          }
          const detection = detectProblematicMdxPatterns(processedSource, mdxOptions, resolvedId);
          if (detection.hasProblematicPatterns) {
            fallbackFiles.add(resolvedId);
            fallbackReasons.set(resolvedId, detection.reason ?? 'Pre-detected problematic MDX patterns (dev mode)');
          }
        } catch {
          // File read failed, let normal path handle it
        }
      }

      const virtualId = `${VIRTUAL_MODULE_PREFIX}${resolvedId}${OUTPUT_EXTENSION}`;
      sourceLookup.set(virtualId, resolvedId);
      return virtualId;
    },

    async load(id) {
      return handleLoad(id, {
        sourceLookup,
        fallbackFiles,
        fallbackReasons,
        esbuildCache,
        moduleCompilationCache,
        mdxCompilationCache,
        originalSourceCache,
        processedSourceCache,
        processedFiles,
        registry,
        hasStarlightConfigured,
        hooks,
        mdxOptions,
        starlightComponents,
        expressiveCode,
        shikiManager,
        transformPipeline,
        parseFrontmatterCached,
        compilerOptions,
        getCompiler,
        loadBinding: loadXmdxBinding,
        loadProfiler,
        resolvedConfig,
        state: loadState,
        warn: this.warn.bind(this),
        addWatchFile: this.addWatchFile.bind(this),
        invalidateModule: (moduleId: string) => {
          const config = resolvedConfig as unknown as {
            server?: {
              moduleGraph?: {
                getModuleById: (id: string) => object | null;
                invalidateModule: (mod: object) => void;
              };
            };
          };
          if (config?.server?.moduleGraph) {
            const mod = config.server.moduleGraph.getModuleById(moduleId);
            if (mod) {
              config.server.moduleGraph.invalidateModule(mod);
            }
          }
        },
      });
    },

    async buildEnd() {
      if (loadProfiler) loadProfiler.dump(resolvedConfig?.root ?? '');

      // Clean up stale disk cache entries
      if (buildState.diskCache && buildState.buildPassCount === 1) {
        await buildState.diskCache.cleanup(processedFiles);
        await buildState.diskCache.flush();
      }

      if (process.env.XMDX_STATS !== '1') return;

      const totalFiles = processedFiles.size + fallbackFiles.size;

      const stats = {
        timestamp: new Date().toISOString(),
        totalFiles,
        processedByXmdx: processedFiles.size,
        handledByAstro: fallbackFiles.size,
        handledByAstroRate:
          totalFiles > 0
            ? `${((fallbackFiles.size / totalFiles) * 100).toFixed(2)}%`
            : '0%',
        preValidationSkips: {
          count: 0,
          files: [] as string[],
        },
        runtimeFallbacks: {
          count: fallbackFiles.size,
          files: Array.from(fallbackFiles).map((file) => ({
            file: file.replace(resolvedConfig?.root ?? '', ''),
            reason: fallbackReasons.get(file) ?? 'unknown',
          })),
        },
        fallbacks: fallbackFiles.size,
        fallbackRate:
          totalFiles > 0
            ? `${((fallbackFiles.size / totalFiles) * 100).toFixed(2)}%`
            : '0%',
        fallbackFiles: Array.from(fallbackFiles).map((file) => ({
          file: file.replace(resolvedConfig?.root ?? '', ''),
          reason: fallbackReasons.get(file) ?? 'unknown',
        })),
        performance: {
          totalProcessingTimeMs: Math.round(loadState.totalProcessingTimeMs * 100) / 100,
          averageFileTimeMs:
            processedFiles.size > 0
              ? Math.round((loadState.totalProcessingTimeMs / processedFiles.size) * 100) / 100
              : 0,
        },
      };

      const outputPath = path.join(resolvedConfig?.root ?? '.', 'xmdx-stats.json');
      await writeFile(outputPath, JSON.stringify(stats, null, 2));
      console.info(`[xmdx] Stats written to ${outputPath}`);
    },
  };
}
