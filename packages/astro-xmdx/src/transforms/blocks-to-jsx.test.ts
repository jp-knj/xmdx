import { describe, it, expect } from 'bun:test';
import { blocksToJsx, type Block } from './blocks-to-jsx.js';
import { createRegistry, starlightLibrary } from 'xmdx/registry';

describe('blocksToJsx', () => {
  describe('user imports', () => {
    it('should include user imports in output', () => {
      const blocks: Block[] = [
        { type: 'html', content: '<p>Hello</p>' },
      ];
      const userImports = ["import Card from '~/components/Card.astro';"];

      const result = blocksToJsx(blocks, {}, [], null, undefined, userImports);

      expect(result).toContain("import Card from '~/components/Card.astro';");
    });

    it('should skip registry imports for user-imported components', () => {
      const registry = createRegistry([starlightLibrary]);

      const blocks: Block[] = [
        { type: 'component', name: 'Card', props: {}, slotChildren: [{ type: 'html', content: '<p>Content</p>' }] },
      ];
      const userImports = ["import Card from '~/components/Landing/Card.astro';"];

      const result = blocksToJsx(blocks, {}, [], registry, undefined, userImports);

      // Should include user import
      expect(result).toContain("import Card from '~/components/Landing/Card.astro';");
      // Should NOT include registry import for Card
      expect(result).not.toContain('@astrojs/starlight/components');
    });

    it('should generate registry imports for non-user-imported components', () => {
      const registry = createRegistry([starlightLibrary]);

      const blocks: Block[] = [
        { type: 'component', name: 'Card', props: {}, slotChildren: [{ type: 'html', content: '<p>Card Content</p>' }] },
        { type: 'component', name: 'Aside', props: {}, slotChildren: [{ type: 'html', content: '<p>Aside Content</p>' }] },
      ];
      // Only Card is user-imported
      const userImports = ["import Card from '~/components/Card.astro';"];

      const result = blocksToJsx(blocks, {}, [], registry, undefined, userImports);

      // User import for Card
      expect(result).toContain("import Card from '~/components/Card.astro';");
      // Registry import for Aside (since it's not user-imported)
      expect(result).toContain("import { Aside } from '@astrojs/starlight/components';");
    });

    it('should handle multiple user imports', () => {
      const blocks: Block[] = [
        { type: 'component', name: 'Card', props: {} },
        { type: 'component', name: 'Button', props: {} },
      ];
      const userImports = [
        "import Card from '~/components/Card.astro';",
        "import Button from '~/components/Button.astro';",
      ];

      const result = blocksToJsx(blocks, {}, [], null, undefined, userImports);

      expect(result).toContain("import Card from '~/components/Card.astro';");
      expect(result).toContain("import Button from '~/components/Button.astro';");
    });

    it('should handle named imports in user imports', () => {
      const registry = createRegistry([starlightLibrary]);

      const blocks: Block[] = [
        { type: 'component', name: 'Aside', props: {} },
      ];
      // User provides named import for Aside
      const userImports = ["import { Aside } from './my-components';"];

      const result = blocksToJsx(blocks, {}, [], registry, undefined, userImports);

      // Should include user import
      expect(result).toContain("import { Aside } from './my-components';");
      // Should NOT include registry import for Aside
      expect(result).not.toContain('@astrojs/starlight/components');
    });

    it('should handle aliased imports in user imports', () => {
      const registry = createRegistry([starlightLibrary]);

      const blocks: Block[] = [
        { type: 'component', name: 'MyCard', props: {} },
      ];
      // User imports Card as MyCard
      const userImports = ["import { Card as MyCard } from './my-components';"];

      const result = blocksToJsx(blocks, {}, [], registry, undefined, userImports);

      // Should include user import
      expect(result).toContain("import { Card as MyCard } from './my-components';");
    });

    it('should default to empty user imports when not provided', () => {
      const blocks: Block[] = [
        { type: 'html', content: '<p>Hello</p>' },
      ];

      // Call without userImports parameter
      const result = blocksToJsx(blocks, {}, [], null, undefined);

      // Should generate valid output without errors
      expect(result).toContain('export const frontmatter');
      expect(result).toContain('export default XmdxContent');
    });
  });

  describe('basic functionality', () => {
    it('should generate valid JSX module for HTML blocks', () => {
      const blocks: Block[] = [
        { type: 'html', content: '<p>Hello World</p>' },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('export const frontmatter');
      expect(result).toContain('export function getHeadings()');
      expect(result).toContain('export const Content');
      expect(result).toContain('export default XmdxContent');
    });

    it('should use set:html for HTML content', () => {
      const blocks: Block[] = [
        { type: 'html', content: '<p>Test</p>' },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('set:html=');
    });

    it('should include runtime imports', () => {
      const blocks: Block[] = [];

      const result = blocksToJsx(blocks);

      expect(result).toContain("import { createComponent, renderJSX } from 'astro/runtime/server/index.js';");
      expect(result).toContain("import { Fragment, Fragment as _Fragment, jsx as _jsx } from 'astro/jsx-runtime';");
    });
  });

  describe('nested components', () => {
    it('should embed nested components directly without set:html', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'CardGrid',
          props: {},
          // Use HTML-style attributes (what the Rust renderer produces)
          slotChildren: [{ type: 'html', content: '<Card title="Getting Started">Content here</Card>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should embed JSX directly, not use set:html
      expect(result).toContain('<CardGrid><Card title="Getting Started">Content here</Card></CardGrid>');
      expect(result).not.toContain('set:html={');
    });

    it('should use set:html for pure HTML slot content', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Card',
          props: {},
          slotChildren: [{ type: 'html', content: '<p>Hello <strong>world</strong></p>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should use set:html for HTML content
      expect(result).toContain('set:html=');
      expect(result).toContain('<Card><_Fragment set:html=');
    });

    it('should use set:html for uppercase HTML tags (not components)', () => {
      // Uppercase HTML tags like <SVG>, <DIV> should NOT be treated as components
      // Only true PascalCase (uppercase followed by lowercase) should be components
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Container',
          props: {},
          slotChildren: [{ type: 'html', content: '<SVG><path d="M0 0h24v24H0z"/></SVG>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should use set:html because <SVG> is not a PascalCase component
      expect(result).toContain('set:html=');
      expect(result).toContain('<Container><_Fragment set:html=');
    });

    it('should detect acronym-prefixed PascalCase components like MDXProvider', () => {
      // Components that start with acronyms like MDX, URL, API should be detected
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Container',
          props: {},
          slotChildren: [{ type: 'html', content: '<MDXProvider>content</MDXProvider>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should embed JSX directly, not use set:html
      expect(result).toContain('<Container><MDXProvider>content</MDXProvider></Container>');
      expect(result).not.toContain('set:html={');
    });

    it('should detect URLTable and other acronym-prefixed components', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Section',
          props: {},
          slotChildren: [{ type: 'html', content: '<URLTable /><APIClient>data</APIClient>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should embed JSX directly because these are PascalCase components
      expect(result).toContain('<Section><URLTable /><APIClient>data</APIClient></Section>');
      expect(result).not.toContain('set:html={');
    });

    it('should still use set:html for all-uppercase tags like HTML, DIV', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Container',
          props: {},
          slotChildren: [{ type: 'html', content: '<DIV>content</DIV><HTML><BODY></BODY></HTML>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // All-uppercase should use set:html path
      expect(result).toContain('set:html=');
      expect(result).toContain('<Container><_Fragment set:html=');
    });

    it('should handle multiple nested components', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'CardGrid',
          props: {},
          // Use HTML-style attributes (what the Rust renderer produces)
          slotChildren: [{ type: 'html', content: '<Card title="First">First card</Card><Card title="Second">Second card</Card>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should embed JSX directly
      expect(result).toContain('<CardGrid><Card title="First">First card</Card><Card title="Second">Second card</Card></CardGrid>');
      expect(result).not.toContain('set:html={');
    });

    it('should handle self-closing nested components', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Container',
          props: {},
          slotChildren: [{ type: 'html', content: '<Icon name="star" />' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should embed JSX directly for self-closing component
      expect(result).toContain('<Container><Icon name="star" /></Container>');
      expect(result).not.toContain('set:html={');
    });

    it('should handle mixed HTML and component content', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Section',
          props: {},
          slotChildren: [{ type: 'html', content: '<p>Intro text</p><Card>Content</Card><p>More text</p>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should embed JSX directly because it contains a component
      expect(result).toContain('<Section><p>Intro text</p><Card>Content</Card><p>More text</p></Section>');
      expect(result).not.toContain('set:html={');
    });

    it('should self-close void HTML tags when embedding slot content', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Section',
          props: {},
          slotChildren: [{ type: 'html', content: '<Card>Content</Card><img src="/img.png">' }],
        },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('<Section><Card>Content</Card><img src="/img.png" /></Section>');
      expect(result).not.toContain('<img src="/img.png">');
    });

    it('should convert HTML entities to JSX expressions in nested component content', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Card',
          props: {},
          // HTML entities that would appear literally in JSX
          slotChildren: [{ type: 'html', content: '<Badge>a &lt; b &amp;&amp; c</Badge>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Entities should become JSX expressions: &lt; becomes {"<"}, &amp; becomes {"&"}
      expect(result).toContain('<Card><Badge>a {"<"} b {"&"}{"&"} c</Badge></Card>');
      // Should NOT contain the encoded entities
      expect(result).not.toContain('&lt;');
      expect(result).not.toContain('&amp;');
      // Should NOT decode to raw characters (that would break JSX)
      expect(result).not.toContain('<Card><Badge>a < b && c</Badge></Card>');
    });

    it('should convert literal ampersands to JSX expressions in nested component content', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Card',
          props: {},
          // Literal & character (not encoded as entity)
          slotChildren: [{ type: 'html', content: '<Badge>Languages & Frameworks</Badge>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Literal & should become JSX expression
      expect(result).toContain('Languages {"&"} Frameworks');
      // Should NOT contain raw & (that would break JSX)
      expect(result).not.toContain('Languages & Frameworks');
    });

    it('should preserve unknown HTML entities in nested component content', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Card',
          props: {},
          // Unknown entity like &nbsp; should be preserved
          slotChildren: [{ type: 'html', content: '<Badge>Hello&nbsp;World</Badge>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Unknown entities should be left as-is
      expect(result).toContain('&nbsp;');
    });

    it('should preserve valid JSX expressions in nested components', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'CardGrid',
          props: {},
          // Valid JSX expression that should NOT be escaped
          slotChildren: [{
            type: 'component',
            name: 'Card',
            props: { title: { type: 'expression', value: 'title' } },
            slotChildren: [{ type: 'html', content: 'Content' }],
          }],
        },
      ];

      const result = blocksToJsx(blocks);

      // JSX expressions should be preserved, not escaped
      expect(result).toContain('title={title}');
      expect(result).not.toContain("{'{'}");
      expect(result).toContain('<CardGrid><Card title={title}>Content</Card></CardGrid>');
    });
  });

  describe('code blocks', () => {
    it('should render standalone code block as <pre><code> in set:html Fragment', () => {
      const blocks: Block[] = [
        { type: 'code', code: 'console.log("hello")' },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('<_Fragment set:html=');
      expect(result).toContain('astro-code');
      expect(result).toContain('console.log');
    });

    it('should include language class when lang is set', () => {
      const blocks: Block[] = [
        { type: 'code', code: 'const x = 1;', lang: 'js' },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('language-js');
    });

    it('should escape special characters in code content', () => {
      const blocks: Block[] = [
        { type: 'code', code: 'if (a < b && c > d) { run(); }', lang: 'js' },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('&lt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&#123;');
      expect(result).toContain('&#125;');
      // Raw chars should not appear unescaped in the HTML
      expect(result).not.toContain('"if (a < b');
    });

    it('should render code block in component slot via slotChildrenToHtml', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Card',
          props: {},
          slotChildren: [
            { type: 'html', content: '<p>Intro</p>' },
            { type: 'code', code: 'let x = 1;', lang: 'ts' },
          ],
        },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('astro-code');
      expect(result).toContain('language-ts');
      expect(result).toContain('let x = 1;');
    });

    it('should always render code blocks as <pre><code> (EC rewriting is pipeline-only)', () => {
      const blocks: Block[] = [
        { type: 'code', code: 'const x = 1;', lang: 'js', meta: 'title="example"' },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('astro-code');
      expect(result).toContain('language-js');
      expect(result).toContain('const x = 1;');
      expect(result).not.toContain('<Code code=');
    });

    it('should render code blocks as <pre><code> in slots too', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Card',
          props: {},
          slotChildren: [
            { type: 'code', code: 'hello()', lang: 'py' },
          ],
        },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('astro-code');
      expect(result).toContain('language-py');
      expect(result).toContain('hello()');
      expect(result).not.toContain('<Code code=');
    });

    it('should handle mixed code and HTML in slot', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Section',
          props: {},
          slotChildren: [
            { type: 'html', content: '<p>Before code</p>' },
            { type: 'code', code: 'fn main() {}', lang: 'rust' },
            { type: 'html', content: '<p>After code</p>' },
          ],
        },
      ];

      const result = blocksToJsx(blocks);

      expect(result).toContain('<p>Before code</p>');
      expect(result).toContain('astro-code');
      expect(result).toContain('language-rust');
      expect(result).toContain('After code');
    });
  });

  describe('Fragment slot stripping', () => {
    it('should strip <p> wrapper from Fragment with slot attribute', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'IslandsDiagram',
          props: {},
          slotChildren: [{ type: 'html', content: '<p><Fragment slot="headerApp">Header text</Fragment></p>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should NOT contain the <p> wrapper
      expect(result).not.toContain('<p><Fragment slot=');
      // Should contain the Fragment with slot directly
      expect(result).toContain('<Fragment slot="headerApp">');
    });

    it('should strip multiple <p> wrappers from Fragment slots', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Container',
          props: {},
          slotChildren: [{ type: 'html', content: '<p><Fragment slot="header">Header</Fragment></p><p><Fragment slot="footer">Footer</Fragment></p>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Should NOT contain any <p><Fragment patterns
      expect(result).not.toContain('<p><Fragment slot=');
      // Should contain both Fragment slots
      expect(result).toContain('<Fragment slot="header">Header</Fragment>');
      expect(result).toContain('<Fragment slot="footer">Footer</Fragment>');
    });

    it('should preserve regular paragraphs', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Card',
          props: {},
          slotChildren: [{ type: 'html', content: '<p>Regular paragraph content</p>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Regular paragraphs should be preserved
      expect(result).toContain('<p>Regular paragraph content</p>');
    });

    it('should preserve Fragment without slot attribute', () => {
      const blocks: Block[] = [
        {
          type: 'component',
          name: 'Wrapper',
          props: {},
          slotChildren: [{ type: 'html', content: '<p><Fragment>Content without slot</Fragment></p>' }],
        },
      ];

      const result = blocksToJsx(blocks);

      // Fragment without slot= should NOT be stripped
      expect(result).toContain('<p><Fragment>Content without slot</Fragment></p>');
    });
  });
});
