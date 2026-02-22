/**
 * Disk cache for xmdx compilation results.
 * Persists compiled modules across builds to avoid redundant recompilation.
 *
 * @module disk-cache
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, readdir, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import type { SourceMapInput } from 'rollup';

/** Cache entry for a compiled file */
interface CacheEntry {
  /** Content hash of the source file */
  hash: string;
  /** Compiled esbuild output */
  code: string;
  /** Optional source map */
  map?: SourceMapInput;
  /** Timestamp when cached */
  timestamp: number;
}

/** Manifest tracking all cached files */
interface CacheManifest {
  version: number;
  entries: Record<string, { hash: string; timestamp: number }>;
}

const CACHE_VERSION = 1;
const CACHE_DIR_NAME = '.xmdx-cache';
const MANIFEST_FILE = 'manifest.json';

/**
 * DiskCache manages persistent caching of xmdx compilation results.
 *
 * Features:
 * - Content-hash based invalidation
 * - Atomic writes to prevent corruption
 * - Automatic cleanup of stale entries
 * - Batch loading of entries to minimize I/O during builds
 */
export class DiskCache {
  private cacheDir: string;
  private manifest: CacheManifest;
  private manifestDirty = false;
  private enabled: boolean;
  private initialized = false;
  /** In-memory cache of loaded entries to avoid per-file I/O */
  private loadedEntries: Map<string, CacheEntry> = new Map();

  constructor(projectRoot: string, enabled = true) {
    this.cacheDir = path.join(projectRoot, CACHE_DIR_NAME);
    this.enabled = enabled;
    this.manifest = { version: CACHE_VERSION, entries: {} };
  }

  /** Compute content hash for a file's source */
  static computeHash(source: string): string {
    return createHash('sha256').update(source).digest('hex').slice(0, 16);
  }

  /** Initialize the cache, loading manifest if it exists */
  async init(): Promise<void> {
    if (!this.enabled || this.initialized) return;

    try {
      await mkdir(this.cacheDir, { recursive: true });

      const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);
      if (existsSync(manifestPath)) {
        const data = await readFile(manifestPath, 'utf8');
        const loaded = JSON.parse(data) as CacheManifest;

        // Version mismatch - clear cache
        if (loaded.version !== CACHE_VERSION) {
          console.info('[xmdx:cache] Cache version mismatch, clearing cache');
          await this.clear();
        } else {
          this.manifest = loaded;
        }
      }

      this.initialized = true;
    } catch (err) {
      console.warn('[xmdx:cache] Failed to initialize disk cache:', err);
      this.enabled = false;
    }
  }

  /**
   * Batch-load all cache entries into memory.
   * Call this in buildStart to avoid per-file I/O during the build.
   * PERF: Reduces disk I/O from O(N) to O(1) where N is number of cached files.
   */
  async preloadEntries(): Promise<number> {
    if (!this.enabled || !this.initialized) return 0;

    const entriesDir = path.join(this.cacheDir, 'entries');
    if (!existsSync(entriesDir)) return 0;

    try {
      const files = await readdir(entriesDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      // Batch-read all cache entries in parallel
      const results = await Promise.all(
        jsonFiles.map(async (file) => {
          try {
            const data = await readFile(path.join(entriesDir, file), 'utf8');
            return JSON.parse(data) as CacheEntry & { _filename?: string };
          } catch {
            return null;
          }
        })
      );

      // Build reverse mapping from cache file to source filename
      // by matching hashes from manifest
      for (const [filename, manifestEntry] of Object.entries(this.manifest.entries)) {
        const cachePath = this.getCachePath(filename);
        const cacheFile = path.basename(cachePath);
        const idx = jsonFiles.indexOf(cacheFile);
        if (idx !== -1 && results[idx]) {
          const entry = results[idx]!;
          if (entry.hash === manifestEntry.hash) {
            this.loadedEntries.set(filename, entry);
          }
        }
      }

      return this.loadedEntries.size;
    } catch {
      return 0;
    }
  }

  /** Check if a file's compiled result is cached and valid */
  async get(
    filename: string,
    sourceHash: string
  ): Promise<CacheEntry | null> {
    if (!this.enabled || !this.initialized) return null;

    const entry = this.manifest.entries[filename];
    if (!entry || entry.hash !== sourceHash) {
      return null;
    }

    // PERF: Check in-memory cache first (populated by preloadEntries)
    const loaded = this.loadedEntries.get(filename);
    if (loaded && loaded.hash === sourceHash) {
      return loaded;
    }

    // Fallback to disk read (for entries not preloaded)
    try {
      const cachePath = this.getCachePath(filename);
      if (!existsSync(cachePath)) {
        // Entry in manifest but file missing - remove from manifest
        delete this.manifest.entries[filename];
        this.manifestDirty = true;
        return null;
      }

      const data = await readFile(cachePath, 'utf8');
      const cached = JSON.parse(data) as CacheEntry;

      // Double-check hash matches
      if (cached.hash !== sourceHash) {
        return null;
      }

      // Cache for future access
      this.loadedEntries.set(filename, cached);
      return cached;
    } catch {
      return null;
    }
  }

  /** Store a compiled result in the cache */
  async set(
    filename: string,
    sourceHash: string,
    code: string,
    map?: SourceMapInput
  ): Promise<void> {
    if (!this.enabled || !this.initialized) return;

    try {
      const entry: CacheEntry = {
        hash: sourceHash,
        code,
        map,
        timestamp: Date.now(),
      };

      const cachePath = this.getCachePath(filename);
      const cacheDir = path.dirname(cachePath);
      await mkdir(cacheDir, { recursive: true });

      // Atomic write via temp file + rename
      const tempPath = `${cachePath}.tmp`;
      await writeFile(tempPath, JSON.stringify(entry));
      await rename(tempPath, cachePath);

      // Update manifest
      this.manifest.entries[filename] = {
        hash: sourceHash,
        timestamp: entry.timestamp,
      };
      this.manifestDirty = true;
    } catch (err) {
      // Cache write failure is non-fatal
      console.warn('[xmdx:cache] Failed to write cache entry:', err);
    }
  }

  /** Batch set multiple entries */
  async setBatch(
    entries: Array<{
      filename: string;
      sourceHash: string;
      code: string;
      map?: SourceMapInput;
    }>
  ): Promise<void> {
    if (!this.enabled || !this.initialized || entries.length === 0) return;

    // Write entries in parallel
    await Promise.all(
      entries.map((e) => this.set(e.filename, e.sourceHash, e.code, e.map))
    );
  }

  /** Persist manifest to disk */
  async flush(): Promise<void> {
    if (!this.enabled || !this.initialized || !this.manifestDirty) return;

    try {
      const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);
      await writeFile(manifestPath, JSON.stringify(this.manifest, null, 2));
      this.manifestDirty = false;
    } catch (err) {
      console.warn('[xmdx:cache] Failed to write manifest:', err);
    }
  }

  /** Clear all cache entries */
  async clear(): Promise<void> {
    if (!this.enabled) return;

    try {
      if (existsSync(this.cacheDir)) {
        await rm(this.cacheDir, { recursive: true, force: true });
      }
      await mkdir(this.cacheDir, { recursive: true });
      this.manifest = { version: CACHE_VERSION, entries: {} };
      this.manifestDirty = false;
    } catch (err) {
      console.warn('[xmdx:cache] Failed to clear cache:', err);
    }
  }

  /** Get cache statistics */
  getStats(): { entries: number; enabled: boolean } {
    return {
      entries: Object.keys(this.manifest.entries).length,
      enabled: this.enabled,
    };
  }

  /** Get the cache file path for a source file */
  private getCachePath(filename: string): string {
    // Create a safe filename from the source path
    const hash = DiskCache.computeHash(filename);
    const basename = path.basename(filename, path.extname(filename));
    return path.join(this.cacheDir, 'entries', `${basename}-${hash}.json`);
  }

  /** Clean up stale cache entries not in the current manifest */
  async cleanup(validFiles: Set<string>): Promise<number> {
    if (!this.enabled || !this.initialized) return 0;

    let removed = 0;
    const toRemove: string[] = [];

    for (const filename of Object.keys(this.manifest.entries)) {
      if (!validFiles.has(filename)) {
        toRemove.push(filename);
      }
    }

    for (const filename of toRemove) {
      try {
        const cachePath = this.getCachePath(filename);
        if (existsSync(cachePath)) {
          await rm(cachePath);
          removed++;
        }
        delete this.manifest.entries[filename];
        this.manifestDirty = true;
      } catch {
        // Ignore cleanup errors
      }
    }

    if (removed > 0) {
      console.info(`[xmdx:cache] Cleaned up ${removed} stale cache entries`);
    }

    return removed;
  }
}
