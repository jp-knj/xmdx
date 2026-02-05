/**
 * Core type definitions for Xmdx compiler.
 * @module types
 */

/**
 * Heading metadata extracted from the document.
 */
export interface HeadingEntry {
  /** Heading depth (1-6). */
  depth: number;
  /** Slugified identifier. */
  slug: string;
  /** Visible heading text. */
  text: string;
}

/**
 * Options for the compile function.
 */
export interface CompileOptions {
  /** File path for error messages and `export const file`. */
  filepath?: string;
  /** Route URL associated with the file. */
  url?: string;
}

/**
 * Result of compiling MDX to an Astro-compatible module.
 */
export interface CompileResult {
  /** Generated JavaScript/JSX module code. */
  code: string;
  /** Parsed frontmatter object. */
  frontmatter: Record<string, unknown>;
  /** Extracted heading metadata. */
  headings: HeadingEntry[];
  /** Whether the user provided their own export default. */
  hasUserDefaultExport: boolean;
}
