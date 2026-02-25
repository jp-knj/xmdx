import { describe, test, expect } from 'bun:test';
import { wrapMdxModule } from './index.js';
import { extractArrayInner } from './string-utils.js';
import { createRegistry, starlightLibrary } from 'xmdx/registry';
import type { ComponentLibrary } from 'xmdx/registry';

/**
 * Build a minimal registry that includes a component with the given definition.
 */
function registryWith(overrides: ComponentLibrary['components']): ReturnType<typeof createRegistry> {
  const lib: ComponentLibrary = {
    ...starlightLibrary,
    components: [
      ...starlightLibrary.components,
      ...overrides,
    ],
  };
  return createRegistry([lib]);
}

describe('wrapMdxModule', () => {
  describe('Starlight override import paths', () => {
    test('default export with file-extension modulePath imports directly', () => {
      // Simulates Starlight component override: modulePath is a complete file path
      const registry = registryWith([
        { name: 'CustomWidget', modulePath: './src/components/CustomWidget.astro', exportType: 'default' },
      ]);

      const mdxCode = `function _createMdxContent(props) {
  const _components = { CustomWidget, ...props.components };
  return _jsx(_components.CustomWidget, { children: "hello" });
}
export default _createMdxContent;`;

      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings: [],
        registry,
      }, 'test.mdx');

      // Should import directly from the override path, NOT append /CustomWidget.astro
      expect(result).toContain("from './src/components/CustomWidget.astro'");
      expect(result).not.toContain('CustomWidget.astro/CustomWidget.astro');
    });

    test('default export with dotted package name appends /{name}.astro', () => {
      // Dotted package names like @scope/ui.v2 should NOT be mistaken for file extensions
      const registry = registryWith([
        { name: 'Button', modulePath: '@scope/ui.v2', exportType: 'default' },
      ]);

      const mdxCode = `function _createMdxContent(props) {
  const _components = { Button, ...props.components };
  return _jsx(_components.Button, { children: "click" });
}
export default _createMdxContent;`;

      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings: [],
        registry,
      }, 'test.mdx');

      // Should append /Button.astro, NOT import directly from @scope/ui.v2
      expect(result).toContain("from '@scope/ui.v2/Button.astro'");
      expect(result).not.toContain("from '@scope/ui.v2';\n");
    });

    test('default export without file extension appends /{name}.astro', () => {
      const registry = registryWith([
        { name: 'MyComp', modulePath: '@my/pkg/components', exportType: 'default' },
      ]);

      const mdxCode = `function _createMdxContent(props) {
  const _components = { MyComp, ...props.components };
  return _jsx(_components.MyComp, { children: "hi" });
}
export default _createMdxContent;`;

      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings: [],
        registry,
      }, 'test.mdx');

      // Should use the convention: modulePath/Name.astro
      expect(result).toContain("from '@my/pkg/components/MyComp.astro'");
    });
  });

  describe('heading ID injection', () => {
    test('injects heading IDs matching by depth and text', () => {
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h1: "h1", h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h1, { children: "Hello" }),
      _jsx(_components.h2, { children: "World" }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 1, slug: 'hello', text: 'Hello' },
        { depth: 2, slug: 'world', text: 'World' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "hello"');
      expect(result).toContain('id: "world"');
    });

    test('formatted headings with inline JSX children get IDs via sequential fallback', () => {
      // `## Hello *world*` compiles to children: ["Hello ", _jsx("em", { children: "world" })]
      // extractChildrenText must return null so the sequential fallback injects the id.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", h3: "h3", em: "em", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: ["Hello ", _jsx(_components.em, { children: "world" })] }),
      _jsx(_components.h3, { children: "Plain Heading" }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'hello-world', text: 'Hello world' },
        { depth: 3, slug: 'plain-heading', text: 'Plain Heading' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "hello-world"');
      expect(result).toContain('id: "plain-heading"');
    });

    test('formatted setext heading (JSX children, not in headings) does not steal ATX slug at same depth', () => {
      // A setext heading with inline formatting produces JSX children (extractChildrenText → null)
      // and is intentionally absent from the headings array. The fallback must not consume the
      // slug belonging to the following ATX h2 heading.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", em: "em", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: ["Setext ", _jsx(_components.em, { children: "formatted" })] }),
      _jsx(_components.h2, { children: "ATX Heading" }),
    ]
  });
}
export default _createMdxContent;`;

      // Only the ATX heading is in the extracted headings (setext is missing)
      const headings = [
        { depth: 2, slug: 'atx-heading', text: 'ATX Heading' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      const setextIdx = result.indexOf('children: ["Setext "');
      const atxIdx = result.indexOf('children: "ATX Heading"');

      expect(setextIdx).toBeGreaterThan(-1);
      expect(atxIdx).toBeGreaterThan(-1);

      // The setext heading must NOT get the ATX slug
      const regionBeforeSetext = result.slice(Math.max(0, setextIdx - 80), setextIdx);
      expect(regionBeforeSetext).not.toContain('id: "atx-heading"');

      // The ATX heading must still get its own slug
      const regionBeforeAtx = result.slice(Math.max(0, atxIdx - 80), atxIdx);
      expect(regionBeforeAtx).toContain('id: "atx-heading"');
    });

    test('headings with escaped backslashes get IDs injected', () => {
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: "C\\\\Path" }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'cpath', text: 'C\\Path' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "cpath"');
    });

    test('array children with escaped backslashes get IDs injected', () => {
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: ["C\\\\Path", " Docs"] }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'cpath-docs', text: 'C\\Path Docs' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "cpath-docs"');
    });

    test('formatted setext before formatted ATX at same depth does not steal slug', () => {
      // Both headings have JSX children (extractChildrenText → null for both).
      // The setext heading is not in the headings array. The fallback must not
      // assign the ATX slug to the setext heading just because the literal
      // `children: "..."` pattern is absent for the ATX heading too.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", em: "em", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: ["Setext ", _jsx(_components.em, { children: "styled" })] }),
      _jsx(_components.h2, { children: ["ATX ", _jsx(_components.em, { children: "styled" })] }),
    ]
  });
}
export default _createMdxContent;`;

      // Only the ATX heading is in the extracted headings
      const headings = [
        { depth: 2, slug: 'atx-styled', text: 'ATX styled' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      const setextIdx = result.indexOf('children: ["Setext "');
      const atxIdx = result.indexOf('children: ["ATX "');

      expect(setextIdx).toBeGreaterThan(-1);
      expect(atxIdx).toBeGreaterThan(-1);

      // The setext heading must NOT get the ATX slug
      const regionBeforeSetext = result.slice(Math.max(0, setextIdx - 80), setextIdx);
      expect(regionBeforeSetext).not.toContain('id: "atx-styled"');

      // The ATX heading must get its slug
      const regionBeforeAtx = result.slice(Math.max(0, atxIdx - 80), atxIdx);
      expect(regionBeforeAtx).toContain('id: "atx-styled"');
    });

    test('duplicate formatted ATX headings with intervening setext get correct IDs', () => {
      // Two ATX h2 headings with the same text (JSX children → fallback path)
      // and a setext h2 in between. The surplus check must count individual
      // unused entries, not just unique keys, so both ATX headings get their slug.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", em: "em", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: ["Repeated ", _jsx(_components.em, { children: "title" })] }),
      _jsx(_components.h2, { children: ["Setext ", _jsx(_components.em, { children: "only" })] }),
      _jsx(_components.h2, { children: ["Repeated ", _jsx(_components.em, { children: "title" })] }),
    ]
  });
}
export default _createMdxContent;`;

      // headings has two "Repeated title" entries (deduped slugs), no setext
      const headings = [
        { depth: 2, slug: 'repeated-title', text: 'Repeated title' },
        { depth: 2, slug: 'repeated-title-1', text: 'Repeated title' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      // Find each heading call by position
      const first = result.indexOf('children: ["Repeated "');
      const setext = result.indexOf('children: ["Setext "');
      const second = result.indexOf('children: ["Repeated "', first + 1);

      expect(first).toBeGreaterThan(-1);
      expect(setext).toBeGreaterThan(-1);
      expect(second).toBeGreaterThan(first);

      const regionFirst = result.slice(Math.max(0, first - 100), first);
      const regionSetext = result.slice(Math.max(0, setext - 100), setext);
      const regionSecond = result.slice(Math.max(0, second - 100), second);

      expect(regionFirst).toContain('id: "repeated-title"');
      expect(regionSetext).not.toContain('id:');
      expect(regionSecond).toContain('id: "repeated-title-1"');
    });

    test('single JSX-wrapped heading gets ID (## *Intro*)', () => {
      // ## *Intro* compiles to children: _jsx(_components.em, { children: "Intro" })
      // extractChildrenText must handle this single-JSX-call case.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", em: "em", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: _jsx(_components.em, { children: "Intro" }) }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'intro', text: 'Intro' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "intro"');
    });

    test('multiple JSX-wrapped headings at same depth get correct IDs', () => {
      // ## *Intro* and ## *Conclusion* — both are single JSX call children
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", em: "em", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: _jsx(_components.em, { children: "Intro" }) }),
      _jsx(_components.h2, { children: _jsx(_components.em, { children: "Conclusion" }) }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'intro', text: 'Intro' },
        { depth: 2, slug: 'conclusion', text: 'Conclusion' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "intro"');
      expect(result).toContain('id: "conclusion"');

      // Verify correct assignment (intro before conclusion in output)
      const introIdx = result.indexOf('children: "Intro"');
      const conclusionIdx = result.indexOf('children: "Conclusion"');
      const regionIntro = result.slice(Math.max(0, introIdx - 100), introIdx);
      const regionConclusion = result.slice(Math.max(0, conclusionIdx - 100), conclusionIdx);

      expect(regionIntro).toContain('id: "intro"');
      expect(regionConclusion).toContain('id: "conclusion"');
    });

    test('extra heading calls (setext) do not shift IDs for subsequent headings', () => {
      // Setext headings produce h1/h2 JSX calls but are not in the extracted
      // headings array. This should not misalign IDs for later headings.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h1: "h1", h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h1, { children: "ATX Heading" }),
      _jsx(_components.h2, { children: "Setext Heading" }),
      _jsx(_components.h2, { children: "Another ATX" }),
    ]
  });
}
export default _createMdxContent;`;

      // Only ATX headings are extracted (setext "Setext Heading" is missing)
      const headings = [
        { depth: 1, slug: 'atx-heading', text: 'ATX Heading' },
        { depth: 2, slug: 'another-atx', text: 'Another ATX' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      // "ATX Heading" should get id "atx-heading" — verify it's on the right call
      const atxIdx = result.indexOf('children: "ATX Heading"');
      const setextIdx = result.indexOf('children: "Setext Heading"');
      const anotherIdx = result.indexOf('children: "Another ATX"');

      expect(atxIdx).toBeGreaterThan(-1);
      expect(setextIdx).toBeGreaterThan(-1);
      expect(anotherIdx).toBeGreaterThan(-1);

      // Check the region before each children: to see what id was injected
      const regionBeforeAtx = result.slice(Math.max(0, atxIdx - 80), atxIdx);
      const regionBeforeSetext = result.slice(Math.max(0, setextIdx - 80), setextIdx);
      const regionBeforeAnother = result.slice(Math.max(0, anotherIdx - 80), anotherIdx);

      expect(regionBeforeAtx).toContain('id: "atx-heading"');
      // Setext heading should NOT get "another-atx" (that belongs to "Another ATX")
      expect(regionBeforeSetext).not.toContain('id: "another-atx"');
      // "Another ATX" must get its proper id
      expect(regionBeforeAnother).toContain('id: "another-atx"');
    });

    test('empty heading text gets ID injected', () => {
      // Whitespace-only heading text (e.g., ## \u{00a0}) should not crash
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: " " }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: '-1', text: ' ' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "-1"');
    });

    test('heading with bracket inside string literal gets correct ID', () => {
      // ## See [Docs] intro — compiled children array contains "]" inside a string literal
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: ["See [Docs]", " intro"] }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'see-docs-intro', text: 'See [Docs] intro' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "see-docs-intro"');
    });

    test('HTML-in-heading via fallback', () => {
      // ## <span>text</span> compiles to array children with a JSX call.
      // extractChildrenText returns null, so fallback prefix-match assigns the slug.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", span: "span", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: _jsx(_components.span, { children: "text" }) }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'text', text: 'text' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      expect(result).toContain('id: "text"');
    });
  });
});

describe('extractArrayInner', () => {
  test('handles bracket inside string literal', () => {
    expect(extractArrayInner('["a]b", "c"]')).toBe('"a]b", "c"');
  });

  test('simple quoted string (no regression)', () => {
    expect(extractArrayInner('["ok"]')).toBe('"ok"');
  });

  test('brackets inside string literal', () => {
    expect(extractArrayInner('["a[b]c"]')).toBe('"a[b]c"');
  });
});
