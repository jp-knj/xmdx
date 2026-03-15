/**
 * Vite plugin infrastructure - framework-agnostic utilities
 *
 * This module provides the building blocks for creating Vite plugins
 * that use xmdx for Markdown/MDX compilation.
 *
 * @module vite-infra
 */

// JSX transformation
export { batchTransformJsx, isOxcAvailable, resetTransformCache,transformJsx } from './jsx-transform.js';
export { runParallelJsxTransform } from './jsx-worker-pool.js';

// Binding management
export {
  ENABLE_SHIKI,
  getNativeBinaryCandidates,
  IS_MDAST,
  loadXmdxBinding,
  resetBindingPromise,
  selectCompatibleNodeFile,
} from './binding-loader.js';

// Profiling
export {
  createLoadProfiler,
  DEBUG_TIMING,
  debugLog,
  debugTime,
  debugTimeEnd,
  LOAD_PROFILE,
  LoadProfiler,
} from './load-profiler.js';

// Plugin hooks
export { collectHooks } from './collect-hooks.js';

// Configuration
export { type NormalizedStarlightComponents,normalizeStarlightComponents } from './normalize-config.js';
export { resolveLibraries } from './resolve-libraries.js';

// Cache
export type { CacheEntry } from './cache/disk-cache.js';
export { DiskCache } from './cache/disk-cache.js';
export type { EsbuildCacheEntry, PersistentCache } from './cache/types.js';

// Highlighting
export type { ExpressiveCodeRenderResult,ExpressiveCodeSupport } from './highlighting/expressive-code-manager.js';
export {
  DEFAULT_EXPRESSIVE_CODE_MODULE_ID,
  ExpressiveCodeManager,
} from './highlighting/expressive-code-manager.js';
export { createShikiHighlighter } from './highlighting/shiki-highlighter.js';
export { ShikiManager } from './highlighting/shiki-manager.js';

// Types
export type {
  BatchCompileResult,
  BatchError,
  CompileResult,
  ExportSpec,
  MdxBatchCompileResult,
  ModuleBatchCompileResult,
  ParseBlocksResult,
  RenderBlockData,
  XmdxBinding,
  XmdxCompiler,
  XmdxPluginOptions,
} from './types.js';
