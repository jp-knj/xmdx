/**
 * ExpressiveCode component injection and rewriting transforms
 * @module transforms/expressive-code
 */

import { collectImportedNames, insertAfterImports } from '../utils/imports.js';
import type { ExpressiveCodeConfig } from '../utils/config.js';


// PERF: Pre-compiled regex patterns at module level to avoid recompilation per-file
const HTML_ENTITY_REGEX = /&(#x?[0-9a-fA-F]+|[a-z]+);/gi;
const PRE_CODE_PATTERN = /<pre[^>]*><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g;
// Uses "unrolled loop" pattern for better backtracking performance
const JS_STRING_CODE_PATTERN =
  /"<pre[^"\\]*(?:\\.[^"\\]*)*><code(?:\s+class=\\"language-([^"\\]+)\\")?>((?:[^"\\]*(?:\\.[^"\\]*)*)?)<\/code><\/pre>"/g;
const JS_ESCAPE_PATTERN = /\\(.|$)/g;

/**
 * Decodes HTML entities in a string.
 * Optimized single-pass decoder.
 */
export function decodeHtmlEntities(value: string): string {
  if (!value || !value.includes('&')) return value;

  // Reset regex lastIndex for reuse (global regex stateful)
  HTML_ENTITY_REGEX.lastIndex = 0;
  return value.replace(HTML_ENTITY_REGEX, (match, entity: string) => {
    switch (entity) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      case 'nbsp':
        return '\u00A0';
    }
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return match;
  });
}

/**
 * Result of rewriting ExpressiveCode blocks.
 */
interface RewriteResult {
  /** The transformed code */
  code: string;
  /** Whether any changes were made */
  changed: boolean;
}

/**
 * Rewrites <pre><code> blocks to ExpressiveCode components.
 */
export function rewriteExpressiveCodeBlocks(
  code: string,
  componentName: string
): RewriteResult {
  if (!code || typeof code !== 'string') {
    return { code, changed: false };
  }

  // PERF: Fast check before expensive regex
  if (!code.includes('<pre')) {
    return { code, changed: false };
  }

  // Pattern matches <pre> with optional attributes (class, tabindex, etc.)
  // followed by <code> with optional language class
  // PERF: Reset pre-compiled regex for reuse
  PRE_CODE_PATTERN.lastIndex = 0;
  let changed = false;
  const next = code.replace(PRE_CODE_PATTERN, (match, lang: string | undefined, raw: string) => {
    const decoded = decodeHtmlEntities(raw);
    // Skip empty code blocks
    if (!decoded.trim()) return match;
    changed = true;
    const props = [`code={${JSON.stringify(decoded)}}`];
    if (lang) {
      props.push(`lang="${lang}"`);
    }
    return `<${componentName} ${props.join(' ')} />`;
  });
  return { code: next, changed };
}

/**
 * Rewrites code blocks that appear as JS string literals with escaped quotes.
 *
 * This handles the output from mdxjs-rs where code blocks are converted to:
 * "<pre class=\"astro-code\" tabindex=\"0\"><code class=\"language-sh\">...</code></pre>"
 *
 * The pattern matches the escaped version and converts it to ExpressiveCode components.
 */
export function rewriteJsStringCodeBlocks(
  code: string,
  componentName: string
): RewriteResult {
  if (!code || typeof code !== 'string') {
    return { code, changed: false };
  }

  // PERF: Fast check before expensive regex - skip if no escaped pre tags
  if (!code.includes('<pre') && !code.includes('\\u003cpre')) {
    return { code, changed: false };
  }

  // Pattern matches JS string literals containing code blocks with escaped quotes
  // The input contains literal backslash-quote sequences like: \"
  //
  // Example input: "<pre class=\"astro-code\" tabindex=\"0\"><code class=\"language-sh\">npm install</code></pre>"
  //
  // PERF: Uses pre-compiled "unrolled loop" pattern for better performance
  JS_STRING_CODE_PATTERN.lastIndex = 0;

  let changed = false;
  const next = code.replace(JS_STRING_CODE_PATTERN, (match, lang: string | undefined, escapedContent: string) => {
    // Unescape the content in a single pass
    // Handle escape sequences: \\ -> \, \n -> newline, \t -> tab, \r -> CR, \" -> "
    JS_ESCAPE_PATTERN.lastIndex = 0;
    const content = escapedContent.replace(JS_ESCAPE_PATTERN, (_, char: string) => {
      switch (char) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case '"':
          return '"';
        case '\\':
          return '\\';
        default:
          return char;
      }
    });
    const decoded = decodeHtmlEntities(content);
    // Skip empty code blocks
    if (!decoded.trim()) return match;
    changed = true;
    const props = [`code={${JSON.stringify(decoded)}}`];
    if (lang) {
      props.push(`lang="${lang}"`);
    }
    return `<${componentName} ${props.join(' ')} />`;
  });
  return { code: next, changed };
}

/**
 * Rewrites code blocks inside Fragment set:html JSON strings.
 *
 * Handles: <_Fragment set:html={"<pre><code>...</code></pre>"} />
 *
 * When a code block inside a slot is transformed to ExpressiveCode component,
 * the entire Fragment wrapper is replaced with the component directly.
 */
export function rewriteSetHtmlCodeBlocks(
  code: string,
  componentName: string
): RewriteResult {
  if (!code || typeof code !== 'string') {
    return { code, changed: false };
  }

  const marker = '<_Fragment set:html={';

  // PERF: Fast check before searching
  if (!code.includes(marker)) {
    return { code, changed: false };
  }
  let result = code;
  let changed = false;
  let searchStart = 0;

  while (true) {
    const idx = result.indexOf(marker, searchStart);
    if (idx === -1) break;

    const start = idx + marker.length;
    const end = result.indexOf('} />', start);
    if (end === -1) break;

    const literal = result.slice(start, end).trim();
    let html: string;
    try {
      html = JSON.parse(literal) as string;
    } catch {
      searchStart = end;
      continue;
    }

    // Apply ExpressiveCode rewrite to the HTML content
    const rewritten = rewriteExpressiveCodeBlocks(html, componentName);
    if (rewritten.changed) {
      changed = true;
      // If the rewritten content now has components, embed directly
      // (replace the entire Fragment set:html wrapper)
      if (/<[A-Z]/.test(rewritten.code)) {
        // Replace Fragment set:html with direct content
        result = result.slice(0, idx) + rewritten.code + result.slice(end + 4);
        searchStart = idx + rewritten.code.length;
      } else {
        // Still pure HTML, re-encode
        const encoded = JSON.stringify(rewritten.code);
        result = result.slice(0, start) + encoded + result.slice(end);
        searchStart = start + encoded.length + 4;
      }
    } else {
      searchStart = end + 4;
    }
  }

  return { code: result, changed };
}

/**
 * Injects ExpressiveCode component import if needed.
 */
export function injectExpressiveCodeComponent(
  code: string,
  config: ExpressiveCodeConfig
): string {
  if (!code || typeof code !== 'string') {
    return code;
  }
  const importName = config.component;
  const imported = collectImportedNames(code);
  if (imported.has(importName)) {
    return code;
  }
  const importLine =
    importName === 'Code'
      ? `import { Code } from '${config.moduleId}';`
      : `import { Code as ${importName} } from '${config.moduleId}';`;
  return insertAfterImports(code, importLine);
}

