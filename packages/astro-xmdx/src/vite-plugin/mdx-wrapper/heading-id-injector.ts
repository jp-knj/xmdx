/**
 * Injects `id` props into heading JSX calls in mdxjs-rs compiled output.
 * @module vite-plugin/heading-id-injector
 */

import { extractArrayInner, extractQuotedString } from './string-utils.js';

// Match heading calls emitted as _components.hN, bare hN, or string tags like "h3".
const HEADING_JSX_PATTERN = /_jsxs?\((?:(?:_components\.)?h([1-6])|["']h([1-6])["']),\s*\{/g;

interface HeadingCall {
  offset: number;
  matchLen: number;
  depth: number;
  childrenText: string | null;
  slug: string | null;
  isStringTag: boolean;
}

type HeadingEntry = { depth: number; slug: string; text: string };

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  shy: '',
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : match;
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_HTML_ENTITIES[entity] ?? match;
  });
}

function normalizeHeadingText(text: string): string {
  return decodeHtmlEntities(text)
    .normalize('NFKC')
    .replace(/\u00AD/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyHeadingText(text: string): string {
  const slug = normalizeHeadingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
  return slug || 'heading';
}

function splitTopLevelExpressions(fragment: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(fragment.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(fragment.slice(start));
  return parts;
}

function extractPropValue(propsRegion: string, propName: string): string | null {
  const propMatch = new RegExp(`\\b${propName}:\\s*`).exec(propsRegion);
  if (!propMatch) return null;

  const start = propMatch.index + propMatch[0].length;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote: '"' | "'" | null = null;
  let end = propsRegion.length;

  for (let i = start; i < propsRegion.length; i++) {
    const ch = propsRegion[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && (ch === ',' || ch === '}')) {
      end = i;
      break;
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
  }

  return propsRegion.slice(start, end).trim() || null;
}

function extractTextFromExpression(expr: string, allowPartial = false): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;

  const quoted = extractQuotedString(trimmed);
  if (quoted !== null) return quoted;

  if (trimmed.startsWith('[')) {
    const inner = extractArrayInner(trimmed);
    let text = '';
    let sawPart = false;

    for (const part of splitTopLevelExpressions(inner)) {
      const partText = extractTextFromExpression(part, allowPartial);
      if (partText === null) {
        if (allowPartial) break;
        return null;
      }
      text += partText;
      sawPart = true;
    }

    return sawPart ? text : null;
  }

  if (trimmed.startsWith('_jsx')) {
    return extractTextFromJsxChildren(trimmed, allowPartial);
  }

  return null;
}

function extractTextFromJsxChildren(jsxCall: string, allowPartial = false): string | null {
  const braceIdx = jsxCall.indexOf('{');
  if (braceIdx < 0) return null;
  const propsRegion = jsxCall.slice(braceIdx + 1);
  const childrenExpr = extractPropValue(propsRegion, 'children');
  if (!childrenExpr) return null;
  return extractTextFromExpression(childrenExpr, allowPartial);
}

function extractChildrenText(code: string, propsStart: number): string | null {
  const searchRegion = code.slice(propsStart, propsStart + 1200);
  const childrenExpr = extractPropValue(searchRegion, 'children');
  if (!childrenExpr) return null;
  return extractTextFromExpression(childrenExpr);
}

function extractChildrenPrefix(code: string, propsStart: number): string | null {
  const searchRegion = code.slice(propsStart, propsStart + 1200);
  const childrenExpr = extractPropValue(searchRegion, 'children');
  if (!childrenExpr) return null;
  return extractTextFromExpression(childrenExpr, true);
}

function collectHeadingCalls(code: string): HeadingCall[] {
  const calls: HeadingCall[] = [];
  HEADING_JSX_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = HEADING_JSX_PATTERN.exec(code)) !== null) {
    const depth = Number.parseInt(match[1] ?? match[2] ?? '', 10);
    const propsStart = match.index + match[0].length;
    calls.push({
      offset: match.index,
      matchLen: match[0].length,
      depth,
      childrenText: extractChildrenText(code, propsStart),
      slug: null,
      isStringTag: match[2] != null,
    });
  }

  return calls;
}

export function repairHeadings(code: string, headings: HeadingEntry[]): HeadingEntry[] {
  const calls = collectHeadingCalls(code);
  if (calls.length === 0) return headings;

  const normalizedHeadings = headings.map((heading) => ({
    ...heading,
    normalizedText: normalizeHeadingText(heading.text),
  }));
  const usedHeadingIndexes = new Set<number>();
  const matchedByIndex = new Map<number, HeadingEntry>();

  // Two-pass matching: component-ref calls first, then string-tag calls
  for (const pass of [false, true] as const) {
    for (const call of calls) {
      if (call.isStringTag !== pass) continue;

      if (call.childrenText) {
        // --- Full text match ---
        const normalizedText = normalizeHeadingText(call.childrenText);
        const matchedIndex = normalizedHeadings.findIndex(
          (heading, index) =>
            !usedHeadingIndexes.has(index) &&
            heading.depth === call.depth &&
            heading.normalizedText === normalizedText
        );

        if (matchedIndex >= 0) {
          usedHeadingIndexes.add(matchedIndex);
          const h = headings[matchedIndex]!;
          matchedByIndex.set(matchedIndex, { depth: h.depth, slug: h.slug, text: h.text });
        }
        // No match: skip — don't synthesize slugs (P2 fix)
        continue;
      }

      // --- childrenText is null: try prefix matching (P1 fix) ---
      const prefix = extractChildrenPrefix(code, call.offset + call.matchLen);
      const normalizedPrefix = prefix ? normalizeHeadingText(prefix) : null;

      let matchedIndex = -1;
      if (normalizedPrefix) {
        matchedIndex = normalizedHeadings.findIndex(
          (heading, index) =>
            !usedHeadingIndexes.has(index) &&
            heading.depth === call.depth &&
            heading.normalizedText.startsWith(normalizedPrefix)
        );
      }
      // Single-candidate fallback when no prefix could be extracted
      if (matchedIndex < 0 && !normalizedPrefix) {
        const candidates = normalizedHeadings
          .map((h, i) => ({ h, i }))
          .filter(({ h, i }) => !usedHeadingIndexes.has(i) && h.depth === call.depth);
        if (candidates.length === 1) matchedIndex = candidates[0]!.i;
      }

      if (matchedIndex >= 0) {
        usedHeadingIndexes.add(matchedIndex);
        const h = headings[matchedIndex]!;
        matchedByIndex.set(matchedIndex, { depth: h.depth, slug: h.slug, text: h.text });
      }
      // else: skip — injectHeadingIds fallback will handle it
    }
  }

  // Build final array preserving original heading order
  const result: HeadingEntry[] = [];
  for (let i = 0; i < headings.length; i++) {
    if (usedHeadingIndexes.has(i)) {
      result.push(matchedByIndex.get(i)!);
    } else {
      const h = headings[i]!;
      result.push({ depth: h.depth, slug: h.slug, text: h.text });
    }
  }
  return result.length > 0 ? result : headings;
}

/**
 * Injects `id` props into heading JSX calls in mdxjs-rs compiled output.
 */
export function injectHeadingIds(code: string, headings: HeadingEntry[]): string {
  if (headings.length === 0) return code;

  const headingMap = new Map<string, Array<{ slug: string; used: boolean; rawText: string }>>();
  for (const heading of headings) {
    const key = `${heading.depth}:${normalizeHeadingText(heading.text)}`;
    const entries = headingMap.get(key) ?? [];
    entries.push({ slug: heading.slug, used: false, rawText: heading.text });
    headingMap.set(key, entries);
  }

  const calls = collectHeadingCalls(code);

  // Two-pass exact-text matching: component-ref calls first, then string-tag calls
  for (const pass of [false, true] as const) {
    for (const call of calls) {
      if (call.isStringTag !== pass) continue;
      if (call.childrenText === null) continue;
      const key = `${call.depth}:${normalizeHeadingText(call.childrenText)}`;
      const entries = headingMap.get(key);
      if (!entries) continue;
      // Prefer exact raw-text match over normalized-only match
      let entry = entries.find((candidate) => !candidate.used && candidate.rawText === call.childrenText);
      if (!entry) entry = entries.find((candidate) => !candidate.used);
      if (!entry) continue;
      entry.used = true;
      call.slug = entry.slug;
    }
  }

  const unusedByDepth = new Map<number, Array<{ normalizedText: string; rawText: string; slug: string }>>();
  const claimed = new Set<{ slug: string; used: boolean; rawText: string }>();
  for (const heading of headings) {
    const key = `${heading.depth}:${normalizeHeadingText(heading.text)}`;
    const entries = headingMap.get(key);
    const entry = entries?.find((candidate) => !candidate.used && !claimed.has(candidate));
    if (!entry) continue;
    claimed.add(entry);
    const unused = unusedByDepth.get(heading.depth) ?? [];
    unused.push({ normalizedText: normalizeHeadingText(heading.text), rawText: heading.text, slug: entry.slug });
    unusedByDepth.set(heading.depth, unused);
  }

  for (const call of calls) {
    if (call.slug !== null || call.childrenText !== null) continue;

    const unused = unusedByDepth.get(call.depth);
    if (!unused || unused.length === 0) continue;

    const prefix = extractChildrenPrefix(code, call.offset + call.matchLen);
    const normalizedPrefix = prefix ? normalizeHeadingText(prefix) : null;
    let matchedIndex = -1;

    if (normalizedPrefix) {
      matchedIndex = unused.findIndex((entry) => entry.normalizedText.startsWith(normalizedPrefix));
    }

    if (matchedIndex < 0 && !normalizedPrefix && unused.length === 1) {
      matchedIndex = 0;
    }

    if (matchedIndex < 0) continue;

    const entry = unused[matchedIndex]!;
    call.slug = entry.slug;
    unused.splice(matchedIndex, 1);

    const key = `${call.depth}:${entry.normalizedText}`;
    const mapEntries = headingMap.get(key);
    const mapEntry = mapEntries?.find((candidate) => candidate.slug === entry.slug);
    if (mapEntry) mapEntry.used = true;
  }

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
