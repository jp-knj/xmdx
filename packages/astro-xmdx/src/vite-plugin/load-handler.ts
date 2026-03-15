/**
 * Runtime load hook handling for virtual markdown/MDX modules.
 * @module vite-plugin/load-handler
 */

import { readFile } from 'node:fs/promises';

import type { SourceMapInput } from 'rollup';
import type { ResolvedConfig } from 'vite';

import type { EsbuildCacheEntry, ExpressiveCodeManager, LoadProfiler, ShikiManager, XmdxBinding, XmdxCompiler, XmdxPluginOptions } from '@xmdx/vite';
import { IS_MDAST,LOAD_PROFILE, normalizeStarlightComponents, transformJsx } from '@xmdx/vite';
import { compileDocument, type CompileTargetAdapter } from 'xmdx/compiler';
import type { Transform } from 'xmdx/pipeline';
import type { Registry } from 'xmdx/registry';
import type { ExpressiveCodeConfig } from 'xmdx/utils/config';
import { stripQuery } from 'xmdx/utils/paths';

import { OUTPUT_EXTENSION, VIRTUAL_MODULE_PREFIX } from '../constants.js';
import { asSourceMap, toError } from '../ops/type-narrowing.js';
import { blocksToJsx } from '../transforms/blocks-to-jsx.js';
import type { MdxImportHandlingOptions, PluginHooks, TransformContext } from '../types.js';
import { compileFallbackModule } from './fallback/compile.js';
import { wrapMdxModule } from './mdx-wrapper/index.js';

interface LoadState {
  totalProcessingTimeMs: number;
}

export interface LoadHandlerDeps {
  sourceLookup: Map<string, string>;
  fallbackFiles: Set<string>;
  fallbackReasons: Map<string, string>;
  esbuildCache: Map<string, EsbuildCacheEntry>;
  processedFiles: Set<string>;
  registry: Registry;
  hasStarlightConfigured: boolean;
  hooks: PluginHooks;
  mdxOptions: MdxImportHandlingOptions | undefined;
  starlightComponents: XmdxPluginOptions['starlightComponents'];
  expressiveCode: ExpressiveCodeConfig | null;
  ecManager: ExpressiveCodeManager;
  shikiManager: ShikiManager;
  transformPipeline: Transform;
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
  const expressiveCodeCanRewrite = deps.expressiveCode
    ? await deps.ecManager.canRewrite(deps.expressiveCode.moduleId, deps.resolvedConfig?.root)
    : false;
  // Fallback: enable Shiki only when ExpressiveCode cannot safely rewrite/pre-render.
  if (deps.expressiveCode && !expressiveCodeCanRewrite) {
    deps.shikiManager.enable();
  }
  const ctx: TransformContext = {
    code: input.code,
    source: input.source,
    filename: input.filename,
    frontmatter: input.frontmatter,
    headings: input.headings,
    registry: deps.registry,
    config: {
      expressiveCode: deps.expressiveCode,
      expressiveCodeCanRewrite,
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

export async function loadCacheMiss(
  id: string,
  filename: string,
  loadStart: number,
  deps: LoadHandlerDeps
): Promise<PipelineResult> {
  if (deps.loadProfiler) deps.loadProfiler.cacheMisses++;

  const source = await readFile(filename, 'utf8');

  let processedSource = source;
  for (const preprocessHook of deps.hooks.preprocess) {
    processedSource = preprocessHook(processedSource, filename);
  }

  const target: CompileTargetAdapter = {
    wrapMdxModule: ({ code, frontmatter, headings, filename: targetFilename }) =>
      wrapMdxModule(
        code,
        {
          frontmatter,
          headings,
          registry: deps.registry,
        },
        targetFilename
      ),
    renderBlocksModule: ({ blocks, frontmatter, headings, filename: targetFilename, userImports }) =>
      blocksToJsx(blocks, frontmatter, headings, deps.registry, targetFilename, userImports),
  };

  const compiled = await compileDocument({
    filename,
    source: processedSource,
    mdxOptions: deps.mdxOptions,
    rootDir: deps.resolvedConfig?.root,
    useMdast: IS_MDAST,
    getCompiler: deps.getCompiler,
    loadBinding: deps.loadBinding,
    target,
  });

  if (compiled.status === 'fallback') {
    deps.warn(
      `[xmdx] Skipping ${filename}: ${compiled.reason}`
    );
    deps.fallbackFiles.add(filename);
    deps.fallbackReasons.set(filename, compiled.reason);
    return compileFallbackModule(filename, processedSource, id, deps.registry, deps.hasStarlightConfigured);
  }

  const startTime = performance.now();
  const compileStart = LOAD_PROFILE ? performance.now() : 0;
  const result = compiled.document;
  const frontmatter = result.frontmatter;
  const headings = result.headings;

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
    map: final.map ?? asSourceMap(result.map) ?? undefined,
  };
}

export async function loadWithFallback(
  id: string,
  filename: string,
  error: unknown,
  deps: LoadHandlerDeps
): Promise<PipelineResult> {
  const message = toError(error).message;
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

    return loadCacheMiss(id, filename, loadStart, deps);
  } catch (error) {
    const message = toError(error).message;
    if (shouldUseFallback(message)) {
      return loadWithFallback(id, filename, error, deps);
    }
    throw new Error(`[xmdx] Compile failed for ${filename}: ${message}`);
  }
}
