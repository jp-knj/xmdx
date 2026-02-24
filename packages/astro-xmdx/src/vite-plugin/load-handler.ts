/**
 * Runtime load hook handling for virtual markdown/MDX modules.
 * @module vite-plugin/load-handler
 */

import { readFile } from 'node:fs/promises';
import type { ResolvedConfig } from 'vite';
import type { SourceMapInput } from 'rollup';
import type { Registry } from 'xmdx/registry';
import { blocksToJsx } from '../transforms/blocks-to-jsx.js';
import { stripFrontmatter } from '../utils/frontmatter.js';
import { detectProblematicMdxPatterns } from '../utils/mdx-detection.js';
import { extractImportStatements } from '../utils/imports.js';
import { deriveFileOptions, stripQuery } from '../utils/paths.js';
import { OUTPUT_EXTENSION, VIRTUAL_MODULE_PREFIX } from '../constants.js';
import { transformJsx } from './jsx-transform.js';
import type { MdxImportHandlingOptions, PluginHooks, TransformContext } from '../types.js';
import type { ExpressiveCodeConfig } from '../utils/config.js';
import type { Transform } from '../pipeline/types.js';
import { IS_MDAST } from './binding-loader.js';
import type { CachedMdxResult, CachedModuleResult, EsbuildCacheEntry } from './cache-types.js';
import { compileFallbackModule } from './jsx-module.js';
import { wrapMdxModule } from './mdx-wrapper/index.js';
import { normalizeStarlightComponents } from './normalize-config.js';
import type { LoadProfiler } from './load-profiler.js';
import { LOAD_PROFILE } from './load-profiler.js';
import type { ShikiManager } from './shiki-manager.js';
import type { CompileResult, XmdxBinding, XmdxCompiler, XmdxPluginOptions } from './types.js';

interface LoadState {
  totalProcessingTimeMs: number;
}

export interface LoadHandlerDeps {
  sourceLookup: Map<string, string>;
  fallbackFiles: Set<string>;
  fallbackReasons: Map<string, string>;
  esbuildCache: Map<string, EsbuildCacheEntry>;
  moduleCompilationCache: Map<string, CachedModuleResult>;
  mdxCompilationCache: Map<string, CachedMdxResult>;
  originalSourceCache: Map<string, string>;
  processedSourceCache: Map<string, string>;
  processedFiles: Set<string>;
  registry: Registry;
  hasStarlightConfigured: boolean;
  hooks: PluginHooks;
  mdxOptions: MdxImportHandlingOptions | undefined;
  starlightComponents: XmdxPluginOptions['starlightComponents'];
  expressiveCode: ExpressiveCodeConfig | null;
  shikiManager: ShikiManager;
  transformPipeline: Transform;
  parseFrontmatterCached: (json: string | undefined, filename: string) => Record<string, unknown>;
  compilerOptions: Record<string, unknown>;
  getCompiler: () => Promise<XmdxCompiler>;
  loadBinding: () => Promise<XmdxBinding>;
  loadProfiler: LoadProfiler | null;
  resolvedConfig: ResolvedConfig | undefined;
  state: LoadState;
  warn: (message: string) => void;
  addWatchFile: (path: string) => void;
  invalidateModule?: (id: string) => void;
}

interface PipelineInput {
  id: string;
  filename: string;
  code: string;
  source: string;
  frontmatter: Record<string, unknown>;
  headings: Array<{ depth: number; slug: string; text: string }>;
}

interface PipelineResult {
  code: string;
  map?: SourceMapInput;
}

function getFilename(id: string, sourceLookup: Map<string, string>): string {
  return (
    sourceLookup.get(id) ??
    stripQuery(
      id
        .slice(VIRTUAL_MODULE_PREFIX.length)
        .replace(new RegExp(`${OUTPUT_EXTENSION.replace('.', '\\.')}$`), '')
    )
  );
}

function shouldUseFallback(message: string): boolean {
  return (
    message.includes('Vite module runner has been closed') ||
    message.includes('Markdown parser error') ||
    message.includes('Markdown parse error') ||
    message.includes('Transform failed') ||
    message.includes('Compiler returned undefined') ||
    message.includes('Cannot read properties of undefined') ||
    message.includes('Cannot read properties of null')
  );
}

async function runPipelineAndEsbuild(
  input: PipelineInput,
  deps: LoadHandlerDeps
): Promise<PipelineResult> {
  const normalizedStarlightComponents = normalizeStarlightComponents(deps.starlightComponents ?? false);
  const ctx: TransformContext = {
    code: input.code,
    source: input.source,
    filename: input.filename,
    frontmatter: input.frontmatter,
    headings: input.headings,
    registry: deps.registry,
    config: {
      expressiveCode: deps.expressiveCode,
      starlightComponents: normalizedStarlightComponents,
      shiki: await deps.shikiManager.getFor(input.code),
    },
  };

  const tpStart = LOAD_PROFILE ? performance.now() : 0;
  const transformed = await deps.transformPipeline(ctx);
  if (deps.loadProfiler) deps.loadProfiler.record('transform-pipeline', performance.now() - tpStart);

  const esStart = LOAD_PROFILE ? performance.now() : 0;
  const jsxResult = await transformJsx(transformed.code, input.id);
  if (deps.loadProfiler) deps.loadProfiler.record('esbuild', performance.now() - esStart);

  return {
    code: jsxResult.code,
    map: jsxResult.map ?? undefined,
  };
}

export function loadFromEsbuildCache(
  filename: string,
  cachedEsbuildResult: EsbuildCacheEntry,
  loadStart: number,
  deps: LoadHandlerDeps
): EsbuildCacheEntry {
  deps.processedFiles.add(filename);
  if (deps.loadProfiler) {
    const elapsed = performance.now() - loadStart;
    deps.loadProfiler.esbuildCacheHits++;
    deps.loadProfiler.recordFile(filename, elapsed);
  }
  return cachedEsbuildResult;
}

function getSourceForHooks(
  filename: string,
  cached: { originalSource?: string; processedSource?: string },
  originalSourceCache: Map<string, string>,
  processedSourceCache: Map<string, string>
): string {
  return (
    originalSourceCache.get(filename) ??
    cached.originalSource ??
    processedSourceCache.get(filename) ??
    cached.processedSource ??
    ''
  );
}

export async function loadCachedModule(
  id: string,
  filename: string,
  cachedModule: CachedModuleResult,
  loadStart: number,
  deps: LoadHandlerDeps
): Promise<PipelineResult> {
  const startTime = performance.now();
  const frontmatter = deps.parseFrontmatterCached(cachedModule.frontmatterJson, filename);
  const headings = cachedModule.headings || [];

  const result: CompileResult = {
    code: cachedModule.code,
    map: null,
    frontmatter_json: cachedModule.frontmatterJson,
    headings,
    imports: [],
  };

  deps.state.totalProcessingTimeMs += performance.now() - startTime;
  deps.processedFiles.add(filename);

  const sourceForHooks =
    getSourceForHooks(filename, cachedModule, deps.originalSourceCache, deps.processedSourceCache) ||
    (await readFile(filename, 'utf8'));

  const final = await runPipelineAndEsbuild(
    {
      id,
      filename,
      code: result.code,
      source: sourceForHooks,
      frontmatter,
      headings,
    },
    deps
  );

  if (deps.loadProfiler) {
    const elapsed = performance.now() - loadStart;
    deps.loadProfiler.cacheHits++;
    deps.loadProfiler.recordFile(filename, elapsed);
  }

  return {
    code: final.code,
    map: final.map ?? (result.map as SourceMapInput | undefined) ?? undefined,
  };
}

export async function loadCachedMdx(
  id: string,
  filename: string,
  cachedMdx: CachedMdxResult,
  loadStart: number,
  deps: LoadHandlerDeps
): Promise<PipelineResult> {
  const startTime = performance.now();
  const frontmatter = deps.parseFrontmatterCached(cachedMdx.frontmatterJson, filename);
  const headings = cachedMdx.headings || [];

  const jsxCode = wrapMdxModule(
    cachedMdx.code,
    {
      frontmatter,
      headings,
      registry: deps.registry,
    },
    filename
  );

  const result: CompileResult = {
    code: jsxCode,
    map: null,
    frontmatter_json: cachedMdx.frontmatterJson,
    headings,
    imports: [],
  };

  deps.state.totalProcessingTimeMs += performance.now() - startTime;
  deps.processedFiles.add(filename);

  const sourceForHooks =
    getSourceForHooks(filename, cachedMdx, deps.originalSourceCache, deps.processedSourceCache) ||
    (await readFile(filename, 'utf8'));

  const final = await runPipelineAndEsbuild(
    {
      id,
      filename,
      code: result.code,
      source: sourceForHooks,
      frontmatter,
      headings,
    },
    deps
  );

  if (deps.loadProfiler) {
    const elapsed = performance.now() - loadStart;
    deps.loadProfiler.cacheHits++;
    deps.loadProfiler.recordFile(filename, elapsed);
  }

  return {
    code: final.code,
    map: final.map ?? (result.map as SourceMapInput | undefined) ?? undefined,
  };
}

export async function loadCacheMiss(
  id: string,
  filename: string,
  loadStart: number,
  deps: LoadHandlerDeps
): Promise<PipelineResult> {
  if (deps.loadProfiler) deps.loadProfiler.cacheMisses++;

  const currentCompiler = await deps.getCompiler();
  const source = await readFile(filename, 'utf8');
  deps.originalSourceCache.set(filename, source);

  let processedSource = source;
  for (const preprocessHook of deps.hooks.preprocess) {
    processedSource = preprocessHook(processedSource, filename);
  }
  deps.processedSourceCache.set(filename, processedSource);

  const detection = detectProblematicMdxPatterns(processedSource, deps.mdxOptions, filename);
  if (detection.hasProblematicPatterns) {
    deps.warn(
      `[xmdx] Skipping ${filename}: ${detection.reason ?? 'contains patterns incompatible with markdown-rs'}`
    );
    deps.fallbackFiles.add(filename);
    deps.fallbackReasons.set(filename, detection.reason ?? 'Detected problematic MDX patterns');
    return compileFallbackModule(filename, processedSource, id, deps.registry, deps.hasStarlightConfigured);
  }

  const startTime = performance.now();
  const compileStart = LOAD_PROFILE ? performance.now() : 0;
  let result: CompileResult;
  let frontmatter: Record<string, unknown> = {};
  let headings: Array<{ depth: number; slug: string; text: string }> = [];
  const isMdx = filename.endsWith('.mdx');

  if (isMdx) {
    const binding = await deps.loadBinding();
    const mdxBatchResult = binding.compileMdxBatch(
      [{ id: filename, source: processedSource }],
      { continueOnError: false, config: deps.compilerOptions }
    );

    const mdxResult = mdxBatchResult.results[0];
    if (mdxResult?.error) {
      throw new Error(`MDX compilation failed: ${mdxResult.error}`);
    }
    if (!mdxResult?.result) {
      throw new Error(`MDX compilation returned no result for ${filename}`);
    }

    if (mdxResult.result.frontmatterJson) {
      try {
        frontmatter = JSON.parse(mdxResult.result.frontmatterJson) as Record<string, unknown>;
      } catch {
        frontmatter = {};
      }
    }
    headings = mdxResult.result.headings || [];

    result = {
      code: wrapMdxModule(
        mdxResult.result.code,
        {
          frontmatter,
          headings,
          registry: deps.registry,
        },
        filename
      ),
      map: null,
      frontmatter_json: mdxResult.result.frontmatterJson ?? '',
      headings,
      imports: [],
    };
  } else if (IS_MDAST) {
    const binding = await deps.loadBinding();
    const userImports = extractImportStatements(processedSource);
    const contentSource = stripFrontmatter(processedSource);

    const parseResult = binding.parseBlocks(contentSource, {
      enable_directives: true,
    });
    headings = parseResult.headings;

    const frontmatterResult = binding.parseFrontmatter(processedSource);
    frontmatter = frontmatterResult.frontmatter || {};

    result = {
      code: blocksToJsx(parseResult.blocks, frontmatter, headings, deps.registry, filename, userImports),
      map: null,
      frontmatter_json: JSON.stringify(frontmatter),
      headings,
      imports: [],
    };
  } else {
    const fileOptions = deriveFileOptions(filename, deps.resolvedConfig?.root);
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

  if (deps.loadProfiler) deps.loadProfiler.record('compile', performance.now() - compileStart);
  deps.state.totalProcessingTimeMs += performance.now() - startTime;
  deps.processedFiles.add(filename);

  if (result.code == null || typeof result.code !== 'string') {
    throw new Error(`Compiler returned undefined or invalid code for ${filename}`);
  }

  if (result.diagnostics?.warnings?.length) {
    for (const warning of result.diagnostics.warnings) {
      deps.warn(`[xmdx] ${filename}:${warning.line}: ${warning.message}`);
    }
  }

  if (Array.isArray(result.imports)) {
    for (const dep of result.imports) {
      if (dep?.path) {
        deps.addWatchFile(dep.path);
      }
    }
  }

  const final = await runPipelineAndEsbuild(
    {
      id,
      filename,
      code: result.code,
      source,
      frontmatter,
      headings,
    },
    deps
  );

  if (deps.loadProfiler) {
    const elapsed = performance.now() - loadStart;
    deps.loadProfiler.recordFile(filename, elapsed);
  }

  return {
    code: final.code,
    map: final.map ?? (result.map as SourceMapInput | undefined) ?? undefined,
  };
}

export async function loadWithFallback(
  id: string,
  filename: string,
  error: unknown,
  deps: LoadHandlerDeps
): Promise<PipelineResult> {
  const message = (error as Error)?.message || String(error);
  deps.fallbackFiles.add(filename);
  deps.fallbackReasons.set(filename, message);
  deps.warn(`[xmdx] Falling back to @mdx-js/mdx for ${filename}: ${message}`);

  deps.invalidateModule?.(id);

  const fallbackSource = await readFile(filename, 'utf8');
  let processedFallbackSource = fallbackSource;
  for (const preprocessHook of deps.hooks.preprocess) {
    processedFallbackSource = preprocessHook(processedFallbackSource, filename);
  }
  return compileFallbackModule(
    filename,
    processedFallbackSource,
    id,
    deps.registry,
    deps.hasStarlightConfigured
  );
}

export async function handleLoad(
  id: string,
  deps: LoadHandlerDeps
): Promise<PipelineResult | null> {
  if (!id.startsWith(VIRTUAL_MODULE_PREFIX)) {
    return null;
  }

  const filename = getFilename(id, deps.sourceLookup);
  try {
    if (deps.fallbackFiles.has(filename)) {
      const source = await readFile(filename, 'utf8');
      let processedSource = source;
      for (const preprocessHook of deps.hooks.preprocess) {
        processedSource = preprocessHook(processedSource, filename);
      }
      return compileFallbackModule(filename, processedSource, id, deps.registry, deps.hasStarlightConfigured);
    }

    const loadStart = LOAD_PROFILE ? performance.now() : 0;
    const cachedEsbuildResult = deps.esbuildCache.get(filename);
    if (cachedEsbuildResult) {
      return loadFromEsbuildCache(filename, cachedEsbuildResult, loadStart, deps);
    }

    const cachedModule = deps.moduleCompilationCache.get(filename);
    const cachedMdx = deps.mdxCompilationCache.get(filename);
    const isMdx = filename.endsWith('.mdx');

    if (cachedModule && !isMdx) {
      return loadCachedModule(id, filename, cachedModule, loadStart, deps);
    }

    if (cachedMdx && isMdx) {
      return loadCachedMdx(id, filename, cachedMdx, loadStart, deps);
    }

    return loadCacheMiss(id, filename, loadStart, deps);
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    if (shouldUseFallback(message)) {
      return loadWithFallback(id, filename, error, deps);
    }
    throw new Error(`[xmdx] Compile failed for ${filename}: ${message}`);
  }
}
