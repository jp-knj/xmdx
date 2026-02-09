/**
 * Shiki syntax highlighting transforms for code blocks
 * @module transforms/shiki
 */

/**
 * Shiki highlighter function type.
 */
export type ShikiHighlighter = (code: string, lang?: string) => Promise<string>;

// PERF: Pre-compiled regex patterns at module level to avoid recompilation per-file
const HTML_ENTITY_REGEX = /&(#x?[0-9a-fA-F]+|[a-z]+);/gi;
const JS_ESCAPE_REGEX = /\\(.)/g;
const PRE_TAG_CHECK = /<pre[\s>]/;
const PRE_CODE_REGEX = /<pre[^>]*>\s*<code(?:\s+class="([^"]*)")?[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g;
const JSX_PRE_CODE_REGEX = /<pre[^>]*><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;
const JSX_STRING_DECODE_REGEX = /\{"([^"]*)"\}/g;

/**
 * Decodes HTML entities to plain text.
 * Optimized single-pass decoder for common HTML entities.
 */
function decodeHtmlEntities(text: string): string {
  // Fast path: no entities
  if (!text.includes('&')) {
    return text;
  }

  // PERF: Reset pre-compiled regex for reuse
  HTML_ENTITY_REGEX.lastIndex = 0;
  return text.replace(HTML_ENTITY_REGEX, (match, entity: string) => {
    // Named entities
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
    // Numeric entities
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCharCode(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCharCode(parseInt(entity.slice(1), 10));
    }
    // Unknown entity, return as-is
    return match;
  });
}

/**
 * Decodes JavaScript escape sequences in a string.
 * Optimized single-pass decoder.
 */
function decodeJsEscapes(text: string): string {
  // Fast path: no escapes
  if (!text.includes('\\')) {
    return text;
  }

  // PERF: Reset pre-compiled regex for reuse
  JS_ESCAPE_REGEX.lastIndex = 0;
  return text.replace(JS_ESCAPE_REGEX, (_, char: string) => {
    switch (char) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '\\':
        return '\\';
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return char;
    }
  });
}

/**
 * Highlights code blocks in HTML using Shiki syntax highlighter.
 * Uses regex-based parsing for better performance (avoids parse5 overhead).
 */
export async function highlightHtmlBlocks(
  html: string,
  highlight: ShikiHighlighter
): Promise<string> {
  // PERF: Early skip if no <pre> tags exist
  if (!PRE_TAG_CHECK.test(html)) {
    return html;
  }

  // PERF: Reset pre-compiled regex for reuse
  PRE_CODE_REGEX.lastIndex = 0;

  // Phase 1: Collect all code blocks with their positions
  const toHighlight: Array<{
    start: number;
    end: number;
    lang: string | undefined;
    codeText: string;
  }> = [];

  let match;
  while ((match = PRE_CODE_REGEX.exec(html)) !== null) {
    const [fullMatch, classAttr, rawContent = ''] = match;

    // Skip if already processed by Shiki (has shiki class or data-language)
    if (fullMatch.includes('class="shiki') || fullMatch.includes('data-language')) {
      continue;
    }

    if (!rawContent) {
      continue;
    }

    // Extract language from class attribute (e.g., "foo language-python bar" -> "python")
    const lang = classAttr
      ?.split(/\s+/)
      .find((cls) => cls.startsWith('language-'))
      ?.slice('language-'.length);

    // Decode HTML entities to plain text
    const codeText = decodeHtmlEntities(rawContent).trimEnd();

    if (!codeText) {
      continue;
    }

    toHighlight.push({
      start: match.index,
      end: match.index + fullMatch.length,
      lang,
      codeText,
    });
  }

  if (toHighlight.length === 0) {
    return html;
  }

  // Phase 2: Highlight all code blocks in parallel
  const highlighted = await Promise.all(
    toHighlight.map(({ codeText, lang }) => highlight(codeText, lang || undefined))
  );

  // Phase 3: Apply replacements in reverse order to preserve offsets
  let result = html;
  for (let i = toHighlight.length - 1; i >= 0; i--) {
    const { start, end } = toHighlight[i]!;
    result = result.slice(0, start) + highlighted[i]! + result.slice(end);
  }

  return result;
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
  if (!PRE_TAG_CHECK.test(code)) {
    return code;
  }

  // PERF: Reset pre-compiled regex for reuse
  JSX_PRE_CODE_REGEX.lastIndex = 0;

  // Phase 1: Collect all code blocks with their positions
  const toHighlight: Array<{
    start: number;
    end: number;
    lang: string | undefined;
    codeText: string;
  }> = [];

  let match;
  while ((match = JSX_PRE_CODE_REGEX.exec(code)) !== null) {
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
    // Then decode any remaining HTML entities
    // PERF: Reset pre-compiled regex for reuse
    JSX_STRING_DECODE_REGEX.lastIndex = 0;
    const codeText = decodeHtmlEntities(
      rawContent.replace(JSX_STRING_DECODE_REGEX, (_, str) => decodeJsEscapes(str))
    ).trimEnd();

    if (!codeText) {
      continue;
    }

    toHighlight.push({
      start: match.index,
      end: match.index + fullMatch.length,
      lang,
      codeText,
    });
  }

  if (toHighlight.length === 0) {
    return code;
  }

  // Phase 2: Highlight all code blocks in parallel
  const highlighted = await Promise.all(
    toHighlight.map(({ codeText, lang }) => highlight(codeText, lang || undefined))
  );

  // Phase 3: Apply replacements in reverse order to preserve offsets
  let result = code;
  for (let i = toHighlight.length - 1; i >= 0; i--) {
    const { start, end } = toHighlight[i]!;
    const highlightedHtml = highlighted[i]!;
    // Wrap in set:html to avoid raw { } in JSX context being parsed as expressions
    const replacement = `<_Fragment set:html={${JSON.stringify(highlightedHtml)}} />`;
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}

/**
 * Rewrites Astro set:html fragments with Shiki-highlighted code.
 * Searches for <_Fragment set:html={...} /> patterns and applies syntax highlighting.
 * Processes ALL occurrences in parallel for better performance.
 */
export async function rewriteAstroSetHtml(
  code: string,
  highlight: ShikiHighlighter
): Promise<string> {
  if (!code || typeof code !== 'string') {
    return code;
  }

  const marker = '<_Fragment set:html={';

  // Phase 1: Collect all fragments without awaiting
  const fragments: Array<{
    start: number;
    end: number;
    html: string;
  }> = [];

  let searchStart = 0;
  while (true) {
    const idx = code.indexOf(marker, searchStart);
    if (idx === -1) break;

    const start = idx + marker.length;
    const end = code.indexOf('} />', start);
    if (end === -1) break;

    const literal = code.slice(start, end).trim();
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

    fragments.push({ start, end, html });
    searchStart = end + 4; // Move past this occurrence
  }

  if (fragments.length === 0) {
    return code;
  }

  // Phase 2: Highlight ALL fragments in parallel
  const highlighted = await Promise.all(
    fragments.map(({ html }) => highlightHtmlBlocks(html, highlight))
  );

  // Phase 3: Apply replacements in reverse order to preserve offsets
  let result = code;
  for (let i = fragments.length - 1; i >= 0; i--) {
    const { start, end } = fragments[i]!;
    const encoded = JSON.stringify(highlighted[i]!);
    result = result.slice(0, start) + encoded + result.slice(end);
  }

  return result;
}

