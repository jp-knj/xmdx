import { describe, test, expect } from 'bun:test';
import path from 'node:path';
import {
  stripQuery,
  normalizePath,
  deriveAstroUrl,
  deriveFileOptions,
  shouldCompile,
} from './paths.js';

describe('stripQuery', () => {
  test('returns path unchanged when no query string', () => {
    expect(stripQuery('/path/to/file.md')).toBe('/path/to/file.md');
  });

  test('removes query string from path', () => {
    expect(stripQuery('/path/to/file.md?foo=bar')).toBe('/path/to/file.md');
  });

  test('removes empty query string', () => {
    expect(stripQuery('/path/to/file.md?')).toBe('/path/to/file.md');
  });

  test('handles multiple query parameters', () => {
    expect(stripQuery('/path/to/file.md?foo=bar&baz=qux')).toBe(
      '/path/to/file.md'
    );
  });

  test('handles query string with special characters', () => {
    expect(stripQuery('/file.md?import&raw')).toBe('/file.md');
  });
});

describe('normalizePath', () => {
  test('returns Unix-style path unchanged', () => {
    expect(normalizePath('path/to/file.md')).toBe('path/to/file.md');
  });

  test('converts Windows-style path to Unix-style', () => {
    // Simulate Windows path separator
    const windowsPath = ['path', 'to', 'file.md'].join('\\');
    const sep = path.sep;
    // Mock path.sep temporarily
    Object.defineProperty(path, 'sep', { value: '\\', writable: true });
    expect(normalizePath(windowsPath)).toBe('path/to/file.md');
    // Restore
    Object.defineProperty(path, 'sep', { value: sep, writable: true });
  });

  test('handles absolute paths', () => {
    expect(normalizePath('/absolute/path/file.md')).toBe(
      '/absolute/path/file.md'
    );
  });

  test('handles empty path', () => {
    expect(normalizePath('')).toBe('');
  });
});

describe('deriveAstroUrl', () => {
  test('returns undefined for empty filePath', () => {
    expect(deriveAstroUrl('')).toBe(undefined);
  });

  test('returns undefined for files outside pages directory', () => {
    const filePath = '/project/src/components/Button.astro';
    const rootDir = '/project';
    expect(deriveAstroUrl(filePath, rootDir)).toBe(undefined);
  });

  test('returns / for index.md at pages root', () => {
    const filePath = '/project/src/pages/index.md';
    const rootDir = '/project';
    expect(deriveAstroUrl(filePath, rootDir)).toBe('/');
  });

  test('returns / for empty relative path after pages', () => {
    const filePath = '/project/src/pages/';
    const rootDir = '/project';
    // Normalized path ends at pages, empty relative
    expect(deriveAstroUrl(filePath, rootDir)).toBe('/');
  });

  test('derives URL for file in pages subdirectory', () => {
    const filePath = '/project/src/pages/blog/post.md';
    const rootDir = '/project';
    expect(deriveAstroUrl(filePath, rootDir)).toBe('/blog/post');
  });

  test('removes .md extension from URL', () => {
    const filePath = '/project/src/pages/about.md';
    const rootDir = '/project';
    expect(deriveAstroUrl(filePath, rootDir)).toBe('/about');
  });

  test('removes .mdx extension from URL', () => {
    const filePath = '/project/src/pages/docs/intro.mdx';
    const rootDir = '/project';
    expect(deriveAstroUrl(filePath, rootDir)).toBe('/docs/intro');
  });

  test('handles nested index files', () => {
    const filePath = '/project/src/pages/blog/index.md';
    const rootDir = '/project';
    expect(deriveAstroUrl(filePath, rootDir)).toBe('/blog');
  });

  test('handles deeply nested paths', () => {
    const filePath = '/project/src/pages/docs/guides/advanced/config.md';
    const rootDir = '/project';
    expect(deriveAstroUrl(filePath, rootDir)).toBe(
      '/docs/guides/advanced/config'
    );
  });

  test('handles paths on current platform', () => {
    // Path separators are normalized based on platform
    const filePath = path.join('/project', 'src', 'pages', 'about.md');
    const rootDir = '/project';
    expect(deriveAstroUrl(filePath, rootDir)).toBe('/about');
  });
});

describe('deriveFileOptions', () => {
  test('derives options for absolute path', () => {
    const id = '/project/src/pages/index.md';
    const rootDir = '/project';
    const options = deriveFileOptions(id, rootDir);
    expect(options.file).toBe('/project/src/pages/index.md');
    expect(options.url).toBe('/');
  });

  test('resolves relative path to absolute', () => {
    const id = 'src/pages/about.md';
    const rootDir = '/project';
    const options = deriveFileOptions(id, rootDir);
    expect(options.file).toBe('/project/src/pages/about.md');
    expect(options.url).toBe('/about');
  });

  test('strips query string before processing', () => {
    const id = '/project/src/pages/blog.md?raw';
    const rootDir = '/project';
    const options = deriveFileOptions(id, rootDir);
    expect(options.file).toBe('/project/src/pages/blog.md');
    expect(options.url).toBe('/blog');
  });

  test('omits url when file is outside pages directory', () => {
    const id = '/project/src/components/Button.astro';
    const rootDir = '/project';
    const options = deriveFileOptions(id, rootDir);
    expect(options.file).toBe('/project/src/components/Button.astro');
    expect(options.url).toBe(undefined);
  });

  test('includes url for nested page files', () => {
    const id = '/project/src/pages/docs/api.mdx';
    const rootDir = '/project';
    const options = deriveFileOptions(id, rootDir);
    expect(options.file).toBe('/project/src/pages/docs/api.mdx');
    expect(options.url).toBe('/docs/api');
  });

  test('handles path without rootDir', () => {
    const id = '/absolute/path/file.md';
    const options = deriveFileOptions(id);
    expect(options.file).toBe('/absolute/path/file.md');
    // url may or may not be present depending on actual file system
  });
});

describe('shouldCompile', () => {
  test('returns true for .md files', () => {
    expect(shouldCompile('/path/to/file.md')).toBe(true);
  });

  test('returns true for .mdx files', () => {
    expect(shouldCompile('/path/to/file.mdx')).toBe(true);
  });

  test('returns false for .js files', () => {
    expect(shouldCompile('/path/to/file.js')).toBe(false);
  });

  test('returns false for .astro files', () => {
    expect(shouldCompile('/path/to/file.astro')).toBe(false);
  });

  test('strips query string before checking extension', () => {
    expect(shouldCompile('/path/to/file.md?raw')).toBe(true);
    expect(shouldCompile('/path/to/file.mdx?import')).toBe(true);
    expect(shouldCompile('/path/to/file.js?raw')).toBe(false);
  });

  test('returns false for paths with no extension', () => {
    expect(shouldCompile('/path/to/README')).toBe(false);
  });

  test('handles uppercase extensions', () => {
    expect(shouldCompile('/path/to/file.MD')).toBe(false); // Case-sensitive
    expect(shouldCompile('/path/to/file.MDX')).toBe(false);
  });
});
