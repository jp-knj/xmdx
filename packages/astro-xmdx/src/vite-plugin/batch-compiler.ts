/**
 * Build-time batch compilation for markdown/MDX files.
 * @module vite-plugin/batch-compiler
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build as esbuildBuild, type BuildResult } from 'esbuild';
import type { SourceMapInput } from 'rollup';
import type { Registry } from 'xmdx/registry';
import type { ResolvedConfig } from 'vite';
import { runParallelEsbuild } from './esbuild-pool.js';
import { DiskCache } from './disk-cache.js';
import { wrapMdxModule } from './mdx-wrapper.js';
import { normalizeStarlightComponents } from './normalize-config.js';
import type { XmdxBinding, XmdxPluginOptions } from './types.js';
import type { PluginHooks, TransformContext, MdxImportHandlingOptions } from '../types.js';
import type { Transform } from '../pipeline/types.js';
import type { ExpressiveCodeConfig } from '../utils/config.js';
import type { ShikiManager } from './shiki-manager.js';
import type { ExpressiveCodeManager } from './expressive-code-manager.js';
import { detectProblematicMdxPatterns } from '../utils/mdx-detection.js';
import { VIRTUAL_MODULE_PREFIX, OUTPUT_EXTENSION, DEFAULT_IGNORE_PATTERNS } from '../constants.js';
import type {
  CachedMdxResult,
  CachedModuleResult,
  EsbuildCacheEntry,
  PersistentCache,
} from './cache-types.js';
import { debugLog, debugTime, debugTimeEnd } from './load-profiler.js';

const require = createRequire(import.meta.url);

interface BatchInput {
  id: string;
  source: string;
  filepath: string;
  contentHash: string;
}

interface ReadAndDetectResult {
  inputs: BatchInput[];
  sourceHashes: Map<string, string>;
  diskCacheHits: number;
}

interface BatchStats {
  succeeded: number;
  total: number;
  failed: number;
  processingTimeMs: number;
}

interface BatchCompileStatsResult {
  md: BatchStats;
  mdx: BatchStats;
}

interface BuildState {
  buildPassCount: number;
  diskCache: DiskCache | null;
}

export interface BuildStartDeps {
  resolvedConfig?: ResolvedConfig;
  state: BuildState;
  diskCacheEnabled: boolean;
  persistentCache: PersistentCache;
  originalSourceCache: Map<string, string>;
  processedSourceCache: Map<string, string>;
  moduleCompilationCache: Map<string, CachedModuleResult>;
  mdxCompilationCache: Map<string, CachedMdxResult>;
  esbuildCache: Map<string, EsbuildCacheEntry>;
  fallbackFiles: Set<string>;
  fallbackReasons: Map<string, string>;
  processedFiles: Set<string>;
  hooks: PluginHooks;
  mdxOptions?: MdxImportHandlingOptions;
  providedBinding: XmdxBinding | null;
  loadBinding: () => Promise<XmdxBinding>;
  compilerOptions: Record<string, unknown>;
  shikiManager: ShikiManager;
  ecManager: ExpressiveCodeManager;
  starlightComponents: XmdxPluginOptions['starlightComponents'];
  parseFrontmatterCached: (json: string | undefined, filename: string) => Record<string, unknown>;
  transformPipeline: Transform;
  expressiveCode: ExpressiveCodeConfig | null;
  registry: Registry;
  warn: (message: string) => void;
}

export async function batchReadAndDetectFallbacks(
  files: string[],
  hooks: PluginHooks,
  mdxOptions: MdxImportHandlingOptions | undefined,
  diskCache: DiskCache | null,
  esbuildCache: Map<string, EsbuildCacheEntry>,
  fallbackFiles: Set<string>,
  fallbackReasons: Map<string, string>,
  originalSourceCache: Map<string, string>,
  processedSourceCache: Map<string, string>,
  processedFiles: Set<string>
): Promise<ReadAndDetectResult> {
  const fallbackStats = {
    disallowedImports: 0,
    noAllowImports: 0,
  };
  const disallowedImportSources = new Map<string, number>();
  const sourceHashes = new Map<string, string>();
  let diskCacheHits = 0;

  const inputsOrNull = await Promise.all(
    files.map(async (file) => {
      const rawSource = await readFile(file, 'utf8');
      let processedSource = rawSource;

      for (const preprocessHook of hooks.preprocess) {
        processedSource = preprocessHook(processedSource, file);
      }

      const detection = detectProblematicMdxPatterns(processedSource, mdxOptions, file);
      if (detection.hasProblematicPatterns) {
        fallbackFiles.add(file);
        fallbackReasons.set(file, detection.reason ?? 'Unknown pattern');

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

      const contentHash = DiskCache.computeHash(processedSource);
      sourceHashes.set(file, contentHash);

      if (diskCache) {
        const cached = await diskCache.get(file, contentHash);
        if (cached) {
          esbuildCache.set(file, { code: cached.code, map: cached.map });
          processedFiles.add(file);
          diskCacheHits++;
          return null;
        }
      }

      originalSourceCache.set(file, rawSource);
      processedSourceCache.set(file, processedSource);
      return { id: file, source: processedSource, filepath: file, contentHash };
    })
  );

  const inputs = inputsOrNull.filter((i): i is NonNullable<typeof i> => i !== null);

  if (fallbackFiles.size > 0) {
    const breakdown: string[] = [];
    if (fallbackStats.disallowedImports > 0) {
      breakdown.push(`${fallbackStats.disallowedImports} with disallowed imports`);
    }

    console.info(
      `[xmdx] Pre-detected ${fallbackFiles.size} files with patterns incompatible with markdown-rs (delegating to Astro MDX)` +
        (breakdown.length > 0 ? ` [${breakdown.join(', ')}]` : '')
    );

    if (disallowedImportSources.size > 0 && fallbackFiles.size >= 10) {
      const topSources = Array.from(disallowedImportSources.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([src, count]) => `${src} (${count})`);
      console.info(`[xmdx] Top disallowed import sources: ${topSources.join(', ')}`);
      console.info('[xmdx] Tip: Add these to your preset\'s allowImports to reduce fallback rate');
    }
  }

  return { inputs, sourceHashes, diskCacheHits };
}

export async function batchCompileFiles(
  binding: XmdxBinding,
  mdInputs: BatchInput[],
  mdxInputs: BatchInput[],
  compilerOptions: Record<string, unknown>,
  moduleCompilationCache: Map<string, CachedModuleResult>,
  mdxCompilationCache: Map<string, CachedMdxResult>,
  fallbackFiles: Set<string>,
  fallbackReasons: Map<string, string>,
  originalSourceCache: Map<string, string>,
  processedSourceCache: Map<string, string>
): Promise<BatchCompileStatsResult> {
  let mdStats: BatchStats = { succeeded: 0, total: 0, failed: 0, processingTimeMs: 0 };
  if (mdInputs.length > 0) {
    const mdBatchResult = binding.compileBatchToModule(mdInputs, {
      continueOnError: true,
      config: compilerOptions,
    });
    mdStats = mdBatchResult.stats;

    for (const result of mdBatchResult.results) {
      if (result.result) {
        moduleCompilationCache.set(result.id, {
          ...result.result,
          originalSource: originalSourceCache.get(result.id),
          processedSource: processedSourceCache.get(result.id),
        });
      } else if (result.error) {
        fallbackFiles.add(result.id);
        fallbackReasons.set(result.id, result.error);
      }
    }
  }

  let mdxStats: BatchStats = { succeeded: 0, total: 0, failed: 0, processingTimeMs: 0 };
  if (mdxInputs.length > 0) {
    const mdxBatchResult = binding.compileMdxBatch(mdxInputs, {
      continueOnError: true,
      config: compilerOptions,
    });
    mdxStats = mdxBatchResult.stats;

    for (const result of mdxBatchResult.results) {
      if (result.result) {
        mdxCompilationCache.set(result.id, {
          ...result.result,
          originalSource: originalSourceCache.get(result.id),
          processedSource: processedSourceCache.get(result.id),
        });
      } else if (result.error) {
        fallbackFiles.add(result.id);
        fallbackReasons.set(result.id, result.error);
      }
    }
  }

  return { md: mdStats, mdx: mdxStats };
}

export async function batchEsbuildTransform(
  jsxInputs: Array<{ id: string; virtualId: string; jsx: string; contentHash?: string }>,
  esbuildCache: Map<string, EsbuildCacheEntry>,
  warn: (message: string) => void
): Promise<boolean | null> {
  if (jsxInputs.length === 0) return false;
  const useParallel = jsxInputs.length >= 100;
  let usedParallel = false;

  try {
    if (useParallel) {
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
        debugLog(`Worker esbuild failed, falling back to single-threaded: ${workerErr}`);
      }
    }

    if (!usedParallel) {
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

    return usedParallel;
  } catch (esbuildErr) {
    warn(`[xmdx] Batch esbuild failed, will use individual transforms: ${esbuildErr}`);
    return null;
  }
}

export function persistCaches(
  persistentCache: PersistentCache,
  esbuildCache: Map<string, EsbuildCacheEntry>,
  moduleCompilationCache: Map<string, CachedModuleResult>,
  mdxCompilationCache: Map<string, CachedMdxResult>,
  fallbackFiles: Set<string>,
  fallbackReasons: Map<string, string>
): void {
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
}

function restorePersistentCaches(
  persistentCache: PersistentCache,
  esbuildCache: Map<string, EsbuildCacheEntry>,
  moduleCompilationCache: Map<string, CachedModuleResult>,
  mdxCompilationCache: Map<string, CachedMdxResult>,
  fallbackFiles: Set<string>,
  fallbackReasons: Map<string, string>
): void {
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
}

async function preparePipelineInputs(
  moduleCompilationCache: Map<string, CachedModuleResult>,
  mdxCompilationCache: Map<string, CachedMdxResult>,
  parseFrontmatterCached: (json: string | undefined, filename: string) => Record<string, unknown>,
  originalSourceCache: Map<string, string>,
  processedSourceCache: Map<string, string>,
  registry: Registry,
  expressiveCode: ExpressiveCodeConfig | null,
  starlightComponents: XmdxPluginOptions['starlightComponents'],
  shikiManager: ShikiManager,
  resolvedShiki: Awaited<ReturnType<ShikiManager['init']>>,
  transformPipeline: Transform,
  sourceHashes: Map<string, string>
): Promise<Array<{ id: string; virtualId: string; jsx: string; contentHash?: string }>> {
  const jsxInputs: Array<{ id: string; virtualId: string; jsx: string; contentHash?: string }> = [];
  const normalizedStarlightComponents = normalizeStarlightComponents(starlightComponents ?? false);
  const PIPELINE_CHUNK_SIZE = 50;

  const mdModuleEntries: Array<[string, CachedModuleResult]> = [];
  for (const [filename, cached] of moduleCompilationCache) {
    mdModuleEntries.push([filename, cached]);
  }

  for (let i = 0; i < mdModuleEntries.length; i += PIPELINE_CHUNK_SIZE) {
    const chunk = mdModuleEntries.slice(i, i + PIPELINE_CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async ([filename, cached]) => {
        const frontmatter = parseFrontmatterCached(cached.frontmatterJson, filename);
        const headings = cached.headings || [];
        const jsxCode = cached.code;
        const sourceForHooks =
          originalSourceCache.get(filename) ??
          cached.originalSource ??
          processedSourceCache.get(filename) ??
          cached.processedSource ??
          '';

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
        return {
          id: filename,
          virtualId: `${VIRTUAL_MODULE_PREFIX}${filename}${OUTPUT_EXTENSION}`,
          jsx: transformed.code,
          contentHash: sourceHashes.get(filename),
        };
      })
    );
    jsxInputs.push(...chunkResults);
  }

  const mdxEntries: Array<[string, CachedMdxResult]> = [];
  for (const [filename, cached] of mdxCompilationCache) {
    mdxEntries.push([filename, cached]);
  }

  for (let i = 0; i < mdxEntries.length; i += PIPELINE_CHUNK_SIZE) {
    const chunk = mdxEntries.slice(i, i + PIPELINE_CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async ([filename, cached]) => {
        const frontmatter = parseFrontmatterCached(cached.frontmatterJson, filename);
        const headings = cached.headings || [];
        const jsxCode = wrapMdxModule(
          cached.code,
          {
            frontmatter,
            headings,
            registry,
          },
          filename
        );
        const sourceForHooks =
          originalSourceCache.get(filename) ??
          cached.originalSource ??
          processedSourceCache.get(filename) ??
          cached.processedSource ??
          '';

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
        return {
          id: filename,
          virtualId: `${VIRTUAL_MODULE_PREFIX}${filename}${OUTPUT_EXTENSION}`,
          jsx: transformed.code,
          contentHash: sourceHashes.get(filename),
        };
      })
    );
    jsxInputs.push(...chunkResults);
  }

  debugLog(
    `Pipeline processed ${jsxInputs.length} files for esbuild batch (${mdModuleEntries.length} MD modules, ${mdxEntries.length} MDX)`
  );

  return jsxInputs;
}

async function writeDiskCacheEntries(
  diskCache: DiskCache,
  jsxInputs: Array<{ id: string; virtualId: string; jsx: string; contentHash?: string }>,
  esbuildCache: Map<string, EsbuildCacheEntry>
): Promise<void> {
  const entriesToCache: Array<{
    filename: string;
    sourceHash: string;
    code: string;
    map?: SourceMapInput;
  }> = [];

  const inputHashMap = new Map<string, string>();
  for (const input of jsxInputs) {
    if (input.contentHash) {
      inputHashMap.set(input.id, input.contentHash);
    }
  }

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
}

export async function handleBuildStart(deps: BuildStartDeps): Promise<void> {
  if (deps.resolvedConfig?.command !== 'build') return;

  deps.state.buildPassCount++;
  const buildPassCount = deps.state.buildPassCount;
  debugLog(`Build pass ${buildPassCount}`);

  if (buildPassCount === 1 && deps.diskCacheEnabled && !deps.state.diskCache) {
    deps.state.diskCache = new DiskCache(deps.resolvedConfig.root, true);
    await deps.state.diskCache.init();
    const preloaded = await deps.state.diskCache.preloadEntries();
    const stats = deps.state.diskCache.getStats();
    if (stats.entries > 0) {
      console.info(`[xmdx] Disk cache enabled (${stats.entries} cached entries, ${preloaded} preloaded)`);
    }
  }

  if (buildPassCount > 1 && deps.persistentCache.esbuild.size > 0) {
    debugTime('buildStart:total');
    debugLog(`Reusing ${deps.persistentCache.esbuild.size} cached esbuild results from pass ${buildPassCount - 1}`);

    restorePersistentCaches(
      deps.persistentCache,
      deps.esbuildCache,
      deps.moduleCompilationCache,
      deps.mdxCompilationCache,
      deps.fallbackFiles,
      deps.fallbackReasons
    );

    console.info(
      `[xmdx] Build pass ${buildPassCount}: Reusing ${deps.persistentCache.esbuild.size} cached results`
    );
    debugTimeEnd('buildStart:total');
    return;
  }

  const root = deps.resolvedConfig.root;
  const astroDir = path.join(root, '.astro');
  const distDir = path.join(root, 'dist');
  if (existsSync(astroDir) && !existsSync(distDir)) {
    console.warn(
      '[xmdx] Stale cache detected (.astro exists but dist does not). Consider running `rm -rf .astro` if you encounter module resolution errors.'
    );
  }

  debugTime('buildStart:total');
  debugTime('buildStart:glob');

  const { glob } = require('glob') as {
    glob: (
      pattern: string,
      options: { cwd: string; ignore: string[]; absolute: boolean }
    ) => Promise<string[]>;
  };
  const files = await glob('**/*.{md,mdx}', {
    cwd: deps.resolvedConfig.root,
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
  const { inputs, sourceHashes, diskCacheHits } = await batchReadAndDetectFallbacks(
    files,
    deps.hooks,
    deps.mdxOptions,
    deps.state.diskCache,
    deps.esbuildCache,
    deps.fallbackFiles,
    deps.fallbackReasons,
    deps.originalSourceCache,
    deps.processedSourceCache,
    deps.processedFiles
  );
  debugTimeEnd('buildStart:readFiles');

  if (diskCacheHits > 0) {
    debugLog(`Disk cache hits: ${diskCacheHits}/${files.length} files`);
    console.info(`[xmdx] Disk cache: ${diskCacheHits} files loaded from cache`);
  }

  if (inputs.length === 0) {
    debugTimeEnd('buildStart:total');
    return;
  }

  try {
    debugTime('buildStart:batchCompile');
    debugTime('buildStart:shikiInit');

    const shikiPromise = deps.shikiManager.init();
    const ecPromise = deps.ecManager.init();

    const mdInputs = inputs.filter((i) => !i.filepath.endsWith('.mdx'));
    const mdxInputs = inputs.filter((i) => i.filepath.endsWith('.mdx'));
    debugLog(`Separated: ${mdInputs.length} MD files, ${mdxInputs.length} MDX files`);

    const binding = deps.providedBinding ?? (await deps.loadBinding());
    const stats = await batchCompileFiles(
      binding,
      mdInputs,
      mdxInputs,
      deps.compilerOptions,
      deps.moduleCompilationCache,
      deps.mdxCompilationCache,
      deps.fallbackFiles,
      deps.fallbackReasons,
      deps.originalSourceCache,
      deps.processedSourceCache
    );
    debugTimeEnd('buildStart:batchCompile');

    const totalFiles = stats.md.total + stats.mdx.total;
    const totalSucceeded = stats.md.succeeded + stats.mdx.succeeded;
    const totalTime = stats.md.processingTimeMs + stats.mdx.processingTimeMs;
    console.info(
      `[xmdx] Batch compiled ${totalSucceeded}/${totalFiles} files in ${totalTime.toFixed(0)}ms` +
        (mdxInputs.length > 0 ? ` (${stats.mdx.succeeded} MDX via mdxjs-rs)` : '')
    );

    const esbuildStartTime = performance.now();
    const [resolvedShiki] = await Promise.all([shikiPromise, ecPromise]);
    debugTimeEnd('buildStart:shikiInit');
    debugTime('buildStart:pipelineProcessing');

    const jsxInputs = await preparePipelineInputs(
      deps.moduleCompilationCache,
      deps.mdxCompilationCache,
      deps.parseFrontmatterCached,
      deps.originalSourceCache,
      deps.processedSourceCache,
      deps.registry,
      deps.expressiveCode,
      deps.starlightComponents,
      deps.shikiManager,
      resolvedShiki,
      deps.transformPipeline,
      sourceHashes
    );
    debugTimeEnd('buildStart:pipelineProcessing');

    if (jsxInputs.length > 0) {
      debugTime('buildStart:esbuild');
      const usedParallel = await batchEsbuildTransform(jsxInputs, deps.esbuildCache, deps.warn);
      if (usedParallel !== null) {
        const esbuildEndTime = performance.now();
        console.info(
          `[xmdx] Batch esbuild transformed ${deps.esbuildCache.size} files in ${(esbuildEndTime - esbuildStartTime).toFixed(0)}ms` +
            (usedParallel ? ' (parallel workers)' : '')
        );
        debugTimeEnd('buildStart:esbuild');

        if (deps.state.diskCache) {
          debugTime('buildStart:diskCacheWrite');
          await writeDiskCacheEntries(deps.state.diskCache, jsxInputs, deps.esbuildCache);
          debugTimeEnd('buildStart:diskCacheWrite');
        }
      } else {
        debugTimeEnd('buildStart:esbuild');
      }
    }

    persistCaches(
      deps.persistentCache,
      deps.esbuildCache,
      deps.moduleCompilationCache,
      deps.mdxCompilationCache,
      deps.fallbackFiles,
      deps.fallbackReasons
    );
    debugLog(`Persisted ${deps.persistentCache.esbuild.size} esbuild results for subsequent passes`);
    debugTimeEnd('buildStart:total');
  } catch (err) {
    debugTimeEnd('buildStart:total');
    deps.warn(`[xmdx] Batch compile skipped due to binding load failure: ${err}`);
  }
}
