/**
 * Shared cache-related types for the Vite plugin internals.
 * @module vite-plugin/cache-types
 */

import type { SourceMapInput } from 'rollup';

export type EsbuildCacheEntry = { code: string; map?: SourceMapInput };

export interface PersistentCache {
  esbuild: Map<string, EsbuildCacheEntry>;
  fallbackFiles: Set<string>;
  fallbackReasons: Map<string, string>;
}
