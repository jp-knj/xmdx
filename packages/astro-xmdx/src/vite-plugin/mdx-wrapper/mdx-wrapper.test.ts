import { describe, test, expect } from 'bun:test';
import { wrapMdxModule } from './index.js';
import { extractArrayInner } from './string-utils.js';
import { injectHeadingIds } from './heading-id-injector.js';
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

    test('literal JSX heading before markdown heading does not steal ID', () => {
      // In mdxjs-rs output, _components.hN = markdown heading, "hN" = literal JSX <h2>.
      // The string-tag call should not steal the slug from the component-ref call.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx("h2", { children: "Title" }),
      _jsx(_components.h2, { children: "Title" }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'title', text: 'Title' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      // Find positions of each call
      const stringTagIdx = result.indexOf('_jsx("h2"');
      const componentRefIdx = result.indexOf('_jsx(_components.h2');

      expect(stringTagIdx).toBeGreaterThan(-1);
      expect(componentRefIdx).toBeGreaterThan(-1);

      // The string-tag call must NOT get the ID
      const regionBeforeStringTag = result.slice(Math.max(0, stringTagIdx - 80), stringTagIdx);
      expect(regionBeforeStringTag).not.toContain('id: "title"');

      // The component-ref call must get the ID
      const regionBeforeComponentRef = result.slice(Math.max(0, componentRefIdx - 80), componentRefIdx);
      // Check the props region after the match
      const propsRegion = result.slice(componentRefIdx, componentRefIdx + 200);
      expect(propsRegion).toContain('id: "title"');
    });

    test('mixed component-ref and string-tag calls with same text', () => {
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx(_components.h2, { children: "A" }),
      _jsx("h2", { children: "B" }),
      _jsx(_components.h2, { children: "B" }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'a', text: 'A' },
        { depth: 2, slug: 'b', text: 'B' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      // _components.h2 "A" gets slug "a"
      const compAIdx = result.indexOf('_jsx(_components.h2, {');
      const compARegion = result.slice(compAIdx, compAIdx + 200);
      expect(compARegion).toContain('id: "a"');

      // string-tag "h2" "B" does NOT get slug "b" — check only up to the children prop
      const stringBIdx = result.indexOf('_jsx("h2"');
      const stringBRegion = result.slice(stringBIdx, result.indexOf('children: "B"', stringBIdx));
      expect(stringBRegion).not.toContain('id: "b"');

      // _components.h2 "B" gets slug "b"
      const compBIdx = result.indexOf('_jsx(_components.h2, {', compAIdx + 1);
      const compBRegion = result.slice(compBIdx, compBIdx + 200);
      expect(compBRegion).toContain('id: "b"');
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

    test('literal JSX <h2> does not steal slug from markdown heading with JSX children', () => {
      // ## <Badge /> Intro — markdown heading with JSX children (extractChildrenText → null).
      // A literal <h2>Intro</h2> must NOT consume the markdown heading's slug.
      const mdxCode = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs("div", {
    children: [
      _jsx("h2", { children: "Intro" }),
      _jsxs(_components.h2, { children: [_jsx(Badge, {}), " Intro"] }),
    ]
  });
}
export default _createMdxContent;`;

      const headings = [
        { depth: 2, slug: 'badge--intro', text: 'Badge  Intro' },
      ];

      const registry = createRegistry([starlightLibrary]);
      const result = wrapMdxModule(mdxCode, {
        frontmatter: {},
        headings,
        registry,
      }, 'test.mdx');

      // The literal JSX <h2> must NOT get the slug
      const stringTagIdx = result.indexOf('_jsx("h2"');
      const componentRefIdx = result.indexOf('_jsxs(_components.h2');
      expect(stringTagIdx).toBeGreaterThan(-1);
      expect(componentRefIdx).toBeGreaterThan(-1);

      // Region from string-tag up to (but not including) the component-ref call
      const regionStringTag = result.slice(stringTagIdx, componentRefIdx);
      expect(regionStringTag).not.toContain('id: "badge--intro"');

      // The markdown heading (_components.h2) must get its slug
      const regionComponentRef = result.slice(componentRefIdx, componentRefIdx + 200);
      expect(regionComponentRef).toContain('id: "badge--intro"');
    });
  });
});

describe('injectHeadingIds — targeted patterns', () => {
  test('bracketed filename text: ## Creating the [...slug.astro] page', () => {
    const code = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsx(_components.h2, { children: "Creating the [...slug.astro] page" });
}`;
    const headings = [
      { depth: 2, slug: 'creating-the-slugastro-page', text: 'Creating the [...slug.astro] page' },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "creating-the-slugastro-page"');
  });

  test('bracketed filename in array children', () => {
    const code = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs(_components.h2, { children: ["Creating the ", "[...slug.astro]", " page"] });
}`;
    const headings = [
      { depth: 2, slug: 'creating-the-slugastro-page', text: 'Creating the [...slug.astro] page' },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "creating-the-slugastro-page"');
  });

  test('mixed text + inline code: ## `BASE_URL` and `trailingSlash`', () => {
    const code = `function _createMdxContent(props) {
  const _components = { h2: "h2", code: "code", ...props.components };
  return _jsxs(_components.h2, { children: [_jsx(_components.code, { children: "BASE_URL" }), " and ", _jsx(_components.code, { children: "trailingSlash" })] });
}`;
    const headings = [
      { depth: 2, slug: 'base_url-and-trailingslash', text: 'BASE_URL and trailingSlash' },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "base_url-and-trailingslash"');
  });

  test('slash-containing inline code: ## The `src/content/` directory', () => {
    const code = `function _createMdxContent(props) {
  const _components = { h2: "h2", code: "code", ...props.components };
  return _jsxs(_components.h2, { children: ["The ", _jsx(_components.code, { children: "src/content/" }), " directory"] });
}`;
    const headings = [
      { depth: 2, slug: 'the-srccontent-directory', text: 'The src/content/ directory' },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "the-srccontent-directory"');
  });

  test('duplicate slugs with different text must NOT cross-assign', () => {
    // Two headings that slugify to the same base, but have different text
    const code = `function _createMdxContent(props) {
  const _components = { h2: "h2", ...props.components };
  return _jsxs("div", { children: [
    _jsx(_components.h2, { children: "Hello World" }),
    _jsx(_components.h2, { children: "Hello, World!" }),
  ] });
}`;
    const headings = [
      { depth: 2, slug: 'hello-world', text: 'Hello World' },
      { depth: 2, slug: 'hello-world-1', text: 'Hello, World!' },
    ];
    const result = injectHeadingIds(code, headings);

    // Find each heading and verify correct slug assignment
    const firstIdx = result.indexOf('children: "Hello World"');
    const secondIdx = result.indexOf('children: "Hello, World!"');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);

    const regionFirst = result.slice(Math.max(0, firstIdx - 100), firstIdx);
    const regionSecond = result.slice(Math.max(0, secondIdx - 100), secondIdx);
    expect(regionFirst).toContain('id: "hello-world"');
    expect(regionSecond).toContain('id: "hello-world-1"');
  });

  test('inline code only heading: ## `config.ts`', () => {
    const code = `function _createMdxContent(props) {
  const _components = { h2: "h2", code: "code", ...props.components };
  return _jsx(_components.h2, { children: _jsx(_components.code, { children: "config.ts" }) });
}`;
    const headings = [
      { depth: 2, slug: 'configts', text: 'config.ts' },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "configts"');
  });

  test('text with leading inline code: ## `src/pages/` directory structure', () => {
    const code = `function _createMdxContent(props) {
  const _components = { h2: "h2", code: "code", ...props.components };
  return _jsxs(_components.h2, { children: [_jsx(_components.code, { children: "src/pages/" }), " directory structure"] });
}`;
    const headings = [
      { depth: 2, slug: 'srcpages-directory-structure', text: 'src/pages/ directory structure' },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "srcpages-directory-structure"');
  });
});

describe('injectHeadingIds — mdxjs-rs text mismatch fallback', () => {
  // mdxjs-rs strips brackets/underscores/backticks from heading metadata text
  // but preserves them in the JSX code. These tests use actual compiled shapes.

  test('Pattern 1: brackets stripped from metadata — [...slug.astro]', () => {
    // mdxjs-rs JSX: children has brackets; metadata text strips them
    const code = `function _createMdxContent(props) {
  const _components = Object.assign({ h3: "h3" }, props.components);
  return _jsx(_components.h3, {
    children: "Creating the [...slug.astro] component and fetching Apostrophe data"
  });
}`;
    const headings = [
      {
        depth: 3,
        slug: 'creating-the-slugastro-component-and-fetching-apostrophe-data',
        // mdxjs-rs strips brackets from heading text
        text: 'Creating the ...slug.astro component and fetching Apostrophe data',
      },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "creating-the-slugastro-component-and-fetching-apostrophe-data"');
  });

  test('Pattern 2: underscore stripped from metadata — BASE_URL + inline code', () => {
    // mdxjs-rs JSX: BASE_URL preserved; metadata text strips underscore
    const code = `function _createMdxContent(props) {
  const _components = Object.assign({ h3: "h3", code: "code" }, props.components);
  return _jsxs(_components.h3, {
    children: ["Changed default: import.meta.env.BASE_URL ", _jsx(_components.code, {
      children: "trailingSlash"
    })]
  });
}`;
    const headings = [
      {
        depth: 3,
        slug: 'changed-default-importmetaenvbaseurl-trailingslash',
        // mdxjs-rs strips underscore from heading text
        text: 'Changed default: import.meta.env.BASEURL trailingSlash',
      },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "changed-default-importmetaenvbaseurl-trailingslash"');
  });

  test('Pattern 3: backticks stripped from metadata — malformed code span', () => {
    // mdxjs-rs JSX: backticks preserved as literal text; metadata text strips them
    const code = `function _createMdxContent(props) {
  const _components = Object.assign({ h3: "h3" }, props.components);
  return _jsx(_components.h3, {
    children: "Зарезервировано: \`\`src/content/\`."
  });
}`;
    const headings = [
      {
        depth: 3,
        slug: 'зарезервировано-srccontent',
        // mdxjs-rs strips backticks from heading text
        text: 'Зарезервировано: src/content/.',
      },
    ];
    const result = injectHeadingIds(code, headings);
    expect(result).toContain('id: "зарезервировано-srccontent"');
  });

  test('string-tag before component-ref in slug fallback: only component-ref gets ID', () => {
    // String-tag calls are skipped entirely — only component-ref calls get IDs.
    const code = `function _createMdxContent(props) {
  const _components = Object.assign({ h2: "h2" }, props.components);
  return _jsxs("div", { children: [
    _jsx("h2", { children: "A_B" }),
    _jsx(_components.h2, { children: "A_B" }),
  ] });
}`;
    const headings = [{ depth: 2, slug: 'ab', text: 'AB' }];
    const result = injectHeadingIds(code, headings);

    // The string-tag call must NOT get the ID
    const stringTagIdx = result.indexOf('_jsx("h2"');
    const componentRefIdx = result.indexOf('_jsx(_components.h2');
    expect(stringTagIdx).toBeGreaterThan(-1);
    expect(componentRefIdx).toBeGreaterThan(-1);
    const regionStringTag = result.slice(stringTagIdx, componentRefIdx);
    expect(regionStringTag).not.toContain('id: "ab"');

    // The component-ref call must get the ID
    const regionComponentRef = result.slice(componentRefIdx, componentRefIdx + 200);
    expect(regionComponentRef).toContain('id: "ab"');
  });

  test('document-order slug assignment with collapsed metadata duplicates', () => {
    // Two headings ## foo_bar and ## foobar both get metadata text "foobar"
    // (underscore stripped). The first call must get slug "foobar", second "foobar-1".
    const code = `function _createMdxContent(props) {
  const _components = Object.assign({ h2: "h2" }, props.components);
  return _jsxs("div", { children: [
    _jsx(_components.h2, { children: "foo_bar" }),
    _jsx(_components.h2, { children: "foobar" }),
  ] });
}`;
    const headings = [
      { depth: 2, slug: 'foobar', text: 'foobar' },
      { depth: 2, slug: 'foobar-1', text: 'foobar' },
    ];
    const result = injectHeadingIds(code, headings);

    const firstIdx = result.indexOf('children: "foo_bar"');
    const secondIdx = result.indexOf('children: "foobar"');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);

    const regionFirst = result.slice(Math.max(0, firstIdx - 100), firstIdx);
    const regionSecond = result.slice(Math.max(0, secondIdx - 100), secondIdx);
    expect(regionFirst).toContain('id: "foobar"');
    expect(regionSecond).toContain('id: "foobar-1"');
  });

  test('slug fallback does not cross-assign when texts differ but slugs collide', () => {
    // Two headings with different text that happen to slugify identically
    // after the loose matching. Must NOT cross-assign.
    const code = `function _createMdxContent(props) {
  const _components = Object.assign({ h2: "h2" }, props.components);
  return _jsxs("div", { children: [
    _jsx(_components.h2, { children: "foo-bar" }),
    _jsx(_components.h2, { children: "foo bar" }),
  ] });
}`;
    const headings = [
      { depth: 2, slug: 'foo-bar', text: 'foo-bar' },
      { depth: 2, slug: 'foo-bar-1', text: 'foo bar' },
    ];
    const result = injectHeadingIds(code, headings);

    const firstIdx = result.indexOf('children: "foo-bar"');
    const secondIdx = result.indexOf('children: "foo bar"');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);

    const regionFirst = result.slice(Math.max(0, firstIdx - 100), firstIdx);
    const regionSecond = result.slice(Math.max(0, secondIdx - 100), secondIdx);
    expect(regionFirst).toContain('id: "foo-bar"');
    expect(regionSecond).toContain('id: "foo-bar-1"');
  });
});

describe('extractArrayInner', () => {
  test('handles bracket inside string literal', () => {
    expect(extractArrayInner('["a]b", "c"]')).toBe('"a]b", "c"');
  });

  test('simple quoted string (no regression)', () => {
    expect(extractArrayInner('["ok"]')).toBe('"ok"');
  });

  test('handles single-quoted strings', () => {
    expect(extractArrayInner("['a]b', 'c']")).toBe("'a]b', 'c'");
  });

  test('brackets inside string literal', () => {
    expect(extractArrayInner('["a[b]c"]')).toBe('"a[b]c"');
  });
});
