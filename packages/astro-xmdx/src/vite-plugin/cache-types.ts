/**
 * Shared cache-related types for the Vite plugin internals.
 * @module vite-plugin/cache-types
 */

import type { SourceMapInput } from 'rollup';
import type { MdxBatchCompileResult, ModuleBatchCompileResult } from './types.js';

export type EsbuildCacheEntry = { code: string; map?: SourceMapInput };

export type CachedModuleResult =
  NonNullable<ModuleBatchCompileResult['results'][number]['result']> & {
    originalSource?: string;
    processedSource?: string;
  };

export type CachedMdxResult = NonNullable<MdxBatchCompileResult['results'][number]['result']> & {
  originalSource?: string;
  processedSource?: string;
};

export interface PersistentCache {
  esbuild: Map<string, EsbuildCacheEntry>;
  moduleCompilation: Map<string, CachedModuleResult>;
  mdxCompilation: Map<string, CachedMdxResult>;
  fallbackFiles: Set<string>;
  fallbackReasons: Map<string, string>;
}
