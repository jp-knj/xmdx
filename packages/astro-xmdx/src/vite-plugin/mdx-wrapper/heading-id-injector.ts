/**
 * Injects `id` props into heading JSX calls in mdxjs-rs compiled output.
 * @module vite-plugin/heading-id-injector
 */

import {
  extractQuotedString,
  extractArrayInner,
  collectStringLiterals,
} from './string-utils.js';

// PERF: Pre-compiled pattern for heading JSX calls
const HEADING_JSX_PATTERN = /_jsxs?\(_components\.h([1-6]),\s*\{/g;

interface HeadingCall {
  offset: number;       // offset of the full match in code
  matchLen: number;      // length of the regex match
  depth: number;
  childrenText: string | null;  // extracted text, or null if JSX children
  slug: string | null;   // assigned slug (null = unmatched so far)
}

/**
 * Extracts text from a single JSX call's children by finding the inner
 * `{ children: ... }` and recursively extracting text from it.
 *
 * Handles patterns like `_jsx(_components.em, { children: "Intro" })`.
 */
function extractTextFromJsxChildren(jsxCall: string): string | null {
  const braceIdx = jsxCall.indexOf('{');
  if (braceIdx < 0) return null;
  const propsRegion = jsxCall.slice(braceIdx + 1);
  const childrenMatch = /children:\s*/.exec(propsRegion);
  if (!childrenMatch) return null;

  const innerAfter = propsRegion.slice(childrenMatch.index + childrenMatch[0].length);

  // String children
  if (innerAfter.startsWith('"')) {
    return extractQuotedString(innerAfter);
  }

  // Array children without nested JSX
  if (innerAfter.startsWith('[')) {
    const inner = extractArrayInner(innerAfter);
    if (inner.includes('_jsx')) return null;
    return collectStringLiterals(inner) || null;
  }

  // Nested JSX call (e.g., _jsx(em, { children: _jsx(strong, { children: "deep" }) }))
  if (innerAfter.startsWith('_jsx')) {
    return extractTextFromJsxChildren(innerAfter);
  }

  return null;
}

/**
 * Extracts a plain-text string from the children value following a heading JSX call.
 *
 * Handles simple string children (`children: "Hello"`), array children
 * where we concatenate all string literals (`children: ["Hello", " ", "World"]`),
 * and single JSX-wrapping elements (`children: _jsx(_components.em, { children: "Intro" })`).
 * Returns null if children cannot be reliably extracted.
 */
function extractChildrenText(code: string, propsStart: number): string | null {
  const searchRegion = code.slice(propsStart, propsStart + 500);
  const childrenMatch = /children:\s*/.exec(searchRegion);
  if (!childrenMatch) return null;

  const afterChildren = searchRegion.slice(childrenMatch.index + childrenMatch[0].length);

  // Case 1: children: "simple string" (handle escaped quotes)
  if (afterChildren.startsWith('"')) {
    return extractQuotedString(afterChildren);
  }

  // Case 2: children: ["part1", _jsx(...), "part2", ...]
  // Concatenate only string literals for matching.
  if (afterChildren.startsWith('[')) {
    const inner = extractArrayInner(afterChildren);
    // If array contains JSX calls, tag name strings would pollute
    // the extracted text. Fall back to sequential matching.
    if (inner.includes('_jsx')) {
      return null;
    }
    return collectStringLiterals(inner) || null;
  }

  // Case 3: children: _jsx*(_components.em, { children: "Intro" })
  // Single JSX wrapping element (e.g., ## *Intro*, ## **Bold**)
  if (afterChildren.startsWith('_jsx')) {
    return extractTextFromJsxChildren(afterChildren);
  }

  return null;
}

/**
 * Extracts the leading string literal(s) from array children, even when JSX
 * calls are present. Returns the concatenated text of string literals that
 * appear before the first _jsx call, or null if children aren't an array.
 * This partial prefix can be used to fuzzy-match headings in the fallback path.
 *
 * Also handles single JSX call children (e.g., `_jsx(em, { children: "text" })`)
 * by extracting the inner text as the prefix.
 */
function extractChildrenPrefix(code: string, propsStart: number): string | null {
  const searchRegion = code.slice(propsStart, propsStart + 500);
  const childrenMatch = /children:\s*/.exec(searchRegion);
  if (!childrenMatch) return null;
  const afterChildren = searchRegion.slice(childrenMatch.index + childrenMatch[0].length);

  // Single JSX call children — extract inner text as prefix
  if (afterChildren.startsWith('_jsx')) {
    return extractTextFromJsxChildren(afterChildren);
  }

  if (!afterChildren.startsWith('[')) return null;
  const inner = extractArrayInner(afterChildren);
  // Extract text only up to the first _jsx call
  const jsxPos = inner.indexOf('_jsx');
  const prefix = jsxPos >= 0 ? inner.slice(0, jsxPos) : inner;
  const text = collectStringLiterals(prefix);
  if (text) return text;

  // Leading _jsx call in array — extract inner text as prefix
  if (jsxPos >= 0 && prefix.trim() === '') {
    const jsxPart = inner.slice(jsxPos);
    return extractTextFromJsxChildren(jsxPart);
  }

  return null;
}

/**
 * Injects `id` props into heading JSX calls in mdxjs-rs compiled output.
 *
 * mdxjs-rs generates `_jsx(_components.h2, { children: "..." })` without `id` attributes.
 * This function adds the corresponding slug from the extracted headings array so that
 * the rendered HTML has proper fragment anchors (e.g., `<h2 id="getting-started">`).
 *
 * Matches heading calls to the extracted headings by depth and text content rather than
 * sequential order, so setext or other heading types that aren't in the extracted headings
 * array don't cause ID misalignment.
 */
export function injectHeadingIds(
  code: string,
  headings: Array<{ depth: number; slug: string; text: string }>
): string {
  if (headings.length === 0) return code;

  // --- Pass 1: scan all heading JSX calls and attempt text-based matching ---

  // Build a queue of headings indexed by "depth:text" for O(1) lookup.
  const headingMap = new Map<string, Array<{ slug: string; used: boolean }>>();
  for (const h of headings) {
    const key = `${h.depth}:${h.text}`;
    let list = headingMap.get(key);
    if (!list) {
      list = [];
      headingMap.set(key, list);
    }
    list.push({ slug: h.slug, used: false });
  }

  // Collect all heading calls
  const calls: HeadingCall[] = [];
  HEADING_JSX_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_JSX_PATTERN.exec(code)) !== null) {
    const depth = Number.parseInt(m[1]!, 10);
    const propsStart = m.index + m[0].length;
    const childrenText = extractChildrenText(code, propsStart);
    calls.push({ offset: m.index, matchLen: m[0].length, depth, childrenText, slug: null });
  }

  // First, match calls that have extractable text (content-based matching)
  for (const call of calls) {
    if (call.childrenText === null) continue;
    const key = `${call.depth}:${call.childrenText}`;
    const entries = headingMap.get(key);
    if (entries) {
      const entry = entries.find(e => !e.used);
      if (entry) {
        entry.used = true;
        call.slug = entry.slug;
      }
      // else: no unused entry → setext heading with extractable text, left unmatched
    }
  }

  // --- Pass 2: fallback for calls where text extraction failed (JSX children) ---
  // These calls have array children containing _jsx calls so full text extraction
  // failed. We use the leading string prefix (text before the first _jsx call) to
  // match against unused heading entries. A call whose prefix matches a heading's
  // text beginning gets that slug; unmatched calls (setext extras) are left without.
  //
  // Collect unused heading entries per depth in document order.
  // Use a separate "claimed" set to avoid double-counting entries
  // that share the same headingMap key (duplicate heading text).
  const unusedByDepth = new Map<number, Array<{ text: string; slug: string }>>();
  const claimed = new Set<{ slug: string; used: boolean }>();
  for (const h of headings) {
    const key = `${h.depth}:${h.text}`;
    const entries = headingMap.get(key);
    if (!entries) continue;
    const entry = entries.find(e => !e.used && !claimed.has(e));
    if (!entry) continue;
    claimed.add(entry);
    let list = unusedByDepth.get(h.depth);
    if (!list) {
      list = [];
      unusedByDepth.set(h.depth, list);
    }
    list.push({ text: h.text, slug: entry.slug });
  }

  for (const call of calls) {
    if (call.slug !== null || call.childrenText !== null) continue;

    const unused = unusedByDepth.get(call.depth);
    if (!unused || unused.length === 0) continue;

    // Extract the leading text prefix from the array children
    const prefix = extractChildrenPrefix(code, call.offset + call.matchLen);

    // Try to find an unused heading whose text starts with this prefix
    let matched = -1;
    if (prefix) {
      matched = unused.findIndex(u => u.text.startsWith(prefix));
    }

    // If no prefix available at all (e.g. children is a single JSX expression
    // with no leading string literal) and there's only one unused heading at
    // this depth, assign it (no ambiguity). But if we *do* have a prefix that
    // simply didn't match, this call is an extra (setext) — don't assign.
    if (matched < 0 && !prefix && unused.length === 1) {
      matched = 0;
    }

    if (matched >= 0) {
      const entry = unused[matched]!;
      call.slug = entry.slug;
      // Mark used in the headingMap
      const key = `${call.depth}:${entry.text}`;
      const mapEntries = headingMap.get(key);
      const mapEntry = mapEntries?.find(e => e.slug === entry.slug);
      if (mapEntry) mapEntry.used = true;
      unused.splice(matched, 1);
    }
  }

  // --- Build result by replacing matched calls with id-injected versions ---
  let result = '';
  let lastEnd = 0;
  for (const call of calls) {
    result += code.slice(lastEnd, call.offset + call.matchLen);
    if (call.slug !== null) {
      result += `\n                id: ${JSON.stringify(call.slug)},`;
    }
    lastEnd = call.offset + call.matchLen;
  }
  result += code.slice(lastEnd);
  return result;
}
