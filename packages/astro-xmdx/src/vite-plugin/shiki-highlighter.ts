/**
 * Shiki highlighter creation utilities
 * @module vite-plugin/shiki-highlighter
 */

import { codeToHtml, createCssVariablesTheme } from 'shiki';
import { SHIKI_THEME } from '../constants.js';
import type { ShikiHighlighter } from '../transforms/shiki.js';

// Re-export for convenience
export type { ShikiHighlighter } from '../transforms/shiki.js';

/**
 * Creates a Shiki highlighter with CSS variables theme.
 * The highlighter is configured to use Xmdx's CSS variable theme for styling.
 *
 * @returns A function that highlights code and returns HTML
 */
export async function createShikiHighlighter(): Promise<ShikiHighlighter> {
  const theme = createCssVariablesTheme({
    name: SHIKI_THEME.name,
    variablePrefix: SHIKI_THEME.variablePrefix,
  });
  const cache = new Map<string, { lang: string }>();

  return async (code: string, lang?: string): Promise<string> => {
    const key = `${lang || 'text'}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = { lang: lang || 'text' };
      cache.set(key, cached);
    }
    const html = await codeToHtml(code, {
      lang: cached.lang,
      theme,
    });
    return html.replace(/<pre class="([^"]*)"/, (_match, classes: string) => {
      const normalized = classes
        .split(/\s+/)
        .filter((value) => value && value !== 'shiki')
        .join(' ');
      const next = normalized ? `${SHIKI_THEME.className} ${normalized}` : SHIKI_THEME.className;
      return `<pre class="${next}"`;
    });
  };
}
