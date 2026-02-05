/**
 * ExpressiveCode component injection and rewriting transforms
 * @module transforms/expressive-code
 */

import { collectImportedNames, insertAfterImports } from '../utils/imports.js';
import type { ExpressiveCodeConfig } from '../utils/config.js';

/**
 * Decodes HTML entities in a string.
 */
export function decodeHtmlEntities(value: string): string {
  if (!value || !value.includes('&')) return value;
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, num: string) =>
      String.fromCodePoint(Number.parseInt(num, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Result of rewriting ExpressiveCode blocks.
 */
export interface RewriteResult {
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
  // Pattern matches <pre> with optional attributes (class, tabindex, etc.)
  // followed by <code> with optional language class
  const pattern =
    /<pre[^>]*><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g;
  let changed = false;
  const next = code.replace(pattern, (_match, lang: string | undefined, raw: string) => {
    changed = true;
    const decoded = decodeHtmlEntities(raw);
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
