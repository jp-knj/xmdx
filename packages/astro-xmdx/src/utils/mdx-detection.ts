/**
 * MDX pattern detection utilities.
 * @module utils/mdx-detection
 */

import { stripFrontmatter } from './frontmatter.js';
import type { MdxImportHandlingOptions } from '../types.js';

/**
 * Detailed result from pattern detection.
 */
export interface MdxPatternDetectionResult {
  /** Whether problematic patterns were found */
  hasProblematicPatterns: boolean;
  /** Human-readable reason for fallback */
  reason?: string;
  /** Disallowed import sources found (if any) */
  disallowedImports?: string[];
  /** All import sources found */
  allImports?: string[];
}

/**
 * Strip code fences from content to avoid false positives.
 * Uses efficient single-pass character scanning instead of split() and per-line regex.
 */
export function stripCodeFences(content: string): string {
  let result = '';
  let pos = 0;
  let inFence = false;
  let fenceMarker = '';
  let fenceLen = 0;

  while (pos < content.length) {
    // Find end of current line
    let lineEnd = content.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = content.length;

    const line = content.slice(pos, lineEnd);

    // Check for fence at start of line (after trimming leading whitespace)
    let i = 0;
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;

    const char = line[i];
    if (char === '`' || char === '~') {
      let len = 0;
      const marker = char;
      while (line[i] === marker) {
        len++;
        i++;
      }

      if (len >= 3) {
        if (!inFence) {
          // Opening fence
          inFence = true;
          fenceMarker = marker;
          fenceLen = len;
          pos = lineEnd + 1;
          continue;
        } else if (marker === fenceMarker && len >= fenceLen) {
          // Check if rest of line is only whitespace (valid closer)
          const rest = line.slice(i).trim();
          if (rest === '') {
            inFence = false;
            pos = lineEnd + 1;
            continue;
          }
        }
      }
    }

    if (!inFence) {
      result += line;
      if (lineEnd < content.length) result += '\n';
    }

    pos = lineEnd + 1;
  }

  return result;
}

/**
 * Convert a glob-like pattern to a regex.
 * Supports * as wildcard.
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcard = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcard}$`);
}

/**
 * Check if an import source matches any of the allowed patterns.
 */
function isAllowedImport(importSource: string, allowImports: string[]): boolean {
  return allowImports.some((pattern) => {
    const regex = patternToRegex(pattern);
    return regex.test(importSource);
  });
}

/**
 * Extract import sources from content.
 */
function extractImportSources(content: string): string[] {
  const sources: string[] = [];
  // Match: import ... from 'source' or import 'source'
  const importRegex = /^import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) {
      sources.push(match[1]);
    }
  }
  return sources;
}

/**
 * Detect MDX patterns that markdown-rs cannot parse correctly with detailed results.
 * This includes:
 * - MDX import statements (import ... from '...')
 *
 * Note: Export statements are now handled by Rust (hoisted_exports) and no longer
 * trigger fallback. This significantly reduces fallback rate.
 *
 * @param source - The markdown/MDX source content
 * @param options - MDX handling options
 * @returns Detailed detection result with reasons
 */
export function detectProblematicMdxPatterns(
  source: string,
  options?: MdxImportHandlingOptions
): MdxPatternDetectionResult {
  // Skip frontmatter when checking for imports
  let content = stripFrontmatter(source);

  // Optionally strip code fences (default: true when options provided)
  const ignoreCodeFences = options?.ignoreCodeFences ?? true;
  if (ignoreCodeFences) {
    content = stripCodeFences(content);
  }

  // Note: Export statements are now handled by Rust and no longer trigger fallback
  // The Rust compiler extracts exports via collect_root_statements() and includes
  // them in hoisted_exports, which TypeScript then injects into the JSX module.

  // Check for import statements
  const importPatterns = [
    /^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"][^'"]+['"]/m,
    /^import\s+['"][^'"]+['"]/m,
  ];

  const hasImports = importPatterns.some((pattern) => pattern.test(content));
  if (!hasImports) {
    return { hasProblematicPatterns: false };
  }

  const allImports = extractImportSources(content);

  // If no allowed imports configured, any import is problematic
  const allowImports = options?.allowImports;
  if (!allowImports || allowImports.length === 0) {
    return {
      hasProblematicPatterns: true,
      reason: `Contains imports with no allowImports configured: ${allImports.slice(0, 3).join(', ')}${allImports.length > 3 ? ` (+${allImports.length - 3} more)` : ''}`,
      allImports,
      disallowedImports: allImports,
    };
  }

  // Check if all imports are from allowed sources
  const disallowedImports = allImports.filter(
    (src) => !isAllowedImport(src, allowImports)
  );

  if (disallowedImports.length > 0) {
    return {
      hasProblematicPatterns: true,
      reason: `Contains disallowed imports: ${disallowedImports.slice(0, 3).join(', ')}${disallowedImports.length > 3 ? ` (+${disallowedImports.length - 3} more)` : ''}`,
      allImports,
      disallowedImports,
    };
  }

  return {
    hasProblematicPatterns: false,
    allImports,
  };
}

/**
 * Detect MDX patterns that markdown-rs cannot parse correctly.
 * This includes:
 * - MDX import statements (import ... from '...')
 * - MDX export statements (export const ..., export default ...)
 * These are JavaScript constructs that the MDAST pipeline cannot handle.
 *
 * @param source - The markdown/MDX source content
 * @param options - MDX handling options
 */
export function hasProblematicMdxPatterns(
  source: string,
  options?: MdxImportHandlingOptions
): boolean {
  return detectProblematicMdxPatterns(source, options).hasProblematicPatterns;
}
