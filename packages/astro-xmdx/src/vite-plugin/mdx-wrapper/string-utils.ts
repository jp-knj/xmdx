/**
 * Pure string-manipulation helpers used by heading-id-injector.
 * @module vite-plugin/string-utils
 */

/** Unescape common JS string escape sequences. */
export function unescapeJsString(s: string): string {
  return s.replace(/\\(["'\\nrt])/g, (_match, ch) => {
    switch (ch) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      default: return ch;   // handles \\, \", \'
    }
  });
}

/**
 * Extracts a quoted string starting at the beginning of `s`.
 * Returns null if `s` doesn't start with a double quote.
 */
export function extractQuotedString(s: string): string | null {
  if (!s.startsWith('"')) return null;
  let i = 1;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '"') break;
    i++;
  }
  if (i < s.length) return unescapeJsString(s.slice(1, i));
  return null;
}

/** Extract the content between balanced brackets from a string starting with '['. */
export function extractArrayInner(s: string): string {
  let depth = 1;
  let end = 1;
  for (let i = 1; i < s.length && depth > 0; i++) {
    if (s[i] === '[') depth++;
    else if (s[i] === ']') depth--;
    if (depth === 0) { end = i; break; }
  }
  return s.slice(1, end);
}

/** Concatenate all JS string literals in a code fragment, unescaping each. */
export function collectStringLiterals(fragment: string): string {
  const STR_RE = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let text = '';
  let m: RegExpExecArray | null;
  while ((m = STR_RE.exec(fragment)) !== null) {
    if (m[1] != null) text += unescapeJsString(m[1]);
  }
  return text;
}
