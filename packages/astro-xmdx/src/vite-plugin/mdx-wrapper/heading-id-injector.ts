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

/**
 * Like slugifyHeadingText but also strips underscores, matching the slug
 * algorithm used by mdxjs-rs. Used as a fallback when exact text matching
 * fails because mdxjs-rs strips brackets/underscores/backticks from heading
 * metadata text but preserves them in the JSX code.
 */
function slugForMatching(text: string): string {
  const slug = normalizeHeadingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} -]/gu, '')
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

  // Only process component-ref calls (_components.hN); skip string-tag calls ("hN")
  // since literal JSX headings are never in the headings array.
  for (const call of calls) {
    if (call.isStringTag) continue;

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

  // Shared entry objects referenced by both exact-match map and per-depth arrays.
  // Marking entry.used = true propagates to both data structures.
  interface HeadingMapEntry {
    slug: string;
    used: boolean;
    rawText: string;
    normalizedText: string;
    depth: number;
  }

  const allEntries: HeadingMapEntry[] = headings.map((h) => ({
    slug: h.slug,
    used: false,
    rawText: h.text,
    normalizedText: normalizeHeadingText(h.text),
    depth: h.depth,
  }));

  // O(1) exact-match lookup by "depth:normalizedText"
  const headingMap = new Map<string, HeadingMapEntry[]>();
  for (const entry of allEntries) {
    const key = `${entry.depth}:${entry.normalizedText}`;
    const entries = headingMap.get(key) ?? [];
    entries.push(entry);
    headingMap.set(key, entries);
  }

  // Per-depth arrays for fallback scanning (same shared objects)
  const entriesByDepth = new Map<number, HeadingMapEntry[]>();
  for (const entry of allEntries) {
    const arr = entriesByDepth.get(entry.depth) ?? [];
    arr.push(entry);
    entriesByDepth.set(entry.depth, arr);
  }

  const calls = collectHeadingCalls(code);

  // Only process component-ref calls (_components.hN); skip string-tag calls ("hN")
  // since literal JSX headings are never in the headings array.
  for (const call of calls) {
    if (call.isStringTag) continue;
    if (call.slug !== null) continue;

      if (call.childrenText !== null) {
        // Strategy 1: exact text match via headingMap
        const key = `${call.depth}:${normalizeHeadingText(call.childrenText)}`;
        const mapEntries = headingMap.get(key);
        if (mapEntries) {
          let entry = mapEntries.find((c) => !c.used && c.rawText === call.childrenText);
          if (!entry) entry = mapEntries.find((c) => !c.used);
          if (entry) {
            entry.used = true;
            call.slug = entry.slug;
            continue;
          }
        }

        // Strategy 2: slug-based fallback via entriesByDepth
        // Handles mdxjs-rs stripping brackets/underscores/backticks from metadata
        const depthEntries = entriesByDepth.get(call.depth);
        if (depthEntries) {
          const callSlug = slugForMatching(call.childrenText);
          const entry = depthEntries.find(
            (e) => !e.used && slugForMatching(e.rawText) === callSlug
          );
          if (entry) {
            entry.used = true;
            call.slug = entry.slug;
          }
        }
        continue;
      }

      // childrenText is null: prefix fallback then single-candidate fallback
      const prefix = extractChildrenPrefix(code, call.offset + call.matchLen);
      const normalizedPrefix = prefix ? normalizeHeadingText(prefix) : null;
      const depthEntries = entriesByDepth.get(call.depth);
      if (!depthEntries) continue;

      let matched: HeadingMapEntry | undefined;
      if (normalizedPrefix) {
        matched = depthEntries.find(
          (e) => !e.used && e.normalizedText.startsWith(normalizedPrefix)
        );
      }
      if (!matched && !normalizedPrefix) {
        const candidates = depthEntries.filter((e) => !e.used);
        if (candidates.length === 1) matched = candidates[0];
      }

      if (matched) {
        matched.used = true;
        call.slug = matched.slug;
      }
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
