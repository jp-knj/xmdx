/**
 * Xmdx Vite plugin for MDX compilation.
 * @module vite-plugin
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { transformWithEsbuild, type ResolvedConfig, type Plugin } from 'vite';
import MagicString from 'magic-string';
import { build as esbuildBuild, type BuildResult } from 'esbuild';
import type { SourceMapInput } from 'rollup';
import { runParallelEsbuild } from './vite-plugin/esbuild-pool.js';
import { DiskCache } from './vite-plugin/disk-cache.js';
import {
  createRegistry,
  starlightLibrary,
  astroLibrary,
  type ComponentLibrary,
  type Registry,
} from 'xmdx/registry';
import { createPipeline } from './pipeline/index.js';
import { blocksToJsx } from './transforms/blocks-to-jsx.js';
import { renderExpressiveCodeBlocks } from './transforms/expressive-code.js';
import { resolveExpressiveCodeConfig } from './utils/config.js';
import { ExpressiveCodeManager } from './vite-plugin/expressive-code-manager.js';
import { stripFrontmatter } from './utils/frontmatter.js';
import { hasProblematicMdxPatterns, detectProblematicMdxPatterns } from './utils/mdx-detection.js';
import { extractImportStatements } from './utils/imports.js';
import { stripQuery, deriveFileOptions, shouldCompile } from './utils/paths.js';
import {
  VIRTUAL_MODULE_PREFIX,
  OUTPUT_EXTENSION,
  ESBUILD_JSX_CONFIG,
  DEFAULT_IGNORE_PATTERNS,
  STARLIGHT_LAYER_ORDER,
} from './constants.js';
import type { XmdxPlugin, PluginHooks, TransformContext } from './types.js';

// Debug timing utilities
const DEBUG_TIMING = process.env.XMDX_DEBUG_TIMING === '1';

function debugTime(label: string): void {
  if (DEBUG_TIMING) console.time(`[xmdx:timing] ${label}`);
}

function debugTimeEnd(label: string): void {
  if (DEBUG_TIMING) console.timeEnd(`[xmdx:timing] ${label}`);
}

function debugLog(message: string): void {
  if (DEBUG_TIMING) console.log(`[xmdx:timing] ${message}`);
}

// Load hook profiler — activated by XMDX_LOAD_PROFILE=1
const LOAD_PROFILE = process.env.XMDX_LOAD_PROFILE === '1';
const LOAD_PROFILE_TOP = Number(process.env.XMDX_LOAD_PROFILE_TOP) || 10;

type PhaseStats = { totalMs: number; count: number; maxMs: number };

class LoadProfiler {
  phases = new Map<string, PhaseStats>();
  cacheHits = 0;
  esbuildCacheHits = 0;
  cacheMisses = 0;
  callCount = 0;
  totalMs = 0;
  slowest: Array<{ file: string; ms: number }> = [];
  private dumped = false;
  private rootFallback = '';

  constructor() {
    process.on('exit', () => {
      if (!this.dumped) this.dump(this.rootFallback);
    });
  }

  setRoot(root: string): void {
    this.rootFallback = root;
  }

  private ensure(phase: string): PhaseStats {
    let s = this.phases.get(phase);
    if (!s) { s = { totalMs: 0, count: 0, maxMs: 0 }; this.phases.set(phase, s); }
    return s;
  }

  record(phase: string, ms: number): void {
    const s = this.ensure(phase);
    s.totalMs += ms;
    s.count++;
    if (ms > s.maxMs) s.maxMs = ms;
  }

  recordFile(file: string, ms: number): void {
    this.callCount++;
    this.totalMs += ms;
    // Keep top-N slowest
    if (this.slowest.length < LOAD_PROFILE_TOP || ms > this.slowest[this.slowest.length - 1]!.ms) {
      this.slowest.push({ file, ms });
      this.slowest.sort((a, b) => b.ms - a.ms);
      if (this.slowest.length > LOAD_PROFILE_TOP) this.slowest.length = LOAD_PROFILE_TOP;
    }
  }

  dump(root: string): void {
    if (this.dumped) return;
    this.dumped = true;
    const p = (label: string) => `[xmdx:load-profiler] ${label}`;
    console.info(p(`calls=${this.callCount} total=${this.totalMs.toFixed(0)}ms`));
    console.info(p(`esbuild-cache-hit=${this.esbuildCacheHits} compilation-cache-hit=${this.cacheHits} cache-miss=${this.cacheMisses}`));
    for (const [phase, s] of this.phases) {
      console.info(p(`${phase} total=${s.totalMs.toFixed(0)}ms avg=${s.count ? (s.totalMs / s.count).toFixed(2) : 0}ms max=${s.maxMs.toFixed(2)}ms count=${s.count}`));
    }
    const overhead = this.totalMs - [...this.phases.values()].reduce((a, s) => a + s.totalMs, 0);
    console.info(p(`overhead total=${overhead.toFixed(0)}ms avg=${this.callCount ? (overhead / this.callCount).toFixed(2) : 0}ms`));
    if (this.slowest.length > 0) {
      console.info(p(`top ${this.slowest.length} slowest files:`));
      for (const { file, ms } of this.slowest) {
        console.info(p(`  ${ms.toFixed(0)}ms ${file.replace(root, '')}`));
      }
    }
  }
}

const loadProfiler = LOAD_PROFILE ? new LoadProfiler() : null;

// Import from extracted vite-plugin modules
import type {
  XmdxBinding,
  XmdxCompiler,
  CompileResult,
  MdxBatchCompileResult,
  XmdxPluginOptions,
} from './vite-plugin/types.js';
import { loadXmdxBinding, ENABLE_SHIKI, IS_MDAST } from './vite-plugin/binding-loader.js';
import { compileFallbackModule } from './vite-plugin/jsx-module.js';
import { wrapMdxModule } from './vite-plugin/mdx-wrapper.js';
import { normalizeStarlightComponents } from './vite-plugin/normalize-config.js';
import { ShikiManager } from './vite-plugin/shiki-manager.js';

/**
 * Resolves library configuration from options.
 * Supports both new `libraries` API and legacy `starlightComponents` option.
 */
export function resolveLibraries(options: XmdxPluginOptions): {
  libraries: ComponentLibrary[];
  registry: Registry;
} {
  // New API: explicit libraries array
  if (Array.isArray(options.libraries)) {
    const registry = createRegistry(options.libraries);
    return { libraries: options.libraries, registry };
  }

  // Legacy API: derive libraries from starlightComponents option
  const libraries: ComponentLibrary[] = [astroLibrary];

  if (options.starlightComponents) {
    libraries.push(starlightLibrary);
  }

  const registry = createRegistry(libraries);
  return { libraries, registry };
}

// require() for CJS interop with glob package
const require = createRequire(import.meta.url);

/**
 * Collects hooks from an array of plugins, organizing them by hook type.
 */
function collectHooks(plugins: XmdxPlugin[]): PluginHooks {
  const hooks: PluginHooks = {
    afterParse: [],
    beforeInject: [],
    beforeOutput: [],
    preprocess: [],
  };

  // Sort plugins: 'pre' first, then undefined, then 'post'
  const sorted = [...plugins].sort((a, b) => {
    const order: Record<string, number> = { pre: 0, undefined: 1, post: 2 };
    const aOrder = order[a.enforce ?? 'undefined'] ?? 1;
    const bOrder = order[b.enforce ?? 'undefined'] ?? 1;
    return aOrder - bOrder;
  });

  for (const plugin of sorted) {
    if (plugin.afterParse) hooks.afterParse.push(plugin.afterParse);
    if (plugin.beforeInject) hooks.beforeInject.push(plugin.beforeInject);
    if (plugin.beforeOutput) hooks.beforeOutput.push(plugin.beforeOutput);
    if (plugin.preprocess) hooks.preprocess.push(plugin.preprocess);
  }

  return hooks;
}

/**
 * Creates the Xmdx Vite plugin that intercepts `.md`/`.mdx` files
 * before `@astrojs/mdx` runs.
 */
export function xmdxPlugin(userOptions: XmdxPluginOptions = {}): Plugin {
  let compiler: XmdxCompiler | undefined;
  let resolvedConfig: ResolvedConfig | undefined;
  const sourceLookup = new Map<string, string>();
  type CachedModuleResult = NonNullable<import('./vite-plugin/types.js').ModuleBatchCompileResult['results'][number]['result']> & {
    originalSource?: string;
    processedSource?: string;
  };
  type CachedMdxResult = NonNullable<MdxBatchCompileResult['results'][number]['result']> & {
    originalSource?: string;
    processedSource?: string;
  };
  const originalSourceCache = new Map<string, string>();   // Raw markdown before preprocess hooks
  const processedSourceCache = new Map<string, string>();  // Preprocessed markdown fed to compiler
  const moduleCompilationCache = new Map<string, CachedModuleResult>();  // MD files compiled to modules via Rust
  const mdxCompilationCache = new Map<string, CachedMdxResult>();        // MDX files compiled via mdxjs-rs
  const esbuildCache = new Map<string, { code: string; map?: SourceMapInput }>();  // Pre-compiled esbuild results
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
  let buildPassCount = 0;
  const persistentCache = {
    esbuild: new Map<string, { code: string; map?: SourceMapInput }>(),
    moduleCompilation: new Map<string, CachedModuleResult>(),
    mdxCompilation: new Map<string, CachedMdxResult>(),
    fallbackFiles: new Set<string>(),
    fallbackReasons: new Map<string, string>(),
  };
  const fallbackReasons = new Map<string, string>();
  const processedFiles = new Set<string>();
  let totalProcessingTimeMs = 0;

  // Disk cache for cross-build persistence (enabled by XMDX_DISK_CACHE=1 or options.cache)
  const diskCacheEnabled = process.env.XMDX_DISK_CACHE === '1' || userOptions.cache === true;
  let diskCache: DiskCache | null = null;

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
  const expressiveCode = resolveExpressiveCodeConfig(
    userOptions.expressiveCode ?? false
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

  // Resolve libraries and create registry
  const { registry } = resolveLibraries(userOptions);

  // Track whether Starlight is configured for gating default directive handling
  const hasStarlightConfigured = Boolean(userOptions.starlightComponents) ||
    (Array.isArray(userOptions.libraries) &&
     userOptions.libraries.some(lib => lib === starlightLibrary));

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

  // ExpressiveCode pre-rendering manager for build-time code highlighting
  const ecManager = new ExpressiveCodeManager(expressiveCode);

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
      if (config.esbuild == null) {
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
      if (!exclude.includes('xmdx-napi')) {
        exclude.push('xmdx-napi');
      }
      optimizeDeps.exclude = exclude;
      (config as Record<string, any>).optimizeDeps = optimizeDeps;

      const ssr = (config as Record<string, any>).ssr ?? {};
      const ssrExternal: string[] = ssr.external ?? [];
      if (!ssrExternal.includes('xmdx-napi')) {
        ssrExternal.push('xmdx-napi');
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
      // Only batch compile in build mode (not dev/serve)
      if (resolvedConfig?.command !== 'build') return;

      buildPassCount++;
      debugLog(`Build pass ${buildPassCount}`);

      // Initialize disk cache on first pass
      if (buildPassCount === 1 && diskCacheEnabled && !diskCache) {
        diskCache = new DiskCache(resolvedConfig.root, true);
        await diskCache.init();
        // PERF: Batch-load all cache entries into memory to avoid per-file I/O
        const preloaded = await diskCache.preloadEntries();
        const stats = diskCache.getStats();
        if (stats.entries > 0) {
          console.info(`[xmdx] Disk cache enabled (${stats.entries} cached entries, ${preloaded} preloaded)`);
        }
      }

      // Pass 2+: Reuse cached results from previous build pass (SSR → Client)
      if (buildPassCount > 1 && persistentCache.esbuild.size > 0) {
        debugTime('buildStart:total');
        debugLog(`Reusing ${persistentCache.esbuild.size} cached esbuild results from pass ${buildPassCount - 1}`);

        // Restore all caches from persistent storage
        for (const [k, v] of persistentCache.esbuild) {
          esbuildCache.set(k, v);
        }
        for (const [k, v] of persistentCache.moduleCompilation) {
          moduleCompilationCache.set(k, v);
        }
        for (const [k, v] of persistentCache.mdxCompilation) {
          mdxCompilationCache.set(k, v);
        }
        for (const file of persistentCache.fallbackFiles) {
          fallbackFiles.add(file);
        }
        for (const [k, v] of persistentCache.fallbackReasons) {
          fallbackReasons.set(k, v);
        }

        console.info(
          `[xmdx] Build pass ${buildPassCount}: Reusing ${persistentCache.esbuild.size} cached results`
        );
        debugTimeEnd('buildStart:total');
        return;
      }

      // Check for potential cache inconsistency
      const root = resolvedConfig.root;
      const astroDir = path.join(root, '.astro');
      const distDir = path.join(root, 'dist');
      if (existsSync(astroDir) && !existsSync(distDir)) {
        console.warn('[xmdx] Stale cache detected (.astro exists but dist does not). Consider running `rm -rf .astro` if you encounter module resolution errors.');
      }

      debugTime('buildStart:total');
      debugTime('buildStart:glob');

      // Find all MD/MDX files (use CJS require to avoid Vite's module runner)
      const { glob } = require('glob') as {
        glob: (
          pattern: string,
          options: { cwd: string; ignore: string[]; absolute: boolean }
        ) => Promise<string[]>;
      };
      const files = await glob('**/*.{md,mdx}', {
        cwd: resolvedConfig.root,
        ignore: [...DEFAULT_IGNORE_PATTERNS],
        absolute: true,
      });

      debugTimeEnd('buildStart:glob');
      debugLog(`Found ${files.length} markdown files`);

      if (files.length === 0) {
        debugTimeEnd('buildStart:total');
        return;
      }

      debugTime('buildStart:readFiles');

      // Track fallback pattern statistics
      const fallbackStats = {
        disallowedImports: 0,
        noAllowImports: 0,
      };
      const disallowedImportSources = new Map<string, number>();

      // Track source hashes for disk cache
      const sourceHashes = new Map<string, string>();
      let diskCacheHits = 0;

      // Read all files in parallel and prepare batch inputs
      const inputsOrNull = await Promise.all(
        files.map(async (file) => {
          const rawSource = await readFile(file, 'utf8');
          let processedSource = rawSource;

          // Apply preprocess hooks (same as load hook does)
          for (const preprocessHook of hooks.preprocess) {
            processedSource = preprocessHook(processedSource, file);
          }

          // Pre-detect problematic patterns - these files will be handled by Astro's MDX plugin
          const detection = detectProblematicMdxPatterns(processedSource, mdxOptions, file);
          if (detection.hasProblematicPatterns) {
            fallbackFiles.add(file);
            fallbackReasons.set(file, detection.reason ?? 'Unknown pattern');

            // Track statistics
            if (detection.disallowedImports && detection.disallowedImports.length > 0) {
              fallbackStats.disallowedImports++;
              for (const src of detection.disallowedImports) {
                disallowedImportSources.set(src, (disallowedImportSources.get(src) ?? 0) + 1);
              }
            } else if (detection.allImports && detection.allImports.length > 0) {
              fallbackStats.noAllowImports++;
            }

            return null;
          }

          // Compute content hash for disk cache
          const contentHash = DiskCache.computeHash(processedSource);
          sourceHashes.set(file, contentHash);

          // Check disk cache for cached esbuild result
          if (diskCache) {
            const cached = await diskCache.get(file, contentHash);
            if (cached) {
              // Direct cache hit - use cached esbuild result
              esbuildCache.set(file, { code: cached.code, map: cached.map });
              diskCacheHits++;
              processedFiles.add(file);
              return null; // Skip compilation
            }
          }

          originalSourceCache.set(file, rawSource);       // For TransformContext.source
          processedSourceCache.set(file, processedSource); // For potential reuse in cache fast path
          return { id: file, source: processedSource, filepath: file, contentHash };
        })
      );

      if (diskCacheHits > 0) {
        debugLog(`Disk cache hits: ${diskCacheHits}/${files.length} files`);
        console.info(`[xmdx] Disk cache: ${diskCacheHits} files loaded from cache`);
      }

      debugTimeEnd('buildStart:readFiles');

      const inputs = inputsOrNull.filter(
        (i): i is NonNullable<typeof i> => i !== null
      );

      if (fallbackFiles.size > 0) {
        const breakdown: string[] = [];
        if (fallbackStats.disallowedImports > 0) {
          breakdown.push(`${fallbackStats.disallowedImports} with disallowed imports`);
        }

        console.info(
          `[xmdx] Pre-detected ${fallbackFiles.size} files with patterns incompatible with markdown-rs (delegating to Astro MDX)` +
          (breakdown.length > 0 ? ` [${breakdown.join(', ')}]` : '')
        );

        // Log top disallowed import sources for debugging when many files fallback
        if (disallowedImportSources.size > 0 && fallbackFiles.size >= 10) {
          const topSources = Array.from(disallowedImportSources.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([src, count]) => `${src} (${count})`);
          console.info(
            `[xmdx] Top disallowed import sources: ${topSources.join(', ')}`
          );
          console.info(
            `[xmdx] Tip: Add these to your preset's allowImports to reduce fallback rate`
          );
        }
      }

      if (inputs.length === 0) {
        debugTimeEnd('buildStart:total');
        return;
      }

      try {
        debugTime('buildStart:batchCompile');
        debugTime('buildStart:shikiInit');

        // Start Shiki and ExpressiveCode init in parallel with batch compile
        const shikiPromise = shikiManager.init();
        const ecPromise = ecManager.init();

        // Separate MD and MDX files for different compilation paths
        const mdInputs = inputs.filter(i => !i.filepath?.endsWith('.mdx'));
        const mdxInputs = inputs.filter(i => i.filepath?.endsWith('.mdx'));

        debugLog(`Separated: ${mdInputs.length} MD files, ${mdxInputs.length} MDX files`);

        // Batch compile with parallel processing
        const binding = providedBinding ?? (await loadXmdxBinding());

        // Compile MD files to complete Astro modules via Rust (no TypeScript wrapping needed)
        let mdStats = { succeeded: 0, total: 0, failed: 0, processingTimeMs: 0 };
        if (mdInputs.length > 0) {
          const mdBatchResult = binding.compileBatchToModule(mdInputs, {
            continueOnError: true,
            config: compilerOptions,
          });
          mdStats = mdBatchResult.stats;

          // Cache MD module results
          for (const result of mdBatchResult.results) {
            if (result.result) {
              moduleCompilationCache.set(result.id, {
                ...result.result,
                originalSource: originalSourceCache.get(result.id),
                processedSource: processedSourceCache.get(result.id),
              });
            } else if (result.error) {
              // Track compilation failures for fallback
              fallbackFiles.add(result.id);
              fallbackReasons.set(result.id, result.error);
            }
          }
        }

        // Compile MDX files with mdxjs-rs
        let mdxStats = { succeeded: 0, total: 0, failed: 0, processingTimeMs: 0 };
        if (mdxInputs.length > 0) {
          const mdxBatchResult = binding.compileMdxBatch(mdxInputs, {
            continueOnError: true,
            config: compilerOptions,
          });
          mdxStats = mdxBatchResult.stats;

          // Cache MDX results
          for (const result of mdxBatchResult.results) {
            if (result.result) {
              mdxCompilationCache.set(result.id, {
                ...result.result,
                originalSource: originalSourceCache.get(result.id),
                processedSource: processedSourceCache.get(result.id),
              });
            } else if (result.error) {
              // Track MDX compilation failures for fallback
              fallbackFiles.add(result.id);
              fallbackReasons.set(result.id, result.error);
            }
          }
        }

        debugTimeEnd('buildStart:batchCompile');

        const totalSucceeded = mdStats.succeeded + mdxStats.succeeded;
        const totalFiles = mdStats.total + mdxStats.total;
        const totalTime = mdStats.processingTimeMs + mdxStats.processingTimeMs;

        console.info(
          `[xmdx] Batch compiled ${totalSucceeded}/${totalFiles} files in ${totalTime.toFixed(0)}ms` +
          (mdxInputs.length > 0 ? ` (${mdxStats.succeeded} MDX via mdxjs-rs)` : '')
        );

        // Batch esbuild transformation for fast-path eligible files
        const esbuildStartTime = performance.now();
        const jsxInputs: Array<{ id: string; virtualId: string; jsx: string; contentHash?: string }> = [];

        // Wait for Shiki and ExpressiveCode initialization (started in parallel with batch compile)
        const [resolvedShiki, resolvedEc] = await Promise.all([shikiPromise, ecPromise]);
        debugTimeEnd('buildStart:shikiInit');

        // Normalize starlightComponents for TransformContext
        const normalizedStarlightComponents = normalizeStarlightComponents(starlightComponents);

        debugTime('buildStart:pipelineProcessing');

        // Collect all compiled entries for batch esbuild processing
        // MD files: complete modules from Rust (no TypeScript wrapping)
        // MDX files: wrapped via wrapMdxModule (mdxjs-rs output)
        const mdModuleEntries: Array<[string, CachedModuleResult]> = [];
        for (const [filename, cached] of moduleCompilationCache) {
          mdModuleEntries.push([filename, cached]);
        }

        // MDX files use the mdxjs-rs output directly
        const mdxFastPathEntries: Array<[string, CachedMdxResult]> = [];
        for (const [filename, cached] of mdxCompilationCache) {
          mdxFastPathEntries.push([filename, cached]);
        }

        // Process MD module entries in chunks (complete modules from Rust)
        const PIPELINE_CHUNK_SIZE = 50;
        for (let i = 0; i < mdModuleEntries.length; i += PIPELINE_CHUNK_SIZE) {
          const chunk = mdModuleEntries.slice(i, i + PIPELINE_CHUNK_SIZE);
          const chunkResults = await Promise.all(
            chunk.map(async ([filename, cached]) => {
              // PERF: Parse frontmatter with caching
              const frontmatter = parseFrontmatterCached(cached.frontmatterJson, filename);
              const headings = cached.headings || [];

              // Use complete module code from Rust (no wrapHtmlInJsxModule needed)
              const jsxCode = cached.code;

              // Get source for hooks
              const sourceForHooks =
                originalSourceCache.get(filename) ??
                cached.originalSource ??
                processedSourceCache.get(filename) ??
                cached.processedSource ??
                '';

              // Create transform context and run pipeline
              const ctx: TransformContext = {
                code: jsxCode,
                source: sourceForHooks,
                filename,
                frontmatter,
                headings,
                registry,
                config: {
                  expressiveCode,
                  starlightComponents: normalizedStarlightComponents,
                  shiki: shikiManager.forCode(jsxCode, resolvedShiki),
                },
              };

              const transformed = await transformPipeline(ctx);

              // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks
              // This ensures proper CSS/JS injection via Starlight's EC integration
              const finalCode = transformed.code;

              const virtualId = `${VIRTUAL_MODULE_PREFIX}${filename}${OUTPUT_EXTENSION}`;
              const contentHash = sourceHashes.get(filename);
              return { id: filename, virtualId, jsx: finalCode, contentHash };
            })
          );
          jsxInputs.push(...chunkResults);
        }

        // Process MDX files in chunks (mdxjs-rs output is already JavaScript)
        for (let i = 0; i < mdxFastPathEntries.length; i += PIPELINE_CHUNK_SIZE) {
          const chunk = mdxFastPathEntries.slice(i, i + PIPELINE_CHUNK_SIZE);
          const chunkResults = await Promise.all(
            chunk.map(async ([filename, cached]) => {
              // PERF: Parse frontmatter with caching
              const frontmatter = parseFrontmatterCached(cached.frontmatterJson, filename);
              const headings = cached.headings || [];

              // Wrap MDX output in Astro component format
              const jsxCode = wrapMdxModule(cached.code, {
                frontmatter,
                headings,
                registry,
              }, filename);

              // Get source for hooks
              const sourceForHooks =
                originalSourceCache.get(filename) ??
                cached.originalSource ??
                processedSourceCache.get(filename) ??
                cached.processedSource ??
                '';

              // Create transform context and run pipeline
              const ctx: TransformContext = {
                code: jsxCode,
                source: sourceForHooks,
                filename,
                frontmatter,
                headings,
                registry,
                config: {
                  expressiveCode,
                  starlightComponents: normalizedStarlightComponents,
                  shiki: shikiManager.forCode(jsxCode, resolvedShiki),
                },
              };

              const transformed = await transformPipeline(ctx);

              // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks
              const finalCode = transformed.code;

              const virtualId = `${VIRTUAL_MODULE_PREFIX}${filename}${OUTPUT_EXTENSION}`;
              const contentHash = sourceHashes.get(filename);
              return { id: filename, virtualId, jsx: finalCode, contentHash };
            })
          );
          jsxInputs.push(...chunkResults);
        }

        debugTimeEnd('buildStart:pipelineProcessing');
        debugLog(`Pipeline processed ${jsxInputs.length} files for esbuild batch (${mdModuleEntries.length} MD modules, ${mdxFastPathEntries.length} MDX)`);

        if (jsxInputs.length > 0) {
          debugTime('buildStart:esbuild');

          // Batch transform all JSX through esbuild
          // Use parallel workers for large batches (>= 100 files)
          try {
            const useParallel = jsxInputs.length >= 100;

            let usedParallel = false;
            if (useParallel) {
              // Parallel worker-based esbuild for large batches
              try {
                debugLog(`Using parallel esbuild workers for ${jsxInputs.length} files`);
                const parallelResults = await runParallelEsbuild(
                  jsxInputs.map((input) => ({ id: input.id, jsx: input.jsx }))
                );
                for (const [id, result] of parallelResults) {
                  esbuildCache.set(id, { code: result.code, map: result.map as SourceMapInput });
                }
                usedParallel = true;
              } catch (workerErr) {
                // Workers failed - fall through to single-threaded mode
                debugLog(`Worker esbuild failed, falling back to single-threaded: ${workerErr}`);
              }
            }

            if (!usedParallel) {
              // Single-threaded esbuild for small batches (lower overhead)
              const entryMap = new Map<string, { id: string; jsx: string }>();
              for (let i = 0; i < jsxInputs.length; i++) {
                const entry = `entry${i}.jsx`;
                const input = jsxInputs[i]!;
                entryMap.set(entry, { id: input.id, jsx: input.jsx });
              }

              const result: BuildResult = await esbuildBuild({
                write: false,
                bundle: false,
                format: 'esm',
                sourcemap: 'external',
                loader: { '.jsx': 'jsx' },
                jsx: 'transform',
                jsxFactory: '_jsx',
                jsxFragment: '_Fragment',
                entryPoints: Array.from(entryMap.keys()),
                outdir: 'out',
                plugins: [
                  {
                    name: 'xmdx-virtual-jsx',
                    setup(build) {
                      build.onResolve({ filter: /^entry\d+\.jsx$/ }, (args) => {
                        return { path: args.path, namespace: 'xmdx-jsx' };
                      });
                      build.onResolve({ filter: /.*/ }, (args) => {
                        return { path: args.path, external: true };
                      });
                      build.onLoad({ filter: /.*/, namespace: 'xmdx-jsx' }, (args) => {
                        const entry = entryMap.get(args.path);
                        return entry ? { contents: entry.jsx, loader: 'jsx' } : null;
                      });
                    },
                  },
                ],
              });

              for (const output of result.outputFiles || []) {
                const basename = path.basename(output.path);
                if (basename.endsWith('.map')) continue;
                const entryName = basename.replace(/\.js$/, '.jsx');
                const entry = entryMap.get(entryName);
                if (entry) {
                  const mapOutput = result.outputFiles?.find((o) => o.path === output.path + '.map');
                  esbuildCache.set(entry.id, {
                    code: output.text,
                    map: mapOutput?.text as SourceMapInput | undefined,
                  });
                }
              }
            }

            const esbuildEndTime = performance.now();
            console.info(
              `[xmdx] Batch esbuild transformed ${esbuildCache.size} files in ${(esbuildEndTime - esbuildStartTime).toFixed(0)}ms` +
                (usedParallel ? ' (parallel workers)' : '')
            );

            debugTimeEnd('buildStart:esbuild');

            // Write newly compiled results to disk cache
            if (diskCache) {
              debugTime('buildStart:diskCacheWrite');
              const entriesToCache: Array<{
                filename: string;
                sourceHash: string;
                code: string;
                map?: SourceMapInput;
              }> = [];

              // Build hash lookup from jsxInputs
              const inputHashMap = new Map<string, string>();
              for (const input of jsxInputs) {
                if (input.contentHash) {
                  inputHashMap.set(input.id, input.contentHash);
                }
              }

              // Collect entries that need to be cached
              for (const [id, cached] of esbuildCache) {
                const hash = inputHashMap.get(id);
                if (hash) {
                  entriesToCache.push({
                    filename: id,
                    sourceHash: hash,
                    code: cached.code,
                    map: cached.map,
                  });
                }
              }

              if (entriesToCache.length > 0) {
                await diskCache.setBatch(entriesToCache);
                await diskCache.flush();
                debugLog(`Wrote ${entriesToCache.length} entries to disk cache`);
              }
              debugTimeEnd('buildStart:diskCacheWrite');
            }
          } catch (esbuildErr) {
            debugTimeEnd('buildStart:esbuild');
            this.warn(
              `[xmdx] Batch esbuild failed, will use individual transforms: ${esbuildErr}`
            );
          }
        }

        // Persist caches for subsequent build passes (SSR → Client)
        for (const [k, v] of esbuildCache) {
          persistentCache.esbuild.set(k, v);
        }
        for (const [k, v] of moduleCompilationCache) {
          persistentCache.moduleCompilation.set(k, v);
        }
        for (const [k, v] of mdxCompilationCache) {
          persistentCache.mdxCompilation.set(k, v);
        }
        for (const file of fallbackFiles) {
          persistentCache.fallbackFiles.add(file);
        }
        for (const [k, v] of fallbackReasons) {
          persistentCache.fallbackReasons.set(k, v);
        }
        debugLog(`Persisted ${persistentCache.esbuild.size} esbuild results for subsequent passes`);

        debugTimeEnd('buildStart:total');
      } catch (err) {
        debugTimeEnd('buildStart:total');
        this.warn(
          `[xmdx] Batch compile skipped due to binding load failure: ${err}`
        );
      }
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
      if (!id.startsWith(VIRTUAL_MODULE_PREFIX)) {
        return null;
      }
      const filename =
        sourceLookup.get(id) ??
        stripQuery(id.slice(VIRTUAL_MODULE_PREFIX.length).replace(new RegExp(`${OUTPUT_EXTENSION.replace('.', '\\.')}$`), ''));

      try {
        // FALLBACK PATH: Files with problematic patterns use @mdx-js/mdx
        // This handles files that were pre-detected in buildStart or resolveId
        if (fallbackFiles.has(filename)) {
          const source = await readFile(filename, 'utf8');
          let processedSource = source;
          for (const preprocessHook of hooks.preprocess) {
            processedSource = preprocessHook(processedSource, filename);
          }
          // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks
          return compileFallbackModule(filename, processedSource, id, registry, hasStarlightConfigured);
        }

        // FASTEST PATH: Check esbuild cache first (O(1) lookup, populated in buildStart)
        const loadStart = LOAD_PROFILE ? performance.now() : 0;
        const cachedEsbuildResult = esbuildCache.get(filename);
        if (cachedEsbuildResult) {
          processedFiles.add(filename);
          if (loadProfiler) {
            const elapsed = performance.now() - loadStart;
            loadProfiler.esbuildCacheHits++;
            loadProfiler.recordFile(filename, elapsed);
          }
          return cachedEsbuildResult;
        }

        // Check cache FIRST, before any file I/O (populated in build mode by buildStart)
        const cachedModule = moduleCompilationCache.get(filename);
        const cachedMdx = mdxCompilationCache.get(filename);
        const isMdx = filename.endsWith('.mdx');

        // FAST PATH: MD files with complete modules from Rust
        if (cachedModule && !isMdx) {
          const startTime = performance.now();
          // PERF: Parse frontmatter with caching
          const frontmatter = parseFrontmatterCached(cachedModule.frontmatterJson, filename);
          const headings = cachedModule.headings || [];

          // Use complete module code from Rust (no wrapHtmlInJsxModule needed)
          const result: CompileResult = {
            code: cachedModule.code,
            map: null,
            frontmatter_json: cachedModule.frontmatterJson,
            headings,
            imports: [],
          };

          const endTime = performance.now();
          totalProcessingTimeMs += endTime - startTime;
          processedFiles.add(filename);

          const normalizedStarlightComponents = normalizeStarlightComponents(starlightComponents);
          const sourceForHooks =
            originalSourceCache.get(filename) ??
            cachedModule.originalSource ??
            processedSourceCache.get(filename) ??
            cachedModule.processedSource ??
            (await readFile(filename, 'utf8'));
          const ctx: TransformContext = {
            code: result.code,
            source: sourceForHooks,
            filename,
            frontmatter,
            headings,
            registry,
            config: {
              expressiveCode,
              starlightComponents: normalizedStarlightComponents,
              shiki: await shikiManager.getFor(result.code),
            },
          };

          const tpStart = LOAD_PROFILE ? performance.now() : 0;
          const transformed = await transformPipeline(ctx);
          result.code = transformed.code;
          if (loadProfiler) loadProfiler.record('transform-pipeline', performance.now() - tpStart);

          // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks

          const esStart = LOAD_PROFILE ? performance.now() : 0;
          const esbuildResult = await transformWithEsbuild(result.code, id, ESBUILD_JSX_CONFIG);
          if (loadProfiler) loadProfiler.record('esbuild', performance.now() - esStart);

          if (loadProfiler) {
            const elapsed = performance.now() - loadStart;
            loadProfiler.cacheHits++;
            loadProfiler.recordFile(filename, elapsed);
          }

          return {
            code: esbuildResult.code,
            map: esbuildResult.map ?? result.map ?? undefined,
          };
        }

        // FAST PATH: MDX files compiled via mdxjs-rs
        if (cachedMdx && isMdx) {
          const startTime = performance.now();
          // PERF: Parse frontmatter with caching
          const frontmatter = parseFrontmatterCached(cachedMdx.frontmatterJson, filename);
          const headings = cachedMdx.headings || [];

          // Wrap MDX output in Astro component format
          const jsxCode = wrapMdxModule(cachedMdx.code, {
            frontmatter,
            headings,
            registry,
          }, filename);

          const result: CompileResult = {
            code: jsxCode,
            map: null,
            frontmatter_json: cachedMdx.frontmatterJson,
            headings,
            imports: [],
          };

          const endTime = performance.now();
          totalProcessingTimeMs += endTime - startTime;
          processedFiles.add(filename);

          const normalizedStarlightComponents = normalizeStarlightComponents(starlightComponents);
          const sourceForHooks =
            originalSourceCache.get(filename) ??
            cachedMdx.originalSource ??
            processedSourceCache.get(filename) ??
            cachedMdx.processedSource ??
            (await readFile(filename, 'utf8'));
          const ctx: TransformContext = {
            code: result.code,
            source: sourceForHooks,
            filename,
            frontmatter,
            headings,
            registry,
            config: {
              expressiveCode,
              starlightComponents: normalizedStarlightComponents,
              shiki: await shikiManager.getFor(result.code),
            },
          };

          const tpStart = LOAD_PROFILE ? performance.now() : 0;
          const transformed = await transformPipeline(ctx);
          result.code = transformed.code;
          if (loadProfiler) loadProfiler.record('transform-pipeline', performance.now() - tpStart);

          // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks

          const esStart = LOAD_PROFILE ? performance.now() : 0;
          const esbuildResult = await transformWithEsbuild(result.code, id, ESBUILD_JSX_CONFIG);
          if (loadProfiler) loadProfiler.record('esbuild', performance.now() - esStart);

          if (loadProfiler) {
            const elapsed = performance.now() - loadStart;
            loadProfiler.cacheHits++;
            loadProfiler.recordFile(filename, elapsed);
          }

          return {
            code: esbuildResult.code,
            map: esbuildResult.map ?? result.map ?? undefined,
          };
        }

        // Lazy initialize compiler on first use (only needed for cache miss path)
        if (loadProfiler) loadProfiler.cacheMisses++;
        const currentCompiler = await getCompiler();

        // Only read file if cache miss
        const source = await readFile(filename, 'utf8');
        originalSourceCache.set(filename, source);

        // Apply preprocess hooks
        let processedSource = source;
        for (const preprocessHook of hooks.preprocess) {
          processedSource = preprocessHook(processedSource, filename);
        }
        processedSourceCache.set(filename, processedSource);

        // Early detection of problematic patterns - skip to fallback
        // Note: Pre-detected files from buildStart are handled by resolveId returning null
        // This catches files that weren't pre-detected (e.g., preprocess hooks revealed the pattern)
        const detection = detectProblematicMdxPatterns(processedSource, mdxOptions, filename);
        if (detection.hasProblematicPatterns) {
          this.warn(
            `[xmdx] Skipping ${filename}: ${detection.reason ?? 'contains patterns incompatible with markdown-rs'}`
          );
          fallbackFiles.add(filename);
          fallbackReasons.set(filename, detection.reason ?? 'Detected problematic MDX patterns');
          // Use @mdx-js/mdx as fallback compiler for runtime-detected files
          // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks
          return compileFallbackModule(filename, processedSource, id, registry, hasStarlightConfigured);
        }

        const startTime = performance.now();
        const compileStart = LOAD_PROFILE ? performance.now() : 0;
        let result: CompileResult;
        let frontmatter: Record<string, unknown> = {};
        let headings: Array<{ depth: number; slug: string; text: string }> = [];

        // MDX files: Use mdxjs-rs for full MDX support (JSX, ESM imports, etc.)
        if (isMdx) {
          const binding = await loadXmdxBinding();

          // Compile single MDX file with mdxjs-rs
          const mdxBatchResult = binding.compileMdxBatch(
            [{ id: filename, source: processedSource }],
            { continueOnError: false, config: compilerOptions }
          );

          const mdxResult = mdxBatchResult.results[0];
          if (mdxResult?.error) {
            throw new Error(`MDX compilation failed: ${mdxResult.error}`);
          }
          if (!mdxResult?.result) {
            throw new Error(`MDX compilation returned no result for ${filename}`);
          }

          // Parse frontmatter and headings
          if (mdxResult.result.frontmatterJson) {
            try {
              frontmatter = JSON.parse(mdxResult.result.frontmatterJson) as Record<string, unknown>;
            } catch {
              frontmatter = {};
            }
          }
          headings = mdxResult.result.headings || [];

          // Wrap MDX output in Astro component format
          const jsxCode = wrapMdxModule(mdxResult.result.code, {
            frontmatter,
            headings,
            registry,
          }, filename);

          result = {
            code: jsxCode,
            map: null,
            frontmatter_json: mdxResult.result.frontmatterJson ?? '',
            headings,
            imports: [],
          };
        } else if (IS_MDAST) {
          // MD files: Use markdown-rs via parseBlocks
          const binding = await loadXmdxBinding();

          // Extract user imports BEFORE processing (user imports take precedence over registry)
          const userImports = extractImportStatements(processedSource);

          // Strip frontmatter before passing to parseBlocks
          // Otherwise the mdast pipeline renders YAML as regular text
          const contentSource = stripFrontmatter(processedSource);

          const parseResult = binding.parseBlocks(contentSource, {
            enable_directives: true,
          });
          headings = parseResult.headings;

          // Extract frontmatter from original source (before stripping)
          const frontmatterResult = binding.parseFrontmatter(processedSource);
          frontmatter = frontmatterResult.frontmatter || {};

          result = {
            code: blocksToJsx(parseResult.blocks, frontmatter, headings, registry, filename, userImports),
            map: null,
            frontmatter_json: JSON.stringify(frontmatter),
            headings,
            imports: [],
          };
        } else {
          const fileOptions = deriveFileOptions(filename, resolvedConfig?.root);
          result = currentCompiler.compile(processedSource, filename, fileOptions);
          if (result.frontmatter_json) {
            try {
              frontmatter = JSON.parse(result.frontmatter_json) as Record<string, unknown>;
            } catch {
              frontmatter = {};
            }
          }
          headings = result.headings || [];
        }

        if (loadProfiler) loadProfiler.record('compile', performance.now() - compileStart);
        const endTime = performance.now();
        totalProcessingTimeMs += endTime - startTime;
        processedFiles.add(filename);

        if (result.code == null || typeof result.code !== 'string') {
          throw new Error(`Compiler returned undefined or invalid code for ${filename}`);
        }

        if (result.diagnostics?.warnings?.length) {
          for (const warning of result.diagnostics.warnings) {
            this.warn(`[xmdx] ${filename}:${warning.line}: ${warning.message}`);
          }
        }

        const normalizedStarlightComponents = normalizeStarlightComponents(starlightComponents);
        const ctx: TransformContext = {
          code: result.code,
          source,
          filename,
          frontmatter,
          headings,
          registry,
          config: {
            expressiveCode,
            starlightComponents: normalizedStarlightComponents,
            shiki: await shikiManager.getFor(result.code),
          },
        };

        const tpStart2 = LOAD_PROFILE ? performance.now() : 0;
        const transformed = await transformPipeline(ctx);
        result.code = transformed.code;
        if (loadProfiler) loadProfiler.record('transform-pipeline', performance.now() - tpStart2);

        // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks

        if (Array.isArray(result?.imports)) {
          for (const dep of result.imports) {
            if (dep?.path) {
              this.addWatchFile(dep.path);
            }
          }
        }

        const esStart2 = LOAD_PROFILE ? performance.now() : 0;
        const esbuildResult = await transformWithEsbuild(result.code, id, ESBUILD_JSX_CONFIG);
        if (loadProfiler) loadProfiler.record('esbuild', performance.now() - esStart2);

        if (loadProfiler) {
          const elapsed = performance.now() - loadStart;
          loadProfiler.recordFile(filename, elapsed);
        }

        return {
          code: esbuildResult.code,
          map: esbuildResult.map ?? result.map ?? undefined,
        };
      } catch (error) {
        const message = (error as Error)?.message || String(error);
        const shouldFallback =
          message.includes('Vite module runner has been closed') ||
          message.includes('Markdown parser error') ||
          message.includes('Markdown parse error') ||
          message.includes('Transform failed') ||
          message.includes('Compiler returned undefined') ||
          message.includes('Cannot read properties of undefined') ||
          message.includes('Cannot read properties of null');

        if (shouldFallback) {
          fallbackFiles.add(filename);
          fallbackReasons.set(filename, message);
          this.warn(`[xmdx] Falling back to @mdx-js/mdx for ${filename}: ${message}`);

          // Try to invalidate the module in dev server mode
          const config = resolvedConfig as unknown as {
            server?: {
              moduleGraph?: {
                getModuleById: (id: string) => object | null;
                invalidateModule: (mod: object) => void;
              };
            };
          };
          if (config?.server?.moduleGraph) {
            const mod = config.server.moduleGraph.getModuleById(id);
            if (mod) {
              config.server.moduleGraph.invalidateModule(mod);
            }
          }

          // Re-read and process the file for fallback compilation
          const fallbackSource = await readFile(filename, 'utf8');
          let processedFallbackSource = fallbackSource;
          for (const preprocessHook of hooks.preprocess) {
            processedFallbackSource = preprocessHook(processedFallbackSource, filename);
          }
          // ExpressiveCode pre-rendering disabled - let Starlight handle code blocks
          return compileFallbackModule(filename, processedFallbackSource, id, registry, hasStarlightConfigured);
        }
        throw new Error(`[xmdx] Compile failed for ${filename}: ${message}`);
      }
    },

    async buildEnd() {
      if (loadProfiler) loadProfiler.dump(resolvedConfig?.root ?? '');

      // Clean up stale disk cache entries
      if (diskCache && buildPassCount === 1) {
        await diskCache.cleanup(processedFiles);
        await diskCache.flush();
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
          totalProcessingTimeMs: Math.round(totalProcessingTimeMs * 100) / 100,
          averageFileTimeMs:
            processedFiles.size > 0
              ? Math.round((totalProcessingTimeMs / processedFiles.size) * 100) / 100
              : 0,
        },
      };

      const outputPath = path.join(resolvedConfig?.root ?? '.', 'xmdx-stats.json');
      await writeFile(outputPath, JSON.stringify(stats, null, 2));
      console.info(`[xmdx] Stats written to ${outputPath}`);
    },
  };
}
