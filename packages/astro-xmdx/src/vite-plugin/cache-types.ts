/**
 * Shared cache-related types for the Vite plugin internals.
 * @module vite-plugin/cache-types
 */

import type { SourceMapInput } from 'rollup';
import type { ModuleBatchCompileResult } from './types.js';

export type EsbuildCacheEntry = { code: string; map?: SourceMapInput };

export type CachedModuleResult =
  NonNullable<ModuleBatchCompileResult['results'][number]['result']> & {
    originalSource?: string;
    processedSource?: string;
  };

export interface PersistentCache {
  esbuild: Map<string, EsbuildCacheEntry>;
  moduleCompilation: Map<string, CachedModuleResult>;
  fallbackFiles: Set<string>;
  fallbackReasons: Map<string, string>;
}
