/**
 * Frontmatter detection and stripping utilities.
 * Uses gray-matter for robust YAML parsing (same approach as @astrojs/mdx).
 * @module utils/frontmatter
 */

import matter from 'gray-matter';

/**
 * Result of parsing frontmatter from a file.
 */
export interface ParsedFrontmatter {
  /** Parsed frontmatter as an object */
  frontmatter: Record<string, unknown>;
  /** Content after frontmatter */
  content: string;
  /** Raw frontmatter YAML string (without delimiters) */
  rawFrontmatter: string;
}

/**
 * Safely parses frontmatter from a file using gray-matter.
 * Returns empty frontmatter if parsing fails.
 */
export function safeParseFrontmatter(
  source: string,
  filename: string
): ParsedFrontmatter {
  try {
    const result = matter(source);
    return {
      frontmatter: result.data ?? {},
      content: result.content,
      rawFrontmatter: result.matter ?? '',
    };
  } catch (error) {
    console.warn(
      `[xmdx] Failed to parse frontmatter in ${filename}: ${(error as Error).message}`
    );
    return {
      frontmatter: {},
      content: source,
      rawFrontmatter: '',
    };
  }
}

/**
 * Strip frontmatter from source, returning content only.
 * If no frontmatter found, returns the original source.
 */
export function stripFrontmatter(source: string): string {
  try {
    return matter(source).content;
  } catch {
    return source;
  }
}

/**
 * Get the byte length of frontmatter (including delimiters).
 * Returns 0 if no frontmatter found.
 */
export function getFrontmatterLength(source: string): number {
  try {
    const result = matter(source);
    // gray-matter doesn't expose the exact length, so calculate it
    // The format is: ---\n{matter}\n---\n{content}
    if (result.matter) {
      // 3 (---) + 1 (\n) + matter.length + 1 (\n) + 3 (---) + 1 (\n) = 9 + matter.length
      return 4 + result.matter.length + 5;
    }
    return 0;
  } catch {
    return 0;
  }
}
