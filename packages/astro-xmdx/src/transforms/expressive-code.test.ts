import { describe, test, expect } from 'bun:test';
import {
  decodeHtmlEntities,
  rewriteExpressiveCodeBlocks,
  rewriteSetHtmlCodeBlocks,
  injectExpressiveCodeComponent,
} from './expressive-code.js';

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
    expect(result.code).toBe('<Code code={"const x = 1;"} />');
    expect(result.changed).toBe(true);
  });

  test('rewrites code block with language', () => {
    const code = '<pre><code class="language-javascript">const x = 1;</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe(
      '<Code code={"const x = 1;"} lang="javascript" />'
    );
    expect(result.changed).toBe(true);
  });

  test('rewrites multiple code blocks', () => {
    const code =
      '<pre><code class="language-js">let a = 1;</code></pre>\n\n<pre><code class="language-ts">let b: number = 2;</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe(
      '<Code code={"let a = 1;"} lang="js" />\n\n<Code code={"let b: number = 2;"} lang="ts" />'
    );
    expect(result.changed).toBe(true);
  });

  test('decodes HTML entities in code content', () => {
    const code = '<pre><code>&lt;div&gt;&amp;&lt;/div&gt;</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"<div>&</div>"} />');
    expect(result.changed).toBe(true);
  });

  test('uses custom component name', () => {
    const code = '<pre><code>hello</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'MyCode');
    expect(result.code).toBe('<MyCode code={"hello"} />');
    expect(result.changed).toBe(true);
  });

  test('handles multiline code', () => {
    const code = '<pre><code>line 1\nline 2\nline 3</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"line 1\\nline 2\\nline 3"} />');
    expect(result.changed).toBe(true);
  });

  test('preserves code with special characters', () => {
    const code = '<pre><code>const str = "hello";</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const str = \\"hello\\";"} />');
    expect(result.changed).toBe(true);
  });

  test('handles pre tag with attributes', () => {
    const code = '<pre class="astro-code" tabindex="0"><code class="language-sh"># create a new project\nnpm create astro@latest</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"# create a new project\\nnpm create astro@latest"} lang="sh" />');
    expect(result.changed).toBe(true);
  });

  test('handles pre tag with single attribute', () => {
    const code = '<pre tabindex="0"><code>simple code</code></pre>';
    const result = rewriteExpressiveCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"simple code"} />');
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
    expect(result.code).toBe('<Code code={"const x = 1;"} />');
    expect(result.changed).toBe(true);
  });

  test('rewrites code block with language inside Fragment', () => {
    const html = '<pre><code class="language-js">let a = 1;</code></pre>';
    const code = `<_Fragment set:html={${JSON.stringify(html)}} />`;
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"let a = 1;"} lang="js" />');
    expect(result.changed).toBe(true);
  });

  test('processes multiple Fragment occurrences', () => {
    const code = `
      <_Fragment set:html={"<pre><code>first</code></pre>"} />
      <_Fragment set:html={"<pre><code>second</code></pre>"} />
    `;
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toContain('<Code code={"first"} />');
    expect(result.code).toContain('<Code code={"second"} />');
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
    expect(result.code).toContain('<Code code={"npm install"} />');
    expect(result.changed).toBe(true);
  });

  test('uses custom component name', () => {
    const code = '<_Fragment set:html={"<pre><code>test</code></pre>"} />';
    const result = rewriteSetHtmlCodeBlocks(code, 'MyCodeBlock');
    expect(result.code).toBe('<MyCodeBlock code={"test"} />');
    expect(result.changed).toBe(true);
  });

  test('handles JSON with escaped quotes', () => {
    const html = '<pre><code>const str = "hello";</code></pre>';
    const code = `<_Fragment set:html={${JSON.stringify(html)}} />`;
    const result = rewriteSetHtmlCodeBlocks(code, 'Code');
    expect(result.code).toBe('<Code code={"const str = \\"hello\\";"} />');
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
    expect(result.code).toContain('<Code code={"hello"} />');
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
