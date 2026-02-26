import { describe, test, expect } from 'bun:test';
import { rehypeHeadingIds, slugifyHeading, extractCustomId, extractAndStripCustomIds, stripInlineMarkdown } from './rehype-heading-ids.js';

describe('slugifyHeading', () => {
  test('slugifies heading text with punctuation', () => {
    expect(slugifyHeading('Claude AI / Claude Desktop')).toBe('claude-ai--claude-desktop');
    expect(slugifyHeading('GitHub Copilot coding agent')).toBe('github-copilot-coding-agent');
  });

  test('returns fallback slug for empty text', () => {
    expect(slugifyHeading('')).toBe('heading');
  });

  test('whitespace-only text produces hyphens', () => {
    expect(slugifyHeading('   ')).toBe('---');
  });

  test('github-slugger parity', () => {
    expect(slugifyHeading('import.meta.glob')).toBe('importmetaglob');
    expect(slugifyHeading('<Image />')).toBe('image-');
    expect(slugifyHeading('TypeScript & JSX')).toBe('typescript--jsx');
    expect(slugifyHeading('Using __dirname')).toBe('using-__dirname');
    expect(slugifyHeading('多言語 ガイド')).toBe('多言語-ガイド');
    expect(slugifyHeading('  a---b  ')).toBe('--a---b--');
  });

  test('parity: tabs, emoji, mixed scripts', () => {
    // Tab characters are silently dropped (not space, not alphanumeric)
    expect(slugifyHeading('Hello\tWorld')).toBe('helloworld');
    // Emoji are non-letter non-digit → dropped
    expect(slugifyHeading('🚀 Getting Started')).toBe('-getting-started');
    // Mixed CJK + Latin
    expect(slugifyHeading('安装 Installation Guide')).toBe('安装-installation-guide');
    // Korean
    expect(slugifyHeading('시작하기 Guide')).toBe('시작하기-guide');
    // Accented Latin characters preserved (unicode alphanumeric)
    expect(slugifyHeading('Héllo Wörld')).toBe('héllo-wörld');
  });
});

describe('extractCustomId', () => {
  test('extracts {#custom-id} from text', () => {
    const result = extractCustomId('My Heading {#my-heading}');
    expect(result.text).toBe('My Heading');
    expect(result.customId).toBe('my-heading');
  });

  test('handles trailing whitespace', () => {
    const result = extractCustomId('My Heading {#my-heading}  ');
    expect(result.text).toBe('My Heading');
    expect(result.customId).toBe('my-heading');
  });

  test('returns null for no custom id', () => {
    const result = extractCustomId('Plain heading');
    expect(result.text).toBe('Plain heading');
    expect(result.customId).toBeNull();
  });

  test('supports underscores', () => {
    const result = extractCustomId('Title {#my_custom_id}');
    expect(result.text).toBe('Title');
    expect(result.customId).toBe('my_custom_id');
  });

  test('rejects spaces in id', () => {
    const result = extractCustomId('Title {#bad id}');
    expect(result.text).toBe('Title {#bad id}');
    expect(result.customId).toBeNull();
  });

  test('rejects empty id', () => {
    const result = extractCustomId('Title {#}');
    expect(result.text).toBe('Title {#}');
    expect(result.customId).toBeNull();
  });

  test('works with unicode heading text', () => {
    const result = extractCustomId('共通データ型バリデーター {#common-data-type-validators}');
    expect(result.text).toBe('共通データ型バリデーター');
    expect(result.customId).toBe('common-data-type-validators');
  });
});

describe('rehypeHeadingIds', () => {
  test('adds stable ids to headings and de-duplicates duplicates', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Usage' }],
        },
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Usage' }],
        },
        {
          type: 'element',
          tagName: 'h3',
          children: [{ type: 'text', value: 'Troubleshooting' }],
        },
      ],
    };

    rehypeHeadingIds()(tree);

    const headings = tree.children as Array<{ properties?: { id?: string } }>;
    expect(headings[0].properties?.id).toBe('usage');
    expect(headings[1].properties?.id).toBe('usage-1');
    expect(headings[2].properties?.id).toBe('troubleshooting');
  });

  test('preserves existing heading ids', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          properties: { id: 'custom-id' },
          children: [{ type: 'text', value: 'Ignored title' }],
        },
      ],
    };

    rehypeHeadingIds()(tree);

    const heading = tree.children[0] as { properties?: { id?: string } };
    expect(heading.properties?.id).toBe('custom-id');
  });

  test('extracts {#custom-id} syntax and uses it as the id', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: '共通データ型バリデーター {#common-data-type-validators}' }],
        },
      ],
    };

    rehypeHeadingIds()(tree);

    const heading = tree.children[0] as { properties?: { id?: string }; children?: Array<{ value?: string }> };
    expect(heading.properties?.id).toBe('common-data-type-validators');
    // The {#...} should be stripped from the text node
    expect(heading.children?.[0]?.value).toBe('共通データ型バリデーター');
  });

  test('collects headings when collectedHeadings array is provided', () => {
    const collected: Array<{ depth: number; slug: string; text: string }> = [];
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h1',
          children: [{ type: 'text', value: 'Title' }],
        },
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Section {#my-section}' }],
        },
        {
          type: 'element',
          tagName: 'h3',
          children: [{ type: 'text', value: 'Subsection' }],
        },
      ],
    };

    rehypeHeadingIds(collected)(tree);

    expect(collected).toEqual([
      { depth: 1, slug: 'title', text: 'Title' },
      { depth: 2, slug: 'my-section', text: 'Section' },
      { depth: 3, slug: 'subsection', text: 'Subsection' },
    ]);
  });

  test('custom id reserves slug for deduplication', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Intro {#intro}' }],
        },
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Intro' }],
        },
      ],
    };

    rehypeHeadingIds()(tree);

    const headings = tree.children as Array<{ properties?: { id?: string } }>;
    expect(headings[0].properties?.id).toBe('intro');
    expect(headings[1].properties?.id).toBe('intro-1');
  });

  test('{#id} inside <code> is NOT treated as custom ID', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [
            { type: 'text', value: 'foo ' },
            { type: 'element', tagName: 'code', children: [{ type: 'text', value: '{#bar}' }] },
          ],
        },
      ],
    };

    rehypeHeadingIds()(tree);

    const heading = tree.children[0] as { properties?: { id?: string } };
    // Should auto-generate slug, NOT use "bar" as custom ID
    expect(heading.properties?.id).toBe('foo-bar');
  });

  test('<code> followed by text {#id} still works as custom ID', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [
            { type: 'element', tagName: 'code', children: [{ type: 'text', value: 'foo' }] },
            { type: 'text', value: ' {#bar}' },
          ],
        },
      ],
    };

    rehypeHeadingIds()(tree);

    const heading = tree.children[0] as { properties?: { id?: string }; children?: Array<{ value?: string }> };
    expect(heading.properties?.id).toBe('bar');
    // The trailing text node should have {#bar} stripped
    expect(heading.children?.[1]?.value).toBe('');
  });

  test('strips {#id} from nested text nodes', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [
            { type: 'element', tagName: 'strong', children: [{ type: 'text', value: 'Bold' }] },
            { type: 'text', value: ' heading {#bold-heading}' },
          ],
        },
      ],
    };

    rehypeHeadingIds()(tree);

    const heading = tree.children[0] as { properties?: { id?: string }; children?: Array<{ value?: string }> };
    expect(heading.properties?.id).toBe('bold-heading');
    // The last text node should have {#...} stripped
    expect(heading.children?.[1]?.value).toBe(' heading');
  });

  test('consumes preExtractedIds in document order for same-text headings', () => {
    const preExtractedIds = new Map([['Intro', ['a', 'b']]]);
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Intro' }],
        },
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Intro' }],
        },
      ],
    };

    rehypeHeadingIds(undefined, preExtractedIds)(tree);

    const headings = tree.children as Array<{ properties?: { id?: string } }>;
    expect(headings[0].properties?.id).toBe('a');
    expect(headings[1].properties?.id).toBe('b');
  });

  test('preExtractedIds with nulls assigns auto-slug then custom ID', () => {
    const preExtractedIds = new Map<string, (string | null)[]>([['Title', [null, 'custom']]]);
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Title' }],
        },
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'Title' }],
        },
      ],
    };

    rehypeHeadingIds(undefined, preExtractedIds)(tree);

    const headings = tree.children as Array<{ properties?: { id?: string } }>;
    expect(headings[0].properties?.id).toBe('title');
    expect(headings[1].properties?.id).toBe('custom');
  });

  test('preExtractedIds works for formatted headings (italic)', () => {
    // Simulates: ## *Intro* {#start-here} after pre-stripping becomes ## *Intro*
    // extractAndStripCustomIds keys it as "Intro", and extractText returns "Intro"
    const preExtractedIds = new Map<string, (string | null)[]>([['Intro', ['start-here']]]);
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [
            { type: 'element', tagName: 'em', children: [{ type: 'text', value: 'Intro' }] },
          ],
        },
      ],
    };

    rehypeHeadingIds(undefined, preExtractedIds)(tree);

    const heading = tree.children[0] as { properties?: { id?: string } };
    expect(heading.properties?.id).toBe('start-here');
  });

  test('uses preExtractedIds when {#id} was pre-stripped from source', () => {
    const preExtractedIds = new Map([['My Section', ['custom-section']]]);
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          children: [{ type: 'text', value: 'My Section' }],
        },
      ],
    };

    rehypeHeadingIds(undefined, preExtractedIds)(tree);

    const heading = tree.children[0] as { properties?: { id?: string } };
    expect(heading.properties?.id).toBe('custom-section');
  });
});

describe('stripInlineMarkdown', () => {
  test('strips emphasis asterisks', () => {
    expect(stripInlineMarkdown('*Intro*')).toBe('Intro');
  });

  test('strips bold asterisks', () => {
    expect(stripInlineMarkdown('**Bold**')).toBe('Bold');
  });

  test('strips bold+italic asterisks', () => {
    expect(stripInlineMarkdown('***Bold Italic***')).toBe('Bold Italic');
  });

  test('strips emphasis underscores', () => {
    expect(stripInlineMarkdown('_Intro_')).toBe('Intro');
  });

  test('strips bold underscores', () => {
    expect(stripInlineMarkdown('__Bold__')).toBe('Bold');
  });

  test('strips inline code backticks', () => {
    expect(stripInlineMarkdown('`code`')).toBe('code');
  });

  test('strips strikethrough', () => {
    expect(stripInlineMarkdown('~~deleted~~')).toBe('deleted');
  });

  test('strips links', () => {
    expect(stripInlineMarkdown('[link text](https://example.com)')).toBe('link text');
  });

  test('strips images', () => {
    expect(stripInlineMarkdown('![alt text](image.png)')).toBe('alt text');
  });

  test('handles mixed formatting', () => {
    expect(stripInlineMarkdown('**Bold** and *italic*')).toBe('Bold and italic');
  });

  test('leaves plain text unchanged', () => {
    expect(stripInlineMarkdown('Plain heading')).toBe('Plain heading');
  });
});

describe('extractAndStripCustomIds', () => {
  test('strips {#id} from ATX headings', () => {
    const md = '## My Section {#custom-section}\n\nSome text.';
    const result = extractAndStripCustomIds(md);
    expect(result.stripped).toBe('## My Section\n\nSome text.');
    expect(result.customIds.get('My Section')).toEqual(['custom-section']);
  });

  test('leaves non-heading lines with {#id} unchanged', () => {
    const md = 'This is a paragraph with {#not-a-heading}.';
    const result = extractAndStripCustomIds(md);
    expect(result.stripped).toBe(md);
    expect(result.customIds.size).toBe(0);
  });

  test('ignores headings inside code fences', () => {
    const md = '```\n## Heading {#fenced}\n```\n\n## Real Heading {#real}';
    const result = extractAndStripCustomIds(md);
    // The fenced heading should be untouched
    expect(result.stripped).toContain('## Heading {#fenced}');
    // The real heading should be stripped
    expect(result.customIds.get('Real Heading')).toEqual(['real']);
    expect(result.customIds.has('Heading')).toBe(false);
  });

  test('handles multiple headings', () => {
    const md = '# Title {#title}\n\n## Section A {#sec-a}\n\nText\n\n## Section B {#sec-b}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Title')).toEqual(['title']);
    expect(result.customIds.get('Section A')).toEqual(['sec-a']);
    expect(result.customIds.get('Section B')).toEqual(['sec-b']);
    expect(result.stripped).not.toContain('{#');
  });

  test('same heading text with different custom IDs are all preserved', () => {
    const md = '## Intro {#a}\n\nText\n\n## Intro {#b}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Intro')).toEqual(['a', 'b']);
    expect(result.stripped).toBe('## Intro\n\nText\n\n## Intro');
  });

  test('headings without custom IDs are unchanged', () => {
    const md = '## Normal Heading\n\nParagraph.';
    const result = extractAndStripCustomIds(md);
    expect(result.stripped).toBe(md);
    expect(result.customIds.size).toBe(0);
  });

  test('non-custom heading before same-text custom heading gets null backfill', () => {
    const md = '## Title\n\n## Title {#custom}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Title')).toEqual([null, 'custom']);
    expect(result.stripped).toBe('## Title\n\n## Title');
  });

  test('custom heading before same-text non-custom heading gets trailing null', () => {
    const md = '## Title {#custom}\n\n## Title';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Title')).toEqual(['custom', null]);
    expect(result.stripped).toBe('## Title\n\n## Title');
  });

  test('multiple non-custom headings before custom heading get null backfill', () => {
    const md = '## Title\n\n## Title\n\n## Title {#custom}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Title')).toEqual([null, null, 'custom']);
  });

  test('non-custom headings whose text never gets a custom ID stay out of the map', () => {
    const md = '## Alpha\n\n## Alpha\n\n## Beta {#beta-id}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.has('Alpha')).toBe(false);
    expect(result.customIds.get('Beta')).toEqual(['beta-id']);
  });

  test('formatted heading with custom ID is keyed by plain text', () => {
    const md = '## *Intro* {#start-here}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Intro')).toEqual(['start-here']);
    expect(result.customIds.has('*Intro*')).toBe(false);
    expect(result.stripped).toBe('## *Intro*');
  });

  test('bold heading with custom ID is keyed by plain text', () => {
    const md = '## **Bold Title** {#bold-id}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Bold Title')).toEqual(['bold-id']);
  });

  test('inline code heading with custom ID is keyed by plain text', () => {
    const md = '## `Config` options {#config-opts}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Config options')).toEqual(['config-opts']);
  });

  test('formatted heading without custom ID matches formatted heading with custom ID', () => {
    const md = '## *Intro*\n\n## *Intro* {#custom}';
    const result = extractAndStripCustomIds(md);
    expect(result.customIds.get('Intro')).toEqual([null, 'custom']);
  });
});
