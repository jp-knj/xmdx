/**
 * Xmdx Vite plugin for MDX compilation.
 * @module vite-plugin
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { transformWithEsbuild, type ResolvedConfig, type Plugin } from 'vite';
import MagicString from 'magic-string';
import { build as esbuildBuild, type BuildResult } from 'esbuild';
import type { SourceMapInput } from 'rollup';
import {
  createRegistry,
  starlightLibrary,
  astroLibrary,
  expressiveCodeLibrary,
  type ComponentLibrary,
  type Registry,
} from 'xmdx/registry';
import { createPipeline } from './pipeline/index.js';
import { blocksToJsx } from './transforms/blocks-to-jsx.js';
import { resolveExpressiveCodeConfig } from './utils/config.js';
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
  BatchCompileResult,
  XmdxPluginOptions,
} from './vite-plugin/types.js';
import { loadXmdxBinding, ENABLE_SHIKI, IS_MDAST } from './vite-plugin/binding-loader.js';
import { wrapHtmlInJsxModule, compileFallbackModule } from './vite-plugin/jsx-module.js';
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

  if (options.expressiveCode) {
    libraries.push(expressiveCodeLibrary);
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
  type CachedCompileResult = NonNullable<BatchCompileResult['results'][number]['result']> & {
    originalSource?: string;
    processedSource?: string;
  };
  const originalSourceCache = new Map<string, string>();   // Raw markdown before preprocess hooks
  const processedSourceCache = new Map<string, string>();  // Preprocessed markdown fed to compiler
  const compilationCache = new Map<string, CachedCompileResult>();
  const esbuildCache = new Map<string, { code: string; map?: SourceMapInput }>();  // Pre-compiled esbuild results
  const fallbackFiles = new Set<string>();
  const fallbackReasons = new Map<string, string>();
  const processedFiles = new Set<string>();
  let totalProcessingTimeMs = 0;

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

  // Build compiler options with default code_sample_components
  const compilerOptions = {
    ...(userOptions.compiler ?? {}),
    jsx: {
      ...(userOptions.compiler?.jsx ?? {}),
      code_sample_components:
        userOptions.compiler?.jsx?.code_sample_components ?? ['Code', 'Prism'],
    },
  };

  const include = userOptions.include ?? shouldCompile;
  const starlightComponents = userOptions.starlightComponents ?? false;
  const expressiveCode = resolveExpressiveCodeConfig(
    userOptions.expressiveCode ?? false
  );

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
          const detection = detectProblematicMdxPatterns(processedSource, mdxOptions);
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

          originalSourceCache.set(file, rawSource);       // For TransformContext.source
          processedSourceCache.set(file, processedSource); // For potential reuse in cache fast path
          return { id: file, source: processedSource, filepath: file };
        })
      );

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

        // Batch compile with parallel processing
        const binding = providedBinding ?? (await loadXmdxBinding());
        const batchResult = binding.compileBatch(inputs, {
          continueOnError: true,
          config: compilerOptions,
        });

        debugTimeEnd('buildStart:batchCompile');

        // Cache successful results
        for (const result of batchResult.results) {
          if (result.result) {
            compilationCache.set(result.id, {
              ...result.result,
              originalSource: originalSourceCache.get(result.id),
              processedSource: processedSourceCache.get(result.id),
            });
          }
        }

        console.info(
          `[xmdx] Batch compiled ${batchResult.stats.succeeded}/${batchResult.stats.total} files in ${batchResult.stats.processingTimeMs.toFixed(0)}ms`
        );

        // Batch esbuild transformation for fast-path eligible files
        const esbuildStartTime = performance.now();
        const jsxInputs: Array<{ id: string; virtualId: string; jsx: string }> = [];

        debugTime('buildStart:shikiInit');
        const resolvedShiki = await shikiManager.init();
        debugTimeEnd('buildStart:shikiInit');

        // Normalize starlightComponents for TransformContext
        const normalizedStarlightComponents = normalizeStarlightComponents(starlightComponents);

        debugTime('buildStart:pipelineProcessing');

        // Collect fast-path eligible entries (non-MDX, no imports, no JSX components)
        // Note: Exports are now handled by Rust and injected via wrapHtmlInJsxModule
        const fastPathEntries: Array<[string, CachedCompileResult]> = [];
        for (const [filename, cached] of compilationCache) {
          if (filename.endsWith('.mdx')) continue;
          const hasUserImports = (cached.hoistedImports?.length ?? 0) > 0;
          const hasJsxComponents = cached.html && /\{\.\.\.|\<[A-Z]/.test(cached.html);
          if (hasUserImports || hasJsxComponents) continue;
          fastPathEntries.push([filename, cached]);
        }

        // Process in chunks to bound concurrency (Shiki highlighting is async)
        const PIPELINE_CHUNK_SIZE = 50;
        for (let i = 0; i < fastPathEntries.length; i += PIPELINE_CHUNK_SIZE) {
          const chunk = fastPathEntries.slice(i, i + PIPELINE_CHUNK_SIZE);
          const chunkResults = await Promise.all(
            chunk.map(async ([filename, cached]) => {
              // Parse frontmatter
              let frontmatter: Record<string, unknown> = {};
              if (cached.frontmatterJson) {
                try {
                  frontmatter = JSON.parse(cached.frontmatterJson) as Record<string, unknown>;
                } catch {
                  frontmatter = {};
                }
              }
              const headings = cached.headings || [];

              // Wrap HTML in JSX module with hoisted exports
              const jsxCode = wrapHtmlInJsxModule(cached.html, frontmatter, headings, filename, {
                hoistedExports: cached.hoistedExports,
                hasUserDefaultExport: cached.hasUserDefaultExport,
              });

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
              const virtualId = `${VIRTUAL_MODULE_PREFIX}${filename}${OUTPUT_EXTENSION}`;
              return { id: filename, virtualId, jsx: transformed.code };
            })
          );
          jsxInputs.push(...chunkResults);
        }

        debugTimeEnd('buildStart:pipelineProcessing');
        debugLog(`Pipeline processed ${jsxInputs.length} files for esbuild batch`);

        if (jsxInputs.length > 0) {
          debugTime('buildStart:esbuild');

          // Batch transform all JSX through esbuild using virtual file plugin
          try {
            // Create a clean entry point name for each file (avoid null bytes and special chars)
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
              outdir: 'out', // Required but not used since write: false
              plugins: [{
                name: 'xmdx-virtual-jsx',
                setup(build) {
                  // Resolve all entry points to themselves
                  build.onResolve({ filter: /^entry\d+\.jsx$/ }, args => {
                    return { path: args.path, namespace: 'xmdx-jsx' };
                  });
                  // External - don't bundle
                  build.onResolve({ filter: /.*/ }, args => {
                    return { path: args.path, external: true };
                  });
                  // Load virtual JSX content
                  build.onLoad({ filter: /.*/, namespace: 'xmdx-jsx' }, args => {
                    const entry = entryMap.get(args.path);
                    return entry ? { contents: entry.jsx, loader: 'jsx' } : null;
                  });
                }
              }]
            });

            // Store results in esbuild cache
            for (const output of result.outputFiles || []) {
              // Output path format: out/entry0.js or out/entry0.js.map
              const basename = path.basename(output.path);
              if (basename.endsWith('.map')) continue; // Handle maps separately

              // Find matching input by entry name
              const entryName = basename.replace(/\.js$/, '.jsx');
              const entry = entryMap.get(entryName);

              if (entry) {
                // Find corresponding source map
                const mapOutput = result.outputFiles?.find(o =>
                  o.path === output.path + '.map'
                );
                esbuildCache.set(entry.id, {
                  code: output.text,
                  map: mapOutput?.text as SourceMapInput | undefined,
                });
              }
            }

            const esbuildEndTime = performance.now();
            console.info(
              `[xmdx] Batch esbuild transformed ${esbuildCache.size} files in ${(esbuildEndTime - esbuildStartTime).toFixed(0)}ms`
            );

            debugTimeEnd('buildStart:esbuild');
          } catch (esbuildErr) {
            debugTimeEnd('buildStart:esbuild');
            this.warn(
              `[xmdx] Batch esbuild failed, will use individual transforms: ${esbuildErr}`
            );
          }
        }

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

      // Pre-detected fallback files should be handled by Astro's MDX plugin
      // which has proper remark-directive support and user-configured plugins
      if (fallbackFiles.has(resolvedId)) {
        return null;
      }

      // Dev mode pre-detection: check if file needs fallback before returning virtualId
      // This ensures dev mode delegates problematic files to Astro MDX just like build mode does
      if (resolvedConfig?.command !== 'build') {
        try {
          const source = await readFile(resolvedId, 'utf8');
          let processedSource = source;
          for (const preprocessHook of hooks.preprocess) {
            processedSource = preprocessHook(processedSource, resolvedId);
          }
          const detection = detectProblematicMdxPatterns(processedSource, mdxOptions);
          if (detection.hasProblematicPatterns) {
            fallbackFiles.add(resolvedId);
            fallbackReasons.set(resolvedId, detection.reason ?? 'Pre-detected problematic MDX patterns (dev mode)');
            return null; // Delegate to Astro's MDX plugin
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
        const cached = compilationCache.get(filename);
        const isMdx = filename.endsWith('.mdx');

        if (cached && !isMdx) {
          const hasUserImports = (cached.hoistedImports?.length ?? 0) > 0;
          const hasJsxComponents = cached.html && /\{\.\.\.|\<[A-Z]/.test(cached.html);

          // Exports are handled by Rust and injected into the module
          if (!hasUserImports && !hasJsxComponents) {
            // FAST PATH: Use cached result without file I/O
            const startTime = performance.now();
            let frontmatter: Record<string, unknown> = {};
            if (cached.frontmatterJson) {
              try {
                frontmatter = JSON.parse(cached.frontmatterJson) as Record<string, unknown>;
              } catch {
                frontmatter = {};
              }
            }
            const headings = cached.headings || [];

            const jsxCode = wrapHtmlInJsxModule(cached.html, frontmatter, headings, filename, {
              hoistedExports: cached.hoistedExports,
              hasUserDefaultExport: cached.hasUserDefaultExport,
            });
            const result: CompileResult = {
              code: jsxCode,
              map: null,
              frontmatter_json: cached.frontmatterJson,
              headings,
              imports: [],
            };

            const endTime = performance.now();
            totalProcessingTimeMs += endTime - startTime;
            processedFiles.add(filename);

            const normalizedStarlightComponents = normalizeStarlightComponents(starlightComponents);
            const sourceForHooks =
              originalSourceCache.get(filename) ??
              cached.originalSource ??
              processedSourceCache.get(filename) ??
              cached.processedSource ??
              (await readFile(filename, 'utf8'));
            const ctx: TransformContext = {
              code: result.code,
              source: sourceForHooks, // Preserve markdown for user hooks
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
        const detection = detectProblematicMdxPatterns(processedSource, mdxOptions);
        if (detection.hasProblematicPatterns) {
          this.warn(
            `[xmdx] Skipping ${filename}: ${detection.reason ?? 'contains patterns incompatible with markdown-rs'}`
          );
          fallbackFiles.add(filename);
          fallbackReasons.set(filename, detection.reason ?? 'Detected problematic MDX patterns');
          // Use @mdx-js/mdx as fallback compiler for runtime-detected files
          return compileFallbackModule(filename, processedSource, id, registry, hasStarlightConfigured);
        }

        const startTime = performance.now();
        const compileStart = LOAD_PROFILE ? performance.now() : 0;
        let result: CompileResult;
        let frontmatter: Record<string, unknown> = {};
        let headings: Array<{ depth: number; slug: string; text: string }> = [];

        if (IS_MDAST) {
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
          return compileFallbackModule(filename, processedFallbackSource, id, registry, hasStarlightConfigured);
        }
        throw new Error(`[xmdx] Compile failed for ${filename}: ${message}`);
      }
    },

    async buildEnd() {
      if (loadProfiler) loadProfiler.dump(resolvedConfig?.root ?? '');

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
