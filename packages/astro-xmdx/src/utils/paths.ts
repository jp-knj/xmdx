/**
 * Path manipulation and URL derivation utilities
 * @module utils/paths
 */

import path from 'node:path';

/**
 * Default file extensions that should be compiled
 */
const DEFAULT_EXTENSIONS = new Set(['.md', '.mdx']);

/**
 * Removes query string from a file ID/path
 */
export function stripQuery(id: string): string {
  if (!id) return id;
  const queryIndex = id.indexOf('?');
  return queryIndex >= 0 ? id.slice(0, queryIndex) : id;
}

/**
 * Normalizes path separators to forward slashes (Unix-style)
 */
export function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Derives the Astro page URL from a file path.
 * Converts file system paths to web URLs following Astro's routing conventions.
 */
export function deriveAstroUrl(filePath: string, rootDir?: string): string | undefined {
  if (!filePath) return undefined;
  const normalizedFile = normalizePath(filePath);
  const root = rootDir ?? process.cwd();
  const pagesDir = normalizePath(path.join(root, 'src', 'pages'));
  if (!normalizedFile.startsWith(pagesDir)) {
    return undefined;
  }
  let relative = normalizedFile.slice(pagesDir.length);
  if (relative.startsWith('/')) {
    relative = relative.slice(1);
  }
  if (!relative) {
    return '/';
  }
  if (relative.endsWith('.md') || relative.endsWith('.mdx')) {
    relative = relative.replace(/\.mdx?$/, '');
  }
  if (relative === '' || relative === 'index') {
    return '/';
  }
  if (relative.endsWith('/index')) {
    relative = relative.slice(0, -'/index'.length);
  }
  return `/${relative}`;
}

/**
 * File options derived from a module ID.
 */
interface FileOptions {
  /** Absolute file path */
  file: string;
  /** Derived URL (if in pages directory) */
  url?: string;
}

/**
 * Derives file options (absolute path and URL) from a Vite module ID.
 */
export function deriveFileOptions(id: string, rootDir?: string): FileOptions {
  const sourcePath = stripQuery(id);
  let absolutePath = sourcePath;
  if (rootDir && !path.isAbsolute(sourcePath)) {
    absolutePath = path.resolve(rootDir, sourcePath);
  }
  const url = deriveAstroUrl(absolutePath, rootDir);
  const options: FileOptions = { file: absolutePath };
  if (url) {
    options.url = url;
  }
  return options;
}

/**
 * Checks if a file should be compiled based on its extension.
 */
export function shouldCompile(id: string): boolean {
  return DEFAULT_EXTENSIONS.has(path.extname(stripQuery(id)));
}
