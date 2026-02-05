/**
 * Shiki syntax highlighting transforms for code blocks
 * @module transforms/shiki
 */

import { parseFragment, serialize } from 'parse5';
import type { DocumentFragment, Node, Element, TextNode } from '../vite-plugin/types.js';

/**
 * Shiki highlighter function type.
 */
export type ShikiHighlighter = (code: string, lang?: string) => Promise<string>;

/**
 * Walks an HTML AST tree and applies a visitor function to each node.
 */
function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  if ('childNodes' in node && node.childNodes) {
    for (const child of node.childNodes) {
      walk(child, visit);
    }
  }
}

/**
 * Gets an attribute value from an HTML AST node.
 */
function getAttr(node: Element, name: string): string | null {
  const attrs = node.attrs || [];
  const found = attrs.find((attr) => attr.name === name);
  return found ? found.value : null;
}

/**
 * Extracts text content from an HTML AST node recursively.
 */
function getText(node: Node): string {
  if (!('childNodes' in node) || !node.childNodes) return '';
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') {
      text += (child as TextNode).value || '';
    } else {
      text += getText(child);
    }
  }
  return text;
}

/**
 * Highlights code blocks in HTML using Shiki syntax highlighter.
 */
export async function highlightHtmlBlocks(
  html: string,
  highlight: ShikiHighlighter
): Promise<string> {
  // PERF: Early skip if no <pre> tags exist (avoids expensive parse5 parsing)
  if (!/<pre[\s>]/.test(html)) {
    return html;
  }

  // Suppress parse5 warnings for JSX components in HTML
  const fragment = parseFragment(html, {
    onParseError: (error) => {
      // Silently ignore end-tag-mismatch errors (typically from JSX in <p> tags)
      if ((error.code as string) === 'end-tag-mismatch') {
        return;
      }
      // Log other parse errors for debugging
      console.warn('[xmdx] parse5 warning:', error);
    },
  }) as DocumentFragment;

  const tasks: Promise<void>[] = [];

  walk(fragment, (node) => {
    if (node.nodeName !== 'pre') return;
    const element = node as Element;
    const codeNode = (element.childNodes || []).find(
      (child): child is Element => child.nodeName === 'code'
    );
    if (!codeNode) return;

    const codeText = getText(codeNode).trimEnd();
    if (!codeText) return;
    const classAttr = getAttr(codeNode, 'class') || '';
    const lang = classAttr
      .split(/\s+/)
      .find((value) => value.startsWith('language-'))
      ?.slice('language-'.length);

    tasks.push(
      highlight(codeText, lang).then((shikiHtml) => {
        const highlighted = parseFragment(shikiHtml) as DocumentFragment;
        const pre = (highlighted.childNodes || []).find(
          (child): child is Element => child.nodeName === 'pre'
        );
        if (pre) {
          element.nodeName = pre.nodeName;
          element.tagName = pre.tagName;
          element.attrs = pre.attrs;
          element.childNodes = pre.childNodes;
        }
      })
    );
  });

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
  return serialize(fragment);
}

/**
 * Checks if a position in the source code is inside a set:html={"..."} JSON string.
 * This prevents double-highlighting of code blocks that were already processed
 * by rewriteAstroSetHtml.
 */
function isInsideSetHtml(code: string, pos: number): boolean {
  // Search backwards from pos for the nearest set:html={
  const marker = 'set:html={';
  let searchFrom = pos;
  while (searchFrom > 0) {
    const idx = code.lastIndexOf(marker, searchFrom - 1);
    if (idx === -1) return false;

    // Found a set:html={, now check if pos is before its closing } />
    const jsonStart = idx + marker.length;
    // The JSON string starts with " — find its end by tracking quotes
    if (code[jsonStart] === '"') {
      // Scan for the closing " that ends the JSON string, respecting escapes
      let i = jsonStart + 1;
      while (i < code.length) {
        if (code[i] === '\\') {
          i += 2; // Skip escaped character
          continue;
        }
        if (code[i] === '"') {
          // Found end of JSON string
          const jsonEnd = i + 1; // Position after closing "
          if (pos >= jsonStart && pos < jsonEnd) {
            return true; // pos is inside this JSON string
          }
          break;
        }
        i++;
      }
    }
    // Try searching further back
    searchFrom = idx;
  }
  return false;
}

/**
 * Highlights code blocks that appear directly in JSX (not in set:html).
 * Handles cases where slot content with components is embedded directly,
 * causing code blocks to bypass the set:html path.
 *
 * JSX code blocks appear as: <pre><code class="language-js">{"code"}</code></pre>
 * After html_entities_to_jsx() content may be: {"line1"}{"\n"}{"line2"}
 */
export async function highlightJsxCodeBlocks(
  code: string,
  highlight: ShikiHighlighter
): Promise<string> {
  if (!code || typeof code !== 'string') {
    return code;
  }

  // Early skip if no <pre> tags in JSX context
  if (!/<pre[\s>]/.test(code)) {
    return code;
  }

  // Match <pre> with optional attributes followed by <code class="language-xxx">content</code></pre>
  // Content may contain JSX expressions like {"text"} or HTML entities
  const preCodeRegex = /<pre[^>]*><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

  const replacements: { match: string; replacement: string }[] = [];

  let match;
  while ((match = preCodeRegex.exec(code)) !== null) {
    const [fullMatch, lang, rawContent = ''] = match;

    // Skip if already processed by Shiki (has shiki class or data-language)
    if (fullMatch.includes('class="shiki') || fullMatch.includes('data-language')) {
      continue;
    }

    // Skip if this <pre> is inside a set:html JSON string (already handled by rewriteAstroSetHtml)
    if (isInsideSetHtml(code, match.index)) {
      continue;
    }

    // Skip empty code blocks
    if (!rawContent) {
      continue;
    }

    // Decode JSX expressions back to plain text
    // Pattern: {"string"} or {"\n"} etc.
    let codeText = rawContent
      // Decode JSX string expressions: {"text"} -> text
      .replace(/\{"([^"]*)"\}/g, (_, str) => {
        // Handle escape sequences
        return str
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\\\/g, '\\')
          .replace(/\\"/g, '"');
      })
      // Decode HTML entities that might remain
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/&#(\d+);/g, (_, num) =>
        String.fromCharCode(parseInt(num, 10))
      );

    // Trim trailing whitespace but preserve internal structure
    codeText = codeText.trimEnd();

    if (!codeText) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const highlighted = await highlight(codeText, lang || undefined);
    // Wrap in set:html to avoid raw { } in JSX context being parsed as expressions
    const safeReplacement = `<_Fragment set:html={${JSON.stringify(highlighted)}} />`;
    replacements.push({ match: fullMatch, replacement: safeReplacement });
  }

  // Apply replacements
  let result = code;
  for (const { match, replacement } of replacements) {
    result = result.replace(match, replacement);
  }

  return result;
}

/**
 * Rewrites Astro set:html fragments with Shiki-highlighted code.
 * Searches for <_Fragment set:html={...} /> patterns and applies syntax highlighting.
 * Processes ALL occurrences in the code, not just the first one.
 */
export async function rewriteAstroSetHtml(
  code: string,
  highlight: ShikiHighlighter
): Promise<string> {
  if (!code || typeof code !== 'string') {
    return code;
  }

  const marker = '<_Fragment set:html={';
  let result = code;
  let searchStart = 0;

  // Process ALL occurrences in a loop
  while (true) {
    const idx = result.indexOf(marker, searchStart);
    if (idx === -1) break;

    const start = idx + marker.length;
    const end = result.indexOf('} />', start);
    if (end === -1) break;

    const literal = result.slice(start, end).trim();
    if (!literal) {
      searchStart = end;
      continue;
    }

    let html: string;
    try {
      html = JSON.parse(literal) as string;
    } catch {
      searchStart = end;
      continue;
    }

    const rewritten = await highlightHtmlBlocks(html, highlight);
    const encoded = JSON.stringify(rewritten);
    result = result.slice(0, start) + encoded + result.slice(end);
    searchStart = start + encoded.length + 4; // Move past this occurrence
  }

  return result;
}
