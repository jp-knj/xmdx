import { describe, test, expect } from 'bun:test';
import { wrapMdxModule } from '../mdx-wrapper.js';
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
  });
});
