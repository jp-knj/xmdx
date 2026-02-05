/**
 * Frontmatter detection and stripping utilities.
 * @module utils/frontmatter
 */

/**
 * Robust frontmatter regex that handles:
 * - Optional BOM at file start
 * - Optional leading blank lines
 * - Trailing spaces after `---`
 * - Both `---` and `...` as closing markers (YAML spec)
 */
const FRONTMATTER_REGEX =
  /^\uFEFF?(?:\s*\r?\n)*---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/**
 * Strip frontmatter from source, returning content only.
 * If no frontmatter found, returns the original source.
 */
export function stripFrontmatter(source: string): string {
  const match = source.match(FRONTMATTER_REGEX);
  if (!match) return source;
  return source.slice(match[0].length);
}

/**
 * Get the byte length of frontmatter (including delimiters).
 * Returns 0 if no frontmatter found.
 */
export function getFrontmatterLength(source: string): number {
  const match = source.match(FRONTMATTER_REGEX);
  return match ? match[0].length : 0;
}
