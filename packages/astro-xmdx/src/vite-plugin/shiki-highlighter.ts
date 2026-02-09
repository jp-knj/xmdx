/**
 * Shiki highlighter creation utilities
 * @module vite-plugin/shiki-highlighter
 */

import { createHash } from 'node:crypto';
import { codeToHtml, createCssVariablesTheme } from 'shiki';
import { SHIKI_THEME } from '../constants.js';
import type { ShikiHighlighter } from '../transforms/shiki.js';

// Re-export for convenience
export type { ShikiHighlighter } from '../transforms/shiki.js';

/**
 * Creates a fast hash for cache keys.
 * Uses MD5 for speed (not security-sensitive).
 */
function hashCode(lang: string, code: string): string {
  return createHash('md5').update(`${lang}\0${code}`).digest('hex');
}

/**
 * Creates a Shiki highlighter with CSS variables theme.
 * The highlighter is configured to use Xmdx's CSS variable theme for styling.
 * Includes content-addressable caching for duplicate code blocks.
 *
 * @returns A function that highlights code and returns HTML
 */
export async function createShikiHighlighter(): Promise<ShikiHighlighter> {
  const theme = createCssVariablesTheme({
    name: SHIKI_THEME.name,
    variablePrefix: SHIKI_THEME.variablePrefix,
  });

  // Content-addressable cache: hash(lang + code) -> highlighted HTML
  // This eliminates duplicate highlighting across pages (e.g., "npm install" blocks)
  const highlightCache = new Map<string, string>();

  return async (code: string, lang?: string): Promise<string> => {
    const effectiveLang = lang || 'text';

    // Check cache first
    const cacheKey = hashCode(effectiveLang, code);
    const cached = highlightCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Highlight and cache result
    const html = await codeToHtml(code, {
      lang: effectiveLang,
      theme,
    });

    const result = html.replace(/<pre class="([^"]*)"/, (_match, classes: string) => {
      const normalized = classes
        .split(/\s+/)
        .filter((value) => value && value !== 'shiki')
        .join(' ');
      const next = normalized ? `${SHIKI_THEME.className} ${normalized}` : SHIKI_THEME.className;
      return `<pre class="${next}"`;
    });

    highlightCache.set(cacheKey, result);
    return result;
  };
}
