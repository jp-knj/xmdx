import { describe, test, expect } from 'bun:test';
import { createRegistry, starlightLibrary, astroLibrary } from 'xmdx/registry';
import { rewriteFallbackDirectives, injectFallbackImports } from './directive-rewriter.js';

const testRegistry = createRegistry([starlightLibrary, astroLibrary]);

describe('rewriteFallbackDirectives', () => {
  describe('core functionality', () => {
    test('converts :::note to <Aside type="note">', () => {
      const source = `:::note
This is a note.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('<Aside');
      expect(result.code).toContain('type="note"');
      expect(result.code).toContain('</Aside>');
      expect(result.usedComponents.has('Aside')).toBe(true);
    });

    test('converts :::tip to <Aside type="tip">', () => {
      const source = `:::tip
This is a tip.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('<Aside');
      expect(result.code).toContain('type="tip"');
      expect(result.code).toContain('</Aside>');
    });

    test('converts :::caution to <Aside type="caution">', () => {
      const source = `:::caution
Be careful!
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('type="caution"');
    });

    test('converts :::danger to <Aside type="danger">', () => {
      const source = `:::danger
This is dangerous!
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('type="danger"');
    });

    test('extracts bracket title: :::note[Custom Title]', () => {
      const source = `:::note[Custom Title]
This is a note with a title.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('title="Custom Title"');
    });

    test('handles multiple directives in sequence', () => {
      const source = `:::note
First note.
:::

:::tip
A tip here.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('type="note"');
      expect(result.code).toContain('type="tip"');
    });
  });

  describe('code fence handling', () => {
    test('ignores directives inside code fences', () => {
      const source = `\`\`\`md
:::note
This is inside a code fence.
:::
\`\`\``;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(false);
      expect(result.code).toBe(source);
    });

    test('ignores directives inside triple tilde fences', () => {
      const source = `~~~md
:::note
This is inside a tilde fence.
:::
~~~`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(false);
      expect(result.code).toBe(source);
    });

    test('processes directives after code fence closes', () => {
      const source = `\`\`\`js
const x = 1;
\`\`\`

:::note
Real note.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('<Aside');
      expect(result.code).toContain('const x = 1;');
    });
  });

  describe('nesting and blockquotes', () => {
    test('handles directives in blockquotes', () => {
      const source = `> :::note
> This is a note in a blockquote.
> :::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('<Aside');
    });

    test('preserves indentation prefix', () => {
      const source = `  :::note
  Indented content.
  :::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('  <Aside');
      expect(result.code).toContain('  </Aside>');
    });
  });

  describe('hyphenated directive names', () => {
    test('accepts hyphenated directive name from registry', () => {
      const hyphenRegistry = createRegistry([{
        ...starlightLibrary,
        directiveMappings: [
          { directive: 'custom-box', component: 'CustomBox', injectProps: {} },
        ],
      }]);
      const source = `:::custom-box
Content inside custom box.
:::`;
      const result = rewriteFallbackDirectives(source, hyphenRegistry, false);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('<CustomBox');
      expect(result.code).toContain('</CustomBox>');
      expect(result.usedComponents.has('CustomBox')).toBe(true);
    });

    test('accepts hyphenated directive name with bracket title', () => {
      const hyphenRegistry = createRegistry([{
        ...starlightLibrary,
        directiveMappings: [
          { directive: 'custom-box', component: 'CustomBox', injectProps: {} },
        ],
      }]);
      const source = `:::custom-box[My Title]
Content here.
:::`;
      const result = rewriteFallbackDirectives(source, hyphenRegistry, false);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('title="My Title"');
    });

    test('rejects directive name starting with a digit', () => {
      const source = `:::123bad
Content.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(false);
    });
  });

  describe('registry integration', () => {
    test('uses registry directive mappings when available', () => {
      const source = `:::note
Content here.
:::`;
      const result = rewriteFallbackDirectives(source, testRegistry, false);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('<Aside');
      expect(result.usedComponents.has('Aside')).toBe(true);
    });

    test('returns unchanged when registry has no matching directive', () => {
      const source = `:::unknown
Unknown directive.
:::`;
      const result = rewriteFallbackDirectives(source, testRegistry, false);
      expect(result.changed).toBe(false);
      expect(result.code).toBe(source);
    });
  });

  describe('edge cases', () => {
    test('handles empty source', () => {
      const result = rewriteFallbackDirectives('', null, true);
      expect(result.changed).toBe(false);
      expect(result.code).toBe('');
      expect(result.usedComponents.size).toBe(0);
    });

    test('handles source with no directives', () => {
      const source = `# Hello World

This is regular markdown.`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(false);
      expect(result.code).toBe(source);
    });

    test('handles unclosed directives by auto-closing', () => {
      const source = `:::note
This directive is never closed.`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('<Aside');
      expect(result.code).toContain('</Aside>');
    });

    test('handles directive with extra attributes', () => {
      const source = `:::note{id="my-note" class="custom"}
Content with attributes.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('id="my-note"');
      expect(result.code).toContain('class="custom"');
    });

    test('filters out type attribute from extras', () => {
      const source = `:::note{type="custom"}
Should not duplicate type.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      // Type should appear exactly once (from directive name, not from attrs)
      const matches = result.code.match(/type="/g);
      expect(matches?.length).toBe(1);
    });

    test('filters out title attribute when bracket title exists', () => {
      const source = `:::note[Bracket Title]{title="Attr Title"}
Should use bracket title.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.changed).toBe(true);
      expect(result.code).toContain('title="Bracket Title"');
      // Should not contain the attribute title
      expect(result.code).not.toContain('title="Attr Title"');
    });

    test('does not rewrite when hasStarlightConfigured is false and no registry', () => {
      const source = `:::note
Not configured.
:::`;
      const result = rewriteFallbackDirectives(source, null, false);
      expect(result.changed).toBe(false);
      expect(result.code).toBe(source);
    });

    test('adds data-mf-source attribute', () => {
      const source = `:::note
Content.
:::`;
      const result = rewriteFallbackDirectives(source, null, true);
      expect(result.code).toContain('data-mf-source="directive"');
    });
  });
});

describe('injectFallbackImports', () => {
  test('injects import for used component not already imported', () => {
    const source = `# Hello

<Aside type="note">Content</Aside>`;
    const usedComponents = new Set(['Aside']);
    const result = injectFallbackImports(source, usedComponents, null, true);
    expect(result).toContain("import { Aside } from '@astrojs/starlight/components';");
  });

  test('skips already imported components', () => {
    const source = `import { Aside } from '@astrojs/starlight/components';

<Aside type="note">Content</Aside>`;
    const usedComponents = new Set(['Aside']);
    const result = injectFallbackImports(source, usedComponents, null, true);
    // Should not duplicate the import
    const importCount = (result.match(/import.*Aside/g) || []).length;
    expect(importCount).toBe(1);
  });

  test('handles named exports from registry', () => {
    const source = `# Content

<Aside type="note">Content</Aside>`;
    const usedComponents = new Set(['Aside']);
    const result = injectFallbackImports(source, usedComponents, testRegistry, false);
    expect(result).toContain("import { Aside }");
  });

  test('returns source unchanged when no components used', () => {
    const source = `# Hello World`;
    const usedComponents = new Set<string>();
    const result = injectFallbackImports(source, usedComponents, null, true);
    expect(result).toBe(source);
  });

  test('returns source unchanged when source is empty', () => {
    const result = injectFallbackImports('', new Set(['Aside']), null, true);
    expect(result).toBe('');
  });

  test('does not inject Aside import when hasStarlightConfigured is false and no registry', () => {
    const source = `# Content

<Aside type="note">Content</Aside>`;
    const usedComponents = new Set(['Aside']);
    const result = injectFallbackImports(source, usedComponents, null, false);
    // Should not add any import since Starlight is not configured
    expect(result).not.toContain("import { Aside }");
  });

  test('injects imports after existing imports', () => {
    const source = `import React from 'react';

# Content

<Aside type="note">Content</Aside>`;
    const usedComponents = new Set(['Aside']);
    const result = injectFallbackImports(source, usedComponents, null, true);
    const lines = result.split('\n');
    const reactIndex = lines.findIndex((l) => l.includes('React'));
    const asideIndex = lines.findIndex((l) => l.includes('Aside'));
    expect(asideIndex).toBeGreaterThan(reactIndex);
  });

  test('default export with full file path gets /@fs/ prefix and no appended name', () => {
    const overrideRegistry = createRegistry([{
      ...starlightLibrary,
      components: [
        { name: 'Aside', modulePath: '/Users/site/src/CustomAside.astro', exportType: 'default' },
      ],
    }]);
    const source = `# Content\n\n<Aside type="note">Content</Aside>`;
    const usedComponents = new Set(['Aside']);
    const result = injectFallbackImports(source, usedComponents, overrideRegistry, false);
    expect(result).toContain("import Aside from '/@fs//Users/site/src/CustomAside.astro';");
  });

  test('default export without extension appends name.astro', () => {
    const overrideRegistry = createRegistry([{
      ...starlightLibrary,
      components: [
        { name: 'Aside', modulePath: '@my/components', exportType: 'default' },
      ],
    }]);
    const source = `# Content\n\n<Aside type="note">Content</Aside>`;
    const usedComponents = new Set(['Aside']);
    const result = injectFallbackImports(source, usedComponents, overrideRegistry, false);
    expect(result).toContain("import Aside from '@my/components/Aside.astro';");
  });

  test('default export with Windows backslash path gets /@fs/ prefix', () => {
    const overrideRegistry = createRegistry([{
      ...starlightLibrary,
      components: [
        { name: 'Widget', modulePath: 'C:\\Users\\foo\\src\\Widget.astro', exportType: 'default' },
      ],
    }]);
    const source = `# Content\n\n<Widget>Content</Widget>`;
    const usedComponents = new Set(['Widget']);
    const result = injectFallbackImports(source, usedComponents, overrideRegistry, false);
    expect(result).toContain("import Widget from '/@fs/C:/Users/foo/src/Widget.astro';");
  });

  test('handles multiple used components', () => {
    const source = `# Content

<Aside>Note</Aside>
<Card>Info</Card>`;
    const usedComponents = new Set(['Aside', 'Card']);
    const result = injectFallbackImports(source, usedComponents, testRegistry, false);
    expect(result).toContain('Aside');
    // Card may or may not be in registry, but Aside should be imported
  });
});

describe('integration', () => {
  test('rewrite + inject works together', () => {
    const source = `import { something } from 'somewhere';

:::note[My Note]
This is my note content.
:::`;
    const rewriteResult = rewriteFallbackDirectives(source, null, true);
    expect(rewriteResult.changed).toBe(true);

    const finalCode = injectFallbackImports(
      rewriteResult.code,
      rewriteResult.usedComponents,
      null,
      true
    );

    expect(finalCode).toContain('<Aside');
    expect(finalCode).toContain('title="My Note"');
    expect(finalCode).toContain("import { Aside } from '@astrojs/starlight/components';");
    expect(finalCode).toContain("import { something } from 'somewhere';");
  });
});
