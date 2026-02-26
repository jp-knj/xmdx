/**
 * Tests for the disk cache module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DiskCache } from './disk-cache.js';
import { existsSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('DiskCache', () => {
  let testDir: string;
  let cache: DiskCache;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = path.join(os.tmpdir(), `xmdx-cache-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    cache = new DiskCache(testDir, true);
    await cache.init();
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('computeHash', () => {
    it('returns consistent hash for same content', () => {
      const content = '# Hello World\n\nThis is a test.';
      const hash1 = DiskCache.computeHash(content);
      const hash2 = DiskCache.computeHash(content);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different content', () => {
      const hash1 = DiskCache.computeHash('# Hello');
      const hash2 = DiskCache.computeHash('# World');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 16-character hex string', () => {
      const hash = DiskCache.computeHash('test');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('get/set', () => {
    it('returns null for uncached file', async () => {
      const result = await cache.get('/test/file.md', 'abc123');
      expect(result).toBeNull();
    });

    it('stores and retrieves cached entry', async () => {
      const filename = '/test/file.md';
      const hash = DiskCache.computeHash('# Test');
      const code = 'export default function MDXContent() {}';

      await cache.set(filename, hash, code);
      const result = await cache.get(filename, hash);

      expect(result).not.toBeNull();
      expect(result!.code).toBe(code);
      expect(result!.hash).toBe(hash);
    });

    it('returns null for mismatched hash', async () => {
      const filename = '/test/file.md';
      const hash1 = DiskCache.computeHash('# Test v1');
      const hash2 = DiskCache.computeHash('# Test v2');
      const code = 'export default function MDXContent() {}';

      await cache.set(filename, hash1, code);
      const result = await cache.get(filename, hash2);

      expect(result).toBeNull();
    });

    it('stores source map when provided', async () => {
      const filename = '/test/file.md';
      const hash = DiskCache.computeHash('# Test');
      const code = 'export default function MDXContent() {}';
      const map = '{"version":3,"sources":["file.md"]}';

      await cache.set(filename, hash, code, map);
      const result = await cache.get(filename, hash);

      expect(result).not.toBeNull();
      expect(result!.map).toBe(map);
    });
  });

  describe('setBatch', () => {
    it('stores multiple entries at once', async () => {
      const entries = [
        { filename: '/test/a.md', sourceHash: 'aaa', code: 'a()' },
        { filename: '/test/b.md', sourceHash: 'bbb', code: 'b()' },
        { filename: '/test/c.md', sourceHash: 'ccc', code: 'c()' },
      ];

      await cache.setBatch(entries);

      const resultA = await cache.get('/test/a.md', 'aaa');
      const resultB = await cache.get('/test/b.md', 'bbb');
      const resultC = await cache.get('/test/c.md', 'ccc');

      expect(resultA?.code).toBe('a()');
      expect(resultB?.code).toBe('b()');
      expect(resultC?.code).toBe('c()');
    });
  });

  describe('flush', () => {
    it('persists manifest to disk', async () => {
      const filename = '/test/file.md';
      const hash = DiskCache.computeHash('# Test');
      await cache.set(filename, hash, 'code');
      await cache.flush();

      // Create new cache instance and verify it loads the manifest
      const cache2 = new DiskCache(testDir, true);
      await cache2.init();
      const result = await cache2.get(filename, hash);

      expect(result).not.toBeNull();
      expect(result!.code).toBe('code');
    });
  });

  describe('cleanup', () => {
    it('removes entries not in valid files set', async () => {
      await cache.set('/test/keep.md', 'keep', 'keep()');
      await cache.set('/test/remove.md', 'remove', 'remove()');
      await cache.flush();

      const validFiles = new Set(['/test/keep.md']);
      const removed = await cache.cleanup(validFiles);

      expect(removed).toBe(1);

      const resultKeep = await cache.get('/test/keep.md', 'keep');
      const resultRemove = await cache.get('/test/remove.md', 'remove');

      expect(resultKeep).not.toBeNull();
      expect(resultRemove).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes all cache entries', async () => {
      await cache.set('/test/a.md', 'a', 'a()');
      await cache.set('/test/b.md', 'b', 'b()');
      await cache.flush();

      await cache.clear();

      const resultA = await cache.get('/test/a.md', 'a');
      const resultB = await cache.get('/test/b.md', 'b');

      expect(resultA).toBeNull();
      expect(resultB).toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns entry count', async () => {
      await cache.set('/test/a.md', 'a', 'a()');
      await cache.set('/test/b.md', 'b', 'b()');

      const stats = cache.getStats();
      expect(stats.entries).toBe(2);
      expect(stats.enabled).toBe(true);
    });
  });

  describe('disabled cache', () => {
    it('returns null for all operations when disabled', async () => {
      const disabledCache = new DiskCache(testDir, false);
      await disabledCache.init();

      await disabledCache.set('/test/file.md', 'hash', 'code');
      const result = await disabledCache.get('/test/file.md', 'hash');

      expect(result).toBeNull();
      expect(disabledCache.getStats().enabled).toBe(false);
    });
  });
});
