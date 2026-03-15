/**
 * Xmdx Vite plugin for MDX compilation.
 * @module vite-plugin
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig, Plugin } from 'vite';
import MagicString from 'magic-string';
import {
  collectHooks,
  resolveLibraries,
  ShikiManager,
  ExpressiveCodeManager,
  createLoadProfiler,
  loadXmdxBinding,
  ENABLE_SHIKI,
} from '@xmdx/vite';
import type {
  DiskCache,
  EsbuildCacheEntry,
  PersistentCache,
  XmdxCompiler,
  XmdxPluginOptions,
} from '@xmdx/vite';
import type { TransformContext } from 'xmdx/pipeline';
import {
  starlightLibrary,
} from 'xmdx/registry';
import { createPipeline } from './pipeline/index.js';
import { resolveExpressiveCodeConfig } from 'xmdx/utils/config';
import { renderExpressiveCodeBlocks, stripExpressiveCodeImport } from './transforms/expressive-code.js';
import { detectProblematicMdxPatterns } from 'xmdx/utils/mdx-detection';
import { stripQuery, shouldCompile } from 'xmdx/utils/paths';
import {
  VIRTUAL_MODULE_PREFIX,
  OUTPUT_EXTENSION,
  STARLIGHT_LAYER_ORDER,
  EC_STYLES_MODULE_ID,
  EC_STYLES_VIRTUAL_ID,
} from './constants.js';
import { handleBuildStart } from './vite-plugin/batch-compiler.js';
import { handleLoad } from './vite-plugin/load-handler.js';
import { asMutableConfig, asMutableViteConfig, asBinding } from './ops/type-narrowing.js';

// Preserve public API — resolveLibraries was exported from this module
export { resolveLibraries } from '@xmdx/vite';

/**
 * Creates the Xmdx Vite plugin that intercepts `.md`/`.mdx` files
 * before `@astrojs/mdx` runs.
 */
export function xmdxPlugin(userOptions: XmdxPluginOptions = {}): Plugin {
  let compiler: XmdxCompiler | undefined;
  let resolvedConfig: ResolvedConfig | undefined;
  const loadProfiler = createLoadProfiler();
  const sourceLookup = new Map<string, string>();
  const esbuildCache = new Map<string, EsbuildCacheEntry>();
  const fallbackFiles = new Set<string>();

  // Persistent cache for SSR/Client 2-pass builds
  // These survive between buildStart calls, avoiding redundant recompilation
  const buildState: { buildPassCount: number; diskCache: DiskCache | null } = {
    buildPassCount: 0,
    diskCache: null,
  };
  const persistentCache: PersistentCache = {
    esbuild: new Map<string, EsbuildCacheEntry>(),
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
    // xmdx pre-renders them at build time via ExpressiveCode
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
  const toVirtualId = (resolvedId: string): string => {
    const virtualId = `${VIRTUAL_MODULE_PREFIX}${resolvedId}${OUTPUT_EXTENSION}`;
    sourceLookup.set(virtualId, resolvedId);
    return virtualId;
  };

  // Enable Shiki when:
  // 1. XMDX_SHIKI=1 env var is set, OR
  // 2. ExpressiveCode is explicitly disabled (fallback highlighting)
  const shikiManager = new ShikiManager(ENABLE_SHIKI || !expressiveCode);

  // ExpressiveCode pre-rendering manager for build-time code highlighting.
  // xmdx always pre-renders code blocks — Starlight's runtime <Code> component
  // is bypassed since xmdx replaces @astrojs/mdx and its rehype plugins.
  const ecManager = new ExpressiveCodeManager(expressiveCode);

  // EC pre-render hook: runs after transformExpressiveCode rewrites <pre><code> → <Code>,
  // converting <Code> components to pre-rendered <_Fragment set:html={...} />.
  const ecPreRenderHook = expressiveCode
    ? async (ctx: TransformContext): Promise<TransformContext> => {
        const result = await renderExpressiveCodeBlocks(ctx.code, ecManager, expressiveCode.component);
        if (!result.changed) return ctx;
        let code = stripExpressiveCodeImport(result.code, expressiveCode);
        if (!code.includes(EC_STYLES_MODULE_ID)) {
          code = `import '${EC_STYLES_MODULE_ID}';\n${code}`;
        }
        return { ...ctx, code };
      }
    : null;

  // Create pipeline once (shared across buildStart and load hooks)
  const transformPipeline = createPipeline({
    afterParse: hooks.afterParse,
    beforeInject: ecPreRenderHook
      ? [ecPreRenderHook, ...hooks.beforeInject]
      : hooks.beforeInject,
    beforeOutput: hooks.beforeOutput,
  });

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
      const mutableConfig = asMutableViteConfig(config);
      if ('oxc' in mutableConfig && mutableConfig.oxc !== false) {
        // Vite 8+ with OXC support
        const oxcConfig = asMutableConfig(mutableConfig.oxc ?? {});
        if (oxcConfig.jsx == null) {
          oxcConfig.jsx = {
            runtime: 'automatic',
            importSource: 'astro',
          };
        }
        mutableConfig.oxc = oxcConfig;
      } else if (config.esbuild == null) {
        asMutableConfig(config).esbuild = {
          jsx: 'automatic',
          jsxImportSource: 'astro',
        };
      } else if (config.esbuild !== false) {
        const esbuildConfig = asMutableConfig(config.esbuild);
        if (esbuildConfig.jsx == null) {
          esbuildConfig.jsx = 'automatic';
        }
        if (esbuildConfig.jsxImportSource == null) {
          esbuildConfig.jsxImportSource = 'astro';
        }
      }
      // Ensure native binding is treated as external to avoid Vite SSR runner involvement
      const optimizeDeps = mutableConfig.optimizeDeps ?? {};
      const exclude: string[] = optimizeDeps.exclude ?? [];
      if (!exclude.includes('@xmdx/napi')) {
        exclude.push('@xmdx/napi');
      }
      optimizeDeps.exclude = exclude;
      mutableConfig.optimizeDeps = optimizeDeps;

      const ssr = mutableConfig.ssr ?? {};
      const ssrExternal: string[] = ssr.external ?? [];
      if (!ssrExternal.includes('@xmdx/napi')) {
        ssrExternal.push('@xmdx/napi');
      }
      ssr.external = ssrExternal;
      mutableConfig.ssr = ssr;
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
        transformPipeline,
        expressiveCode,
        registry,
        warn: this.warn.bind(this),
      });
    },

    async resolveId(sourceId, importer) {
      if (sourceId === EC_STYLES_MODULE_ID) return EC_STYLES_VIRTUAL_ID;
      if (sourceId.startsWith(VIRTUAL_MODULE_PREFIX)) {
        return sourceId;
      }
      const normalizedImporter = stripQuery(unwrapVirtual(importer) ?? '');
      const normalizedSource = unwrapVirtual(sourceId) ?? sourceId;
      const cleanId = stripQuery(normalizedSource);
      if (!include(cleanId)) {
        if (importer?.startsWith(VIRTUAL_MODULE_PREFIX) && normalizedImporter) {
          if (!path.isAbsolute(sourceId) && sourceId.startsWith('.')) {
            const resolvedId = path.resolve(path.dirname(normalizedImporter), sourceId);
            return include(resolvedId) ? toVirtualId(resolvedId) : resolvedId;
          }
          // Bare specifiers from virtual modules should resolve exactly as they would
          // from the consumer app. Do not fall back to astro-xmdx's private dependency tree.
          {
            const resolved = await this.resolve(sourceId, normalizedImporter, {
              skipSelf: true,
            });
            if (resolved?.id) {
              const resolvedId = stripQuery(unwrapVirtual(resolved.id) ?? resolved.id);
              if (include(resolvedId)) {
                return toVirtualId(resolvedId);
              }
              return resolved;
            }
            return null;
          }
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

      return toVirtualId(resolvedId);
    },

    async load(id) {
      if (id === EC_STYLES_VIRTUAL_ID) {
        return ecManager.getStyles() || '/* no ec styles */';
      }
      return handleLoad(id, {
        sourceLookup,
        fallbackFiles,
        fallbackReasons,
        esbuildCache,
        processedFiles,
        registry,
        hasStarlightConfigured,
        hooks,
        mdxOptions,
        starlightComponents,
        expressiveCode,
        ecManager,
        shikiManager,
        transformPipeline,
        getCompiler,
        loadBinding: loadXmdxBinding,
        loadProfiler,
        resolvedConfig,
        state: loadState,
        warn: this.warn.bind(this),
        addWatchFile: this.addWatchFile.bind(this),
        invalidateModule: (moduleId: string) => {
          const config = asBinding<{
            server?: {
              moduleGraph?: {
                getModuleById: (id: string) => object | null;
                invalidateModule: (mod: object) => void;
              };
            };
          }>(resolvedConfig);
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
          files: [] satisfies string[],
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
