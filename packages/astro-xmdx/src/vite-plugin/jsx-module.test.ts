import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { wrapHtmlInJsxModule } from './jsx-module.js';

describe('wrapHtmlInJsxModule', () => {
  // Store original env values
  let originalRenderTemplate: string | undefined;
  let originalRenderProfile: string | undefined;

  beforeEach(() => {
    // Save original env values
    originalRenderTemplate = process.env.XMDX_RENDER_TEMPLATE;
    originalRenderProfile = process.env.XMDX_RENDER_PROFILE;
    // Reset to default mode (Fragment with set:html)
    delete process.env.XMDX_RENDER_TEMPLATE;
    delete process.env.XMDX_RENDER_PROFILE;
  });

  afterEach(() => {
    // Restore original env values
    if (originalRenderTemplate !== undefined) {
      process.env.XMDX_RENDER_TEMPLATE = originalRenderTemplate;
    } else {
      delete process.env.XMDX_RENDER_TEMPLATE;
    }
    if (originalRenderProfile !== undefined) {
      process.env.XMDX_RENDER_PROFILE = originalRenderProfile;
    } else {
      delete process.env.XMDX_RENDER_PROFILE;
    }
  });

  describe('default mode (Fragment with set:html)', () => {
    test('wraps HTML in Fragment with set:html', () => {
      const html = '<p>Hello World</p>';
      const result = wrapHtmlInJsxModule(html, {}, [], 'test.mdx');

      expect(result).toContain('set:html=');
      expect(result).toContain(JSON.stringify(html));
      expect(result).toContain('_Fragment');
    });

    test('exports frontmatter as JSON', () => {
      const frontmatter = { title: 'Test', draft: false };
      const result = wrapHtmlInJsxModule('<p>Content</p>', frontmatter, [], 'test.mdx');

      expect(result).toContain('export const frontmatter =');
      expect(result).toContain(JSON.stringify(frontmatter));
    });

    test('exports getHeadings function', () => {
      const headings = [
        { depth: 1, slug: 'intro', text: 'Introduction' },
        { depth: 2, slug: 'details', text: 'Details' },
      ];
      const result = wrapHtmlInJsxModule('<h1>Intro</h1>', {}, headings, 'test.mdx');

      expect(result).toContain('export function getHeadings()');
      expect(result).toContain(JSON.stringify(headings));
    });

    test('exports Content and default export', () => {
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx');

      expect(result).toContain('export const Content = XmdxContent;');
      expect(result).toContain('export default XmdxContent;');
    });

    test('uses createComponent from astro runtime', () => {
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx');

      expect(result).toContain("import { createComponent, renderJSX } from 'astro/runtime/server/index.js';");
    });

    test('includes filename in createComponent', () => {
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'src/content/docs/intro.mdx');

      expect(result).toContain(JSON.stringify('src/content/docs/intro.mdx'));
    });
  });

  describe('hoisted exports', () => {
    test('includes non-default hoisted exports', () => {
      const hoistedExports = [
        { source: 'export const customVar = 42;', isDefault: false },
        { source: 'export function helper() { return "help"; }', isDefault: false },
      ];
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx', {
        hoistedExports,
      });

      expect(result).toContain('export const customVar = 42;');
      expect(result).toContain('export function helper() { return "help"; }');
    });

    test('omits default export when hasUserDefaultExport is true', () => {
      const hoistedExports = [
        { source: 'export default MyComponent;', isDefault: true },
      ];
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx', {
        hoistedExports,
        hasUserDefaultExport: true,
      });

      expect(result).toContain('export default MyComponent;');
      // Should not have the auto-generated default export
      expect(result).not.toContain('export default XmdxContent;');
    });

    test('includes default export when hasUserDefaultExport is false', () => {
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx', {
        hasUserDefaultExport: false,
      });

      expect(result).toContain('export default XmdxContent;');
    });

    test('separates user default export from auto-generated exports', () => {
      const hoistedExports = [
        { source: 'export const foo = 1;', isDefault: false },
        { source: 'export default CustomLayout;', isDefault: true },
      ];
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx', {
        hoistedExports,
        hasUserDefaultExport: true,
      });

      expect(result).toContain('export const foo = 1;');
      expect(result).toContain('export default CustomLayout;');
      expect(result).not.toContain('export default XmdxContent;');
    });
  });

  describe('renderTemplate mode', () => {
    test('uses renderTemplate when XMDX_RENDER_TEMPLATE=1', () => {
      process.env.XMDX_RENDER_TEMPLATE = '1';

      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx');

      expect(result).toContain('renderTemplate');
      expect(result).toContain("import { createComponent, renderTemplate } from 'astro/runtime/server/index.js';");
      // Should not have Fragment imports in this mode
      expect(result).not.toContain('_Fragment');
    });

    test('wraps HTML in renderTemplate array', () => {
      process.env.XMDX_RENDER_TEMPLATE = '1';

      const html = '<p>Hello</p>';
      const result = wrapHtmlInJsxModule(html, {}, [], 'test.mdx');

      expect(result).toContain('renderTemplate([__xmdxHtml])');
    });
  });

  describe('profiling mode', () => {
    test('includes profiling code when XMDX_RENDER_PROFILE=1', () => {
      process.env.XMDX_RENDER_PROFILE = '1';

      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx');

      expect(result).toContain('__xmdxProfile');
      expect(result).toContain('__xmdxTotals');
      expect(result).toContain('__xmdxCounts');
      expect(result).toContain('__xmdxNow');
    });

    test('includes profiling code in renderTemplate mode', () => {
      process.env.XMDX_RENDER_TEMPLATE = '1';
      process.env.XMDX_RENDER_PROFILE = '1';

      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx');

      expect(result).toContain('__xmdxProfile');
      expect(result).toContain('renderTemplate');
    });
  });

  describe('edge cases', () => {
    test('handles empty HTML', () => {
      const result = wrapHtmlInJsxModule('', {}, [], 'test.mdx');

      expect(result).toContain('set:html=');
      expect(result).toContain('""');
    });

    test('handles HTML with special characters', () => {
      const html = '<p>Special: "quotes" & \'apostrophes\' \n newlines</p>';
      const result = wrapHtmlInJsxModule(html, {}, [], 'test.mdx');

      // Should be properly JSON-escaped
      expect(result).toContain(JSON.stringify(html));
    });

    test('handles complex frontmatter', () => {
      const frontmatter = {
        title: 'Test "Title"',
        tags: ['one', 'two'],
        nested: { key: 'value' },
      };
      const result = wrapHtmlInJsxModule('<p>Test</p>', frontmatter, [], 'test.mdx');

      expect(result).toContain(JSON.stringify(frontmatter));
    });

    test('handles headings with special characters in text', () => {
      const headings = [
        { depth: 1, slug: 'whats-new', text: "What's New?" },
        { depth: 2, slug: 'ampersand', text: 'A & B' },
      ];
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, headings, 'test.mdx');

      expect(result).toContain(JSON.stringify(headings));
    });

    test('handles empty hoisted exports array', () => {
      const result = wrapHtmlInJsxModule('<p>Test</p>', {}, [], 'test.mdx', {
        hoistedExports: [],
      });

      expect(result).toContain('export const frontmatter');
      expect(result).toContain('export default XmdxContent;');
    });
  });
});
