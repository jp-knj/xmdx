import { describe, test, expect } from 'bun:test';
import {
  decodeHtmlEntities,
  rewriteExpressiveCodeBlocks,
  rewriteSetHtmlCodeBlocks,
  rewriteJsStringCodeBlocks,
  injectExpressiveCodeComponent,
  stripExpressiveCodeImport,
  renderExpressiveCodeBlocks,
} from './expressive-code.js';
import type { ExpressiveCodeManager } from '../vite-plugin/highlighting/expressive-code-manager.js';

describe('decodeHtmlEntities', () => {
  test('returns value as-is when empty', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });

  test('returns value as-is when no entities present', () => {
    expect(decodeHtmlEntities('hello world')).toBe('hello world');
  });

  test('decodes hex entities', () => {
    expect(decodeHtmlEntities('&#x41;')).toBe('A');
    expect(decodeHtmlEntities('&#x3c;div&#x3e;')).toBe('<div>');
  });

  test('decodes decimal entities', () => {
    expect(decodeHtmlEntities('&#65;')).toBe('A');
    expect(decodeHtmlEntities('&#60;div&#62;')).toBe('<div>');
  });

  test('decodes named entities', () => {
    expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"');
    expect(decodeHtmlEntities("&#39;world&#39;")).toBe("'world'");
    expect(decodeHtmlEntities('&lt;div&gt;')).toBe('<div>');
    expect(decodeHtmlEntities('&amp;')).toBe('&');
  });

  test('decodes mixed entities', () => {
    expect(decodeHtmlEntities('&lt;div&#x3e;&#65;&amp;&quot;')).toBe(
      '<div>A&"'
    );
  });

  test('decodes multiple occurrences', () => {
    expect(decodeHtmlEntities('&lt;&lt;&lt;')).toBe('<<<');
    expect(decodeHtmlEntities('&#x41;&#x42;&#x43;')).toBe('ABC');
  });

  test('handles ampersand correctly (decoded last)', () => {
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });
});

describe('rewriteExpressiveCodeBlocks', () => {
  test('returns unchanged code when no code blocks', () => {
    const code = '# Hello\n\nSome text';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe(code);
    expect(result.changed).toBe(false);
  });

  test('rewrites simple code block without language', () => {
    const code = '<pre><code>const x = 1;</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const x = 1;"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('rewrites code block with language', () => {
    const code = '<pre><code class="language-javascript">const x = 1;</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe(
      '<Code code={"const x = 1;"} lang="javascript" __xmdx />'
    );
    expect(result.changed).toBe(true);
  });

  test('rewrites multiple code blocks', () => {
    const code =
      '<pre><code class="language-js">let a = 1;</code></pre>\n\n<pre><code class="language-ts">let b: number = 2;</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe(
      '<Code code={"let a = 1;"} lang="js" __xmdx />\n\n<Code code={"let b: number = 2;"} lang="ts" __xmdx />'
    );
    expect(result.changed).toBe(true);
  });

  test('decodes HTML entities in code content', () => {
    const code = '<pre><code>&lt;div&gt;&amp;&lt;/div&gt;</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"<div>&</div>"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('uses custom component name', () => {
    const code = '<pre><code>hello</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'MyCode');
    expect(result.code).toBe('<MyCode code={"hello"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('handles multiline code', () => {
    const code = '<pre><code>line 1\nline 2\nline 3</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"line 1\\nline 2\\nline 3"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('preserves code with special characters', () => {
    const code = '<pre><code>const str = "hello";</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const str = \\"hello\\";"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('handles pre tag with attributes', () => {
    const code = '<pre class="astro-code" tabindex="0"><code class="language-sh"># create a new project\nnpm create astro@latest</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"# create a new project\\nnpm create astro@latest"} lang="sh" __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('handles pre tag with single attribute', () => {
    const code = '<pre tabindex="0"><code>simple code</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"simple code"} __xmdx />');
    expect(result.changed).toBe(true);
  });
});

describe('rewriteSetHtmlCodeBlocks', () => {
  test('returns unchanged when no Fragment marker found', () => {
    const code = '<div><p>Hello</p></div>';
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toBe(code);
    expect(result.changed).toBe(false);
  });

  test('returns unchanged when no code blocks inside Fragment', () => {
    const code = '<_Fragment set:html={"<p>Hello world</p>"} />';
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toBe(code);
    expect(result.changed).toBe(false);
  });

  test('rewrites code block inside Fragment', () => {
    const code = '<_Fragment set:html={"<pre><code>const x = 1;</code></pre>"} />';
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const x = 1;"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('rewrites code block with language inside Fragment', () => {
    const html = '<pre><code class="language-js">let a = 1;</code></pre>';
    const code = `<_Fragment set:html={${JSON.stringify(html)}} />`;
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"let a = 1;"} lang="js" __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('processes multiple Fragment occurrences', () => {
    const code = `
      <_Fragment set:html={"<pre><code>first</code></pre>"} />
      <_Fragment set:html={"<pre><code>second</code></pre>"} />
    `;
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toContain('<Code code={"first"} __xmdx />');
    expect(result.code).toContain('<Code code={"second"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('preserves surrounding JSX', () => {
    const code = `
      <SplitCard>
        <_Fragment set:html={"<pre><code>npm install</code></pre>"} />
      </SplitCard>
    `;
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toContain('<SplitCard>');
    expect(result.code).toContain('</SplitCard>');
    expect(result.code).toContain('<Code code={"npm install"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('uses custom component name', () => {
    const code = '<_Fragment set:html={"<pre><code>test</code></pre>"} />';
    const result = rewriteSetHtmlCodeBlocks(code, 'MyCodeBlock');
    expect(result.code).toBe('<MyCodeBlock code={"test"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('handles JSON with escaped quotes', () => {
    const html = '<pre><code>const str = "hello";</code></pre>';
    const code = `<_Fragment set:html={${JSON.stringify(html)}} />`;
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const str = \\"hello\\";"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('skips invalid JSON', () => {
    const code = '<_Fragment set:html={not valid json} />';
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toBe(code);
    expect(result.changed).toBe(false);
  });

  test('handles mixed HTML and code - keeps Fragment for mixed content', () => {
    const html = '<p>text</p><pre><code>hello</code></pre>';
    const code = `<_Fragment set:html={${JSON.stringify(html)}} />`;
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    // When there's mixed content, the code block is replaced inline
    expect(result.code).toContain('<Code code={"hello"} __xmdx />');
    expect(result.changed).toBe(true);
  });
});

describe('injectExpressiveCodeComponent', () => {
  test('does not inject if already imported', () => {
    const code = `import { Code } from 'astro-expressive-code';\n\n# Hello`;
    const config = { component: 'Code', moduleId: 'astro-expressive-code' };
    const result = injectExpressiveCodeComponent(code, config);
    expect(result).toBe(code);
  });

  test('injects default Code import', () => {
    const code = `import { useState } from 'react';\n\n# Hello`;
    const config = {
      component: 'Code',
      moduleId: 'astro-expressive-code/components',
    };
    const result = injectExpressiveCodeComponent(code, config);
    expect(result).toContain(
      `import { Code } from 'astro-expressive-code/components';`
    );
    expect(result).toContain(`import { useState } from 'react';`);
  });

  test('injects aliased Code import for custom component name', () => {
    const code = `import { useState } from 'react';\n\n# Hello`;
    const config = {
      component: 'MyCode',
      moduleId: 'astro-expressive-code/components',
    };
    const result = injectExpressiveCodeComponent(code, config);
    expect(result).toContain(
      `import { Code as MyCode } from 'astro-expressive-code/components';`
    );
  });

  test('inserts after existing imports', () => {
    const code = `import { foo } from 'bar';\nimport { baz } from 'qux';\n\n# Content`;
    const config = { component: 'Code', moduleId: 'expressive-code' };
    const result = injectExpressiveCodeComponent(code, config);
    const lines = result.split('\n');
    const codeImportIndex = lines.findIndex((line) =>
      line.includes('import { Code }')
    );
    const lastImportIndex = lines.findIndex((line) =>
      line.includes('import { baz }')
    );
    expect(codeImportIndex).toBeGreaterThan(lastImportIndex);
  });

  test('inserts at beginning when no imports exist', () => {
    const code = `# Hello\n\nSome content`;
    const config = { component: 'Code', moduleId: 'expressive-code' };
    const result = injectExpressiveCodeComponent(code, config);
    expect(result).toMatch(/^import { Code } from 'expressive-code';/);
  });

  test('does not inject if custom component name already imported', () => {
    const code = `import { Code as MyCode } from 'somewhere';\n\n# Hello`;
    const config = { component: 'MyCode', moduleId: 'expressive-code' };
    const result = injectExpressiveCodeComponent(code, config);
    expect(result).toBe(code);
  });
});

describe('rewriteJsStringCodeBlocks', () => {
  test('returns unchanged code when no code blocks', () => {
    const code = 'const x = 1; const y = "hello";';
    const result = rewriteJsStringCodeBlocks(code, 'Code');
    expect(result.code).toBe(code);
    expect(result.changed).toBe(false);
  });

  test('rewrites simple code block from JS string literal', () => {
    const code = '"<pre class=\\"astro-code\\" tabindex=\\"0\\"><code>const x = 1;</code></pre>"';
    const result = rewriteJsStringCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const x = 1;"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('rewrites code block with language', () => {
    const code = '"<pre class=\\"astro-code\\" tabindex=\\"0\\"><code class=\\"language-javascript\\">const x = 1;</code></pre>"';
    const result = rewriteJsStringCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const x = 1;"} lang="javascript" __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('handles escaped newlines in code content', () => {
    const code = '"<pre class=\\"astro-code\\" tabindex=\\"0\\"><code class=\\"language-sh\\">line1\\nline2</code></pre>"';
    const result = rewriteJsStringCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"line1\\nline2"} lang="sh" __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('handles escaped quotes in code content', () => {
    const code = '"<pre class=\\"astro-code\\" tabindex=\\"0\\"><code>const str = \\"hello\\";</code></pre>"';
    const result = rewriteJsStringCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const str = \\"hello\\";"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('preserves surrounding JavaScript code', () => {
    const code = 'const a = 1; "<pre class=\\"astro-code\\" tabindex=\\"0\\"><code>test</code></pre>"; const b = 2;';
    const result = rewriteJsStringCodeBlocks(code, 'Code');
    expect(result.code).toBe('const a = 1; <Code code={"test"} __xmdx />; const b = 2;');
    expect(result.changed).toBe(true);
  });

  test('uses custom component name', () => {
    const code = '"<pre class=\\"astro-code\\" tabindex=\\"0\\"><code>hello</code></pre>"';
    const result = rewriteJsStringCodeBlocks(code, 'MyCode');
    expect(result.code).toBe('<MyCode code={"hello"} __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('handles mdxjs-rs output with rewrite_code_blocks enabled', () => {
    // Simulates mdxjs-rs JSX output when rewrite_code_blocks is true:
    // _jsx("pre", { ... }) gets rewritten to string literal "<pre class=..."
    const code = '_jsx(_components.pre, {children: "<pre class=\\"astro-code\\" tabindex=\\"0\\"><code class=\\"language-sh\\">npm install astro</code></pre>"})';
    const result = rewriteJsStringCodeBlocks(code, 'Code');
    expect(result.code).toContain('<Code code={"npm install astro"} lang="sh" __xmdx />');
    expect(result.changed).toBe(true);
  });

  test('handles multiple JS string code blocks in mdxjs-rs output', () => {
    const code = [
      '"<pre class=\\"astro-code\\" tabindex=\\"0\\"><code class=\\"language-js\\">const a = 1;</code></pre>"',
      '"<pre class=\\"astro-code\\" tabindex=\\"0\\"><code class=\\"language-ts\\">const b: number = 2;</code></pre>"',
    ].join('\n');
    const result = rewriteJsStringCodeBlocks(code, 'Code');
    expect(result.code).toContain('<Code code={"const a = 1;"} lang="js" __xmdx />');
    expect(result.code).toContain('<Code code={"const b: number = 2;"} lang="ts" __xmdx />');
    expect(result.changed).toBe(true);
  });
});

describe('_Fragment availability in MDX wrapper', () => {
  test('wrapMdxModule output includes _Fragment alias for ExpressiveCode compatibility', async () => {
    // Import wrapMdxModule to verify it produces _Fragment binding
    const { wrapMdxModule } = await import('../vite-plugin/mdx-wrapper/index.js');
    const { createRegistry } = await import('xmdx/registry');
    const registry = createRegistry([]);

    const mdxCode = `function MDXContent(props) { return <p>Hello</p>; }
export default MDXContent;`;

    const wrapped = wrapMdxModule(mdxCode, {
      frontmatter: {},
      headings: [],
      registry,
    }, 'test.mdx');

    // _Fragment must be bound so renderExpressiveCodeBlocks output resolves
    expect(wrapped).toContain('const _Fragment = Fragment;');
    expect(wrapped).toContain("import { Fragment } from 'astro/jsx-runtime';");
  });
});

describe('stripExpressiveCodeImport', () => {
  const defaultConfig = { component: 'Code', moduleId: 'astro-expressive-code/components' };

  test('removes import when no <Code /> remains', () => {
    const code = `import { Code } from 'astro-expressive-code/components';\n\n<_Fragment set:html={"<figure>...</figure>"} />`;
    const result = stripExpressiveCodeImport(code, defaultConfig);
    expect(result).not.toContain("import { Code }");
    expect(result).toContain('<_Fragment');
  });

  test('preserves import when <Code /> is still referenced', () => {
    const code = `import { Code } from 'astro-expressive-code/components';\n\n<Code code={"hello"} lang="js" />`;
    const result = stripExpressiveCodeImport(code, defaultConfig);
    expect(result).toContain("import { Code }");
  });

  test('handles custom component name', () => {
    const config = { component: 'MyCode', moduleId: 'my-ec/components' };
    const code = `import { Code as MyCode } from 'my-ec/components';\n\n<_Fragment set:html={"rendered"} />`;
    const result = stripExpressiveCodeImport(code, config);
    expect(result).not.toContain("import { Code as MyCode }");
  });

  test('preserves import when <Code> tag spans multiple lines', () => {
    const code = `import { Code } from 'astro-expressive-code/components';\n\n<Code\n  code={"hello"}\n  lang="js"\n/>`;
    const result = stripExpressiveCodeImport(code, defaultConfig);
    expect(result).toContain("import { Code }");
  });

  test('no-ops on empty string', () => {
    expect(stripExpressiveCodeImport('', defaultConfig)).toBe('');
  });
});

describe('renderExpressiveCodeBlocks', () => {
  function mockEcManager(opts: {
    enabled?: boolean;
    renderFn?: (code: string, lang?: string) => Promise<string | null>;
  } = {}): ExpressiveCodeManager {
    return {
      enabled: opts.enabled ?? true,
      render: opts.renderFn ?? (async (code: string) =>
        `<figure class="expressive-code"><pre><code>${code}</code></pre></figure>`
      ),
    } as unknown as ExpressiveCodeManager;
  }

  test('pre-renders Code component to Fragment set:html', async () => {
    const code = `<Code code={"console.log('hello')"} lang="js" __xmdx />`;
    const ecm = mockEcManager();
    const result = await renderExpressiveCodeBlocks(code, ecm);
    expect(result.changed).toBe(true);
    expect(result.code).toContain('<_Fragment set:html={');
    expect(result.code).toContain('expressive-code');
    expect(result.code).not.toContain('<Code');
  });

  test('returns unchanged when no Code components present', async () => {
    const code = '<div><p>Hello world</p></div>';
    const ecm = mockEcManager();
    const result = await renderExpressiveCodeBlocks(code, ecm);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(code);
  });

  test('gracefully handles render returning null', async () => {
    const code = '<Code code={"test"} lang="js" __xmdx />';
    const ecm = mockEcManager({ renderFn: async () => null });
    const result = await renderExpressiveCodeBlocks(code, ecm);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(code);
  });

  test('skips when ecManager is not enabled', async () => {
    const code = '<Code code={"test"} lang="js" __xmdx />';
    const ecm = mockEcManager({ enabled: false });
    const result = await renderExpressiveCodeBlocks(code, ecm);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(code);
  });

  test('full flow: inject import → pre-render all → strip dead import', async () => {
    const config = { component: 'Code', moduleId: 'astro-expressive-code/components' };
    // Simulate transform pipeline: start with code that has a Code component + import
    let code = `import { Code } from 'astro-expressive-code/components';\n\n<Code code={"console.log('hi')"} lang="js" __xmdx />`;
    const ecm = mockEcManager();
    // Pre-render all Code components
    const result = await renderExpressiveCodeBlocks(code, ecm);
    expect(result.changed).toBe(true);
    expect(result.code).not.toContain('<Code ');
    // Strip the now-dead import
    const final = stripExpressiveCodeImport(result.code, config);
    expect(final).not.toContain("import { Code }");
    expect(final).toContain('<_Fragment set:html={');
  });

  test('leaves user-authored Code components untouched (no __xmdx marker)', async () => {
    const code = '<Code code={"user code"} lang="js" />';
    const ecm = mockEcManager();
    const result = await renderExpressiveCodeBlocks(code, ecm);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(code);
  });
});
