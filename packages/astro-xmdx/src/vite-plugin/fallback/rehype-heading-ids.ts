/**
 * Rehype plugin for heading ID assignment and custom ID extraction.
 * @module vite-plugin/rehype-heading-ids
 */

type HastNode = {
  type: string;
  [key: string]: unknown;
};

type HastElement = HastNode & {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

type HastText = HastNode & {
  type: 'text';
  value?: string;
};

function isElement(node: HastNode | undefined): node is HastElement {
  return node?.type === 'element' && typeof node.tagName === 'string';
}

function isText(node: HastNode | undefined): node is HastText {
  return node?.type === 'text';
}

function extractText(node: HastNode): string {
  if (isText(node)) {
    return typeof node.value === 'string' ? node.value : '';
  }
  if (!isElement(node) || !Array.isArray(node.children)) {
    return '';
  }
  return node.children.map(extractText).join('');
}

export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
  return slug || 'heading';
}

const CUSTOM_ID_RE = /\s*\{#([a-zA-Z0-9_-]+)\}\s*$/;

/**
 * Strip common inline markdown formatting to produce plain text matching
 * what the HAST extractText() function would return after parsing.
 * Used to normalize keys so extractAndStripCustomIds and rehypeHeadingIds agree.
 */
export function stripInlineMarkdown(text: string): string {
  return text
    // Images: ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Links: [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Inline code: `text`
    .replace(/`([^`]+)`/g, '$1')
    // Strikethrough: ~~text~~
    .replace(/~~([^~]+)~~/g, '$1')
    // Bold/italic with asterisks (backreference ensures balanced delimiters)
    .replace(/(\*{1,3})(.+?)\1/g, '$2')
    // Bold/italic with underscores
    .replace(/(_{1,3})(.+?)\1/g, '$2');
}

export function extractCustomId(text: string): { text: string; customId: string | null } {
  const match = CUSTOM_ID_RE.exec(text);
  if (match) {
    const customId = match[1];
    if (customId !== undefined) {
      return { text: text.slice(0, match.index), customId };
    }
  }
  return { text, customId: null };
}

function findCustomIdInLastTextNode(node: HastNode): string | null {
  const children = Array.isArray(node.children) ? (node.children as HastNode[]) : null;
  if (!children || children.length === 0) return null;

  const lastChild = children[children.length - 1];
  if (isText(lastChild) && typeof lastChild.value === 'string') {
    return extractCustomId(lastChild.value).customId;
  }
  if (isElement(lastChild)) {
    const tag = lastChild.tagName;
    // Only recurse into inline formatting elements, not <code>, <img>, etc.
    if (tag === 'strong' || tag === 'em' || tag === 'a' || tag === 'del' || tag === 'b' || tag === 'i' || tag === 's') {
      return findCustomIdInLastTextNode(lastChild);
    }
  }
  return null;
}

function stripCustomIdFromLastTextNode(node: HastNode): void {
  const children = Array.isArray(node.children) ? (node.children as HastNode[]) : null;
  if (!children || children.length === 0) return;

  const lastChild = children[children.length - 1];
  if (isText(lastChild) && typeof lastChild.value === 'string') {
    lastChild.value = lastChild.value.replace(CUSTOM_ID_RE, '');
  } else if (isElement(lastChild)) {
    stripCustomIdFromLastTextNode(lastChild);
  }
}

/**
 * Pre-extract `{#custom-id}` from ATX headings in raw markdown source,
 * returning the stripped source and a map of heading text → custom ID.
 *
 * This prevents MDX from interpreting `{#id}` as a JSX expression in
 * the fallback compilation path.
 *
 * Code fences are tracked so headings inside fenced code blocks are ignored.
 */
export function extractAndStripCustomIds(markdown: string): {
  stripped: string;
  customIds: Map<string, (string | null)[]>;
} {
  const lines = markdown.split('\n');
  const customIds = new Map<string, (string | null)[]>();
  // Track headings without custom IDs whose text hasn't yet appeared with one
  const pendingNulls = new Map<string, number>();
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track code fences
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1]![0]!;
      } else if (line.trimEnd() === fenceMarker.repeat(fenceMatch[1]!.length) && fenceMatch[1]![0] === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    // Match ATX headings: #{1,6} followed by space
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!headingMatch) continue;

    const prefix = headingMatch[1]!;
    const content = headingMatch[2]!;
    const idMatch = CUSTOM_ID_RE.exec(content);

    if (!idMatch) {
      // No custom ID — record position for potential backfill
      const key = stripInlineMarkdown(content).trim();
      const existing = customIds.get(key);
      if (existing) {
        // Already tracking this text (a prior occurrence had a custom ID)
        existing.push(null);
      } else {
        // Not yet seen with a custom ID — increment pending count
        pendingNulls.set(key, (pendingNulls.get(key) ?? 0) + 1);
      }
      continue;
    }

    const customId = idMatch[1]!;
    const cleanContent = content.slice(0, idMatch.index);
    const key = stripInlineMarkdown(cleanContent).trim();
    const existing = customIds.get(key);
    if (existing) {
      existing.push(customId);
    } else {
      // Backfill pending nulls for earlier occurrences of the same text
      const pending = pendingNulls.get(key) ?? 0;
      const arr: (string | null)[] = new Array<null>(pending).fill(null);
      arr.push(customId);
      customIds.set(key, arr);
      pendingNulls.delete(key);
    }
    lines[i] = `${prefix} ${cleanContent}`;
  }

  return { stripped: lines.join('\n'), customIds };
}

/**
 * Rehype plugin that assigns IDs to heading elements.
 *
 * - Extracts `{#custom-id}` syntax from heading text
 * - Auto-generates slugs for headings without explicit IDs
 * - De-duplicates slugs with numeric suffixes
 * - Optionally collects heading metadata for getHeadings() export
 *
 * @param collectedHeadings - Optional array to collect heading metadata
 * @param preExtractedIds - Optional map of heading text → custom ID, used when
 *   `{#id}` was pre-stripped from source to avoid MDX expression interpretation
 */
export function rehypeHeadingIds(
  collectedHeadings?: Array<{ depth: number; slug: string; text: string }>,
  preExtractedIds?: Map<string, (string | null)[]>
) {
  return (tree: HastNode) => {
    const usedSlugs = new Map<string, number>();

    const assignHeadingId = (node: HastNode) => {
      if (isElement(node) && /^h[1-6]$/.test(node.tagName)) {
        const properties = (node.properties ??= {});
        const existingId = properties.id;
        const depth = Number.parseInt(node.tagName.slice(1), 10);

        // Extract {#custom-id} from the last text node (not from <code> elements)
        const rawText = extractText(node);
        let customId = findCustomIdInLastTextNode(node);

        // If no custom ID found in HAST (e.g. pre-stripped), check preExtractedIds
        if (!customId && preExtractedIds) {
          const ids = preExtractedIds.get(rawText.trim());
          customId = ids?.length ? (ids.shift() ?? null) : null;
        }

        const cleanText = customId
          ? (findCustomIdInLastTextNode(node) ? extractCustomId(rawText).text : rawText)
          : rawText;

        if (customId) {
          // Strip {#...} from the last text node in the rendered output (if still present)
          if (findCustomIdInLastTextNode(node)) {
            stripCustomIdFromLastTextNode(node);
          }
          properties.id = customId;
          usedSlugs.set(customId, (usedSlugs.get(customId) ?? 0) + 1);
          if (collectedHeadings) {
            collectedHeadings.push({ depth, slug: customId, text: cleanText });
          }
        } else if (typeof existingId !== 'string' || existingId.length === 0) {
          const baseSlug = slugifyHeading(cleanText);
          const count = usedSlugs.get(baseSlug) ?? 0;
          const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
          usedSlugs.set(baseSlug, count + 1);
          properties.id = slug;
          if (collectedHeadings) {
            collectedHeadings.push({ depth, slug, text: cleanText });
          }
        } else {
          const count = usedSlugs.get(existingId) ?? 0;
          usedSlugs.set(existingId, count + 1);
          if (collectedHeadings) {
            collectedHeadings.push({ depth, slug: existingId, text: cleanText });
          }
        }
      }

      const children = Array.isArray(node.children) ? (node.children as HastNode[]) : null;
      if (children) {
        for (const child of children) {
          assignHeadingId(child);
        }
      }
    };

    assignHeadingId(tree);
  };
}
