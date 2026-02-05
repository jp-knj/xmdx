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
 */
export function stripCodeFences(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inFence = false;
  let fenceMarker = '';
  let fenceLen = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const backtickMatch = trimmed.match(/^(`{3,})/);
    const tildeMatch = trimmed.match(/^(~{3,})/);
    const match = backtickMatch || tildeMatch;

    if (match && match[1]) {
      const marker = match[1][0]!;
      const len = match[1].length;

      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        fenceLen = len;
        continue;
      } else if (marker === fenceMarker && len >= fenceLen && trimmed.replace(/^[`~]+/, '').trim() === '') {
        // Closing fence: same marker, >= length, no info string
        inFence = false;
        continue;
      }
    }

    if (!inFence) {
      result.push(line);
    }
  }
  return result.join('\n');
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
