/**
 * Vite plugin infrastructure - framework-agnostic utilities
 *
 * This module provides the building blocks for creating Vite plugins
 * that use xmdx for Markdown/MDX compilation.
 *
 * @module vite-infra
 */

// JSX transformation
export { transformJsx, batchTransformJsx, isOxcAvailable, resetTransformCache } from './jsx-transform.js';
export { runParallelJsxTransform } from './jsx-worker-pool.js';

// Binding management
export {
  loadXmdxBinding,
  resetBindingPromise,
  getNativeBinaryCandidates,
  selectCompatibleNodeFile,
  ENABLE_SHIKI,
  IS_MDAST,
} from './binding-loader.js';

// Profiling
export {
  LoadProfiler,
  createLoadProfiler,
  debugTime,
  debugTimeEnd,
  debugLog,
  DEBUG_TIMING,
  LOAD_PROFILE,
} from './load-profiler.js';

// Plugin hooks
export { collectHooks } from './collect-hooks.js';

// Configuration
export { normalizeStarlightComponents, type NormalizedStarlightComponents } from './normalize-config.js';
export { resolveLibraries } from './resolve-libraries.js';

// Cache
export { DiskCache } from './cache/disk-cache.js';
export type { CacheEntry } from './cache/disk-cache.js';
export type { EsbuildCacheEntry, PersistentCache } from './cache/types.js';

// Highlighting
export { ShikiManager } from './highlighting/shiki-manager.js';
export { createShikiHighlighter } from './highlighting/shiki-highlighter.js';
export {
  ExpressiveCodeManager,
  DEFAULT_EXPRESSIVE_CODE_MODULE_ID,
} from './highlighting/expressive-code-manager.js';
export type { ExpressiveCodeSupport, ExpressiveCodeRenderResult } from './highlighting/expressive-code-manager.js';

// Types
export type {
  XmdxBinding,
  XmdxCompiler,
  CompileResult,
  BatchCompileResult,
  ModuleBatchCompileResult,
  MdxBatchCompileResult,
  ParseBlocksResult,
  RenderBlockData,
  ExportSpec,
  BatchError,
  XmdxPluginOptions,
} from './types.js';
