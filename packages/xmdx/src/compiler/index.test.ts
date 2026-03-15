import { describe, expect, test } from 'bun:test';
import { compileDocument, type CompileTargetAdapter, type SharedBinding, type SharedCompiler } from './index.js';

function createTargetAdapter(): CompileTargetAdapter {
  return {
    wrapMdxModule: ({ code, filename }) => `wrapped:${filename}:${code}`,
    renderBlocksModule: ({ filename, userImports }) => `blocks:${filename}:${userImports.join('|')}`,
  };
}

describe('compileDocument', () => {
  test('returns fallback when problematic MDX patterns are detected', async () => {
    const result = await compileDocument({
      filename: '/tmp/page.mdx',
      source: 'import Foo from "pkg"\n\n# Hello',
      mdxOptions: {
        allowImports: ['./local-only'],
      },
      useMdast: false,
      getCompiler: async () => {
        throw new Error('should not initialize compiler for fallback');
      },
      loadBinding: async () => {
        throw new Error('should not initialize binding for fallback');
      },
      target: createTargetAdapter(),
    });

    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.reason).toContain('import');
    }
  });

  test('compiles mdx through the target wrapper', async () => {
    const compiler: SharedCompiler = {
      compile: () => ({
        code: 'unused',
      }),
      compileMdxBatch: () => ({
        results: [{
          id: '/tmp/page.mdx',
          result: {
            code: 'mdx-code',
            frontmatterJson: '{"title":"Hello"}',
            headings: [{ depth: 1, slug: 'hello', text: 'Hello' }],
          },
        }],
      }),
    };

    const result = await compileDocument({
      filename: '/tmp/page.mdx',
      source: '# Hello',
      useMdast: false,
      getCompiler: async () => compiler,
      loadBinding: async () => {
        throw new Error('binding should not be used for mdx');
      },
      target: createTargetAdapter(),
    });

    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.document.code).toBe('wrapped:/tmp/page.mdx:mdx-code');
      expect(result.document.frontmatter).toEqual({ title: 'Hello' });
      expect(result.document.headings).toHaveLength(1);
    }
  });

  test('compiles markdown through the mdast adapter when enabled', async () => {
    const binding: SharedBinding = {
      parseBlocks: () => ({
        blocks: [{ type: 'html', content: '<p>Hello</p>' }],
        headings: [{ depth: 1, slug: 'hello', text: 'Hello' }],
      }),
      parseFrontmatter: () => ({
        frontmatter: { title: 'Hello' },
      }),
    };

    const result = await compileDocument({
      filename: '/tmp/page.md',
      source: 'import Foo from "./foo"\n\n---\ntitle: Hello\n---\n\n# Hello',
      mdxOptions: {
        allowImports: ['./foo'],
      },
      useMdast: true,
      getCompiler: async () => {
        throw new Error('compiler should not be used for mdast mode');
      },
      loadBinding: async () => binding,
      target: createTargetAdapter(),
    });

    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.document.code).toBe('blocks:/tmp/page.md:import Foo from "./foo"');
      expect(result.document.frontmatter).toEqual({ title: 'Hello' });
      expect(result.document.headings[0]?.slug).toBe('hello');
    }
  });

  test('compiles markdown through the native compiler when mdast mode is disabled', async () => {
    const compiler: SharedCompiler = {
      compile: () => ({
        code: 'native-code',
        frontmatter_json: '{"title":"Native"}',
        headings: [{ depth: 2, slug: 'native', text: 'Native' }],
        imports: [{ path: '/tmp/component.tsx' }],
        diagnostics: {
          warnings: [{ line: 4, message: 'warning' }],
        },
      }),
      compileMdxBatch: () => ({
        results: [],
      }),
    };

    const result = await compileDocument({
      filename: '/tmp/page.md',
      source: '# Native',
      useMdast: false,
      getCompiler: async () => compiler,
      loadBinding: async () => {
        throw new Error('binding should not be used for native mode');
      },
      target: createTargetAdapter(),
    });

    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.document.code).toBe('native-code');
      expect(result.document.frontmatter).toEqual({ title: 'Native' });
      expect(result.document.imports).toEqual([{ path: '/tmp/component.tsx' }]);
      expect(result.document.diagnostics?.warnings?.[0]?.message).toBe('warning');
    }
  });
});
