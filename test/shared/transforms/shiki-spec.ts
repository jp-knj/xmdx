import { describe, test, expect } from 'bun:test';

type HighlightFn = (code: string, lang?: string) => Promise<string>;

export interface ShikiModule {
  highlightHtmlBlocks(html: string, highlight: HighlightFn): Promise<string>;
  highlightJsStringCodeBlocks(code: string, highlight: HighlightFn): Promise<string>;
  highlightJsxCodeBlocks(code: string, highlight: HighlightFn): Promise<string>;
  rewriteAstroSetHtml(code: string, highlight: HighlightFn): Promise<string>;
}

const mockHighlight = async (code: string, lang?: string): Promise<string> => {
  const langAttr = lang ? ` class="language-${lang}"` : '';
  return `<pre${langAttr}><code${langAttr}>${code.toUpperCase()}</code></pre>`;
};

export function runShikiTests({
  highlightHtmlBlocks,
  highlightJsStringCodeBlocks,
  highlightJsxCodeBlocks,
  rewriteAstroSetHtml,
}: ShikiModule): void {
  describe('highlightHtmlBlocks', () => {
    test('returns empty string for empty HTML', async () => {
      const result = await highlightHtmlBlocks('', mockHighlight);
      expect(result).toBe('');
    });

    test('returns HTML unchanged when no code blocks', async () => {
      const html = '<div><p>Hello world</p></div>';
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toBe('<div><p>Hello world</p></div>');
    });

    test('highlights single code block without language', async () => {
      const html = '<pre><code>const x = 1;</code></pre>';
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toContain('CONST X = 1;');
      expect(result).toContain('<pre');
      expect(result).toContain('<code');
    });

    test('highlights single code block with language', async () => {
      const html = '<pre><code class="language-javascript">const x = 1;</code></pre>';
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toContain('CONST X = 1;');
      expect(result).toContain('class="language-javascript"');
    });

    test('highlights multiple code blocks', async () => {
      const html = `
      <pre><code class="language-js">let a = 1;</code></pre>
      <p>Some text</p>
      <pre><code class="language-ts">let b: number = 2;</code></pre>
    `;
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toContain('LET A = 1;');
      expect(result).toContain('LET B: NUMBER = 2;');
      expect(result).toContain('Some text');
    });

    test('handles nested HTML structure', async () => {
      const html = `
      <div>
        <section>
          <pre><code>hello</code></pre>
        </section>
      </div>
    `;
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toContain('HELLO');
      expect(result).toContain('<div>');
      expect(result).toContain('<section>');
    });

    test('skips pre tags without code children', async () => {
      const html = '<pre>Just text, no code tag</pre>';
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toBe('<pre>Just text, no code tag</pre>');
    });

    test('skips code blocks with no text content', async () => {
      const html = '<pre><code></code></pre>';
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toContain('<pre>');
      expect(result).toContain('<code>');
    });

    test('extracts language from multiple classes', async () => {
      const html = '<pre><code class="foo language-python bar">print("hi")</code></pre>';
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toContain('PRINT("HI")');
      expect(result).toContain('class="language-python"');
    });

    test('trims trailing whitespace from code text', async () => {
      const html = '<pre><code>hello   \n\n</code></pre>';
      const result = await highlightHtmlBlocks(html, mockHighlight);
      expect(result).toContain('HELLO');
    });
  });

  describe('rewriteAstroSetHtml', () => {
    test('returns unchanged when no Fragment marker found', async () => {
      const code = `const x = 1;\nconst y = 2;`;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toBe(code);
    });

    test('returns unchanged when marker found but no closing', async () => {
      const code = `<_Fragment set:html={"<div>hello</div>`;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toBe(code);
    });

    test('returns unchanged when literal is empty', async () => {
      const code = `<_Fragment set:html={} />`;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toBe(code);
    });

    test('returns unchanged when JSON is invalid', async () => {
      const code = `<_Fragment set:html={not valid json} />`;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toBe(code);
    });

    test('highlights code blocks in Fragment', async () => {
      const code = `<_Fragment set:html={"<pre><code>const x = 1;</code></pre>"} />`;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toContain('CONST X = 1;');
      expect(result).toContain('<_Fragment set:html={');
      expect(result).toContain('} />');
    });

    test('highlights multiple code blocks in Fragment', async () => {
      const html =
        '<pre><code class="language-js">let a;</code></pre><pre><code class="language-ts">let b;</code></pre>';
      const code = `<_Fragment set:html={${JSON.stringify(html)}} />`;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toContain('LET A;');
      expect(result).toContain('LET B;');
    });

    test('preserves surrounding code', async () => {
      const code = `
      import { Fragment } from 'astro';

      <div>
        <_Fragment set:html={"<pre><code>hello</code></pre>"} />
      </div>
    `;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toContain("import { Fragment }");
      expect(result).toContain('<div>');
      expect(result).toContain('HELLO');
      expect(result).toContain('</div>');
    });

    test('handles HTML with no code blocks', async () => {
      const code = `<_Fragment set:html={"<div><p>No code here</p></div>"} />`;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toContain('<_Fragment set:html={');
      expect(result).toContain('No code here');
    });

    test('handles escaped quotes in JSON', async () => {
      const html = '<pre><code>const str = \\"hello\\";</code></pre>';
      const code = `<_Fragment set:html={${JSON.stringify(html)}} />`;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toContain('CONST STR');
    });

    test('processes ALL Fragment occurrences', async () => {
      const code = `
      <_Fragment set:html={"<pre><code>first</code></pre>"} />
      <_Fragment set:html={"<pre><code>second</code></pre>"} />
    `;
      const result = await rewriteAstroSetHtml(code, mockHighlight);
      expect(result).toContain('FIRST');
      expect(result).toContain('SECOND');
    });
  });

  describe('highlightJsxCodeBlocks', () => {
    test('returns unchanged when no pre tags', async () => {
      const code = `<div>Hello world</div>`;
      const result = await highlightJsxCodeBlocks(code, mockHighlight);
      expect(result).toBe(code);
    });

    test('returns unchanged for empty code', async () => {
      const result = await highlightJsxCodeBlocks('', mockHighlight);
      expect(result).toBe('');
    });

    test('highlights JSX code block without language', async () => {
      const code = `<pre><code>const x = 1;</code></pre>`;
      const result = await highlightJsxCodeBlocks(code, mockHighlight);
      expect(result).toContain('CONST X = 1;');
    });

    test('highlights JSX code block with language', async () => {
      const code = `<pre><code class="language-js">let a = 1;</code></pre>`;
      const result = await highlightJsxCodeBlocks(code, mockHighlight);
      expect(result).toContain('set:html=');
      expect(result).toContain('LET A = 1;');
      expect(result).toContain('language-js');
    });

    test('decodes JSX string expressions', async () => {
      const code = `<pre><code class="language-js">{"const x = 1;"}</code></pre>`;
      const result = await highlightJsxCodeBlocks(code, mockHighlight);
      expect(result).toContain('CONST X = 1;');
    });

    test('decodes JSX expressions with newlines', async () => {
      const code = `<pre><code class="language-js">{"line1"}{"\\n"}{"line2"}</code></pre>`;
      const result = await highlightJsxCodeBlocks(code, mockHighlight);
      expect(result).toContain('set:html=');
      expect(result).toContain('LINE1');
      expect(result).toContain('LINE2');
    });

    test('preserves surrounding JSX', async () => {
      const code = `
      <div>
        <h1>Title</h1>
        <pre><code>hello</code></pre>
      </div>
    `;
      const result = await highlightJsxCodeBlocks(code, mockHighlight);
      expect(result).toContain('<div>');
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('HELLO');
    });

    test('processes multiple JSX code blocks', async () => {
      const code = `
      <pre><code>first</code></pre>
      <pre><code>second</code></pre>
    `;
      const result = await highlightJsxCodeBlocks(code, mockHighlight);
      expect(result).toContain('FIRST');
      expect(result).toContain('SECOND');
    });
  });

  describe('highlightJsStringCodeBlocks', () => {
    test('returns unchanged when no string literals contain <pre>', async () => {
      const code = `const x = "hello";`;
      const result = await highlightJsStringCodeBlocks(code, mockHighlight);
      expect(result).toBe(code);
    });

    test('highlights code blocks in JS string literals', async () => {
      const code = '"<pre><code>const x = 1;</code></pre>"';
      const result = await highlightJsStringCodeBlocks(code, mockHighlight);
      expect(result).toContain('set:html');
      expect(result).toContain('CONST X = 1;');
    });

    test('highlights language-specific code blocks in JS string literals', async () => {
      const code = '"<pre><code class=\\"language-js\\">let a = 1;</code></pre>"';
      const result = await highlightJsStringCodeBlocks(code, mockHighlight);
      expect(result).toContain('LET A = 1;');
      expect(result).toContain('language-js');
    });

    test('preserves surrounding code when rewriting string literals', async () => {
      const code = `
      const before = 1;
      const html = "<pre><code>hello</code></pre>";
      const after = 2;
    `;
      const result = await highlightJsStringCodeBlocks(code, mockHighlight);
      expect(result).toContain('const before = 1;');
      expect(result).toContain('const after = 2;');
      expect(result).toContain('HELLO');
    });

    test('processes multiple JS string code blocks', async () => {
      const code = `
      const first = "<pre><code>first</code></pre>";
      const second = "<pre><code>second</code></pre>";
    `;
      const result = await highlightJsStringCodeBlocks(code, mockHighlight);
      expect(result).toContain('FIRST');
      expect(result).toContain('SECOND');
    });
  });
}
