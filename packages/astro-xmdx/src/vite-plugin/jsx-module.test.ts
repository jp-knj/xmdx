import { describe, test, expect } from 'bun:test';
import { rehypeHeadingIds, slugifyHeading } from './jsx-module.js';

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
});
