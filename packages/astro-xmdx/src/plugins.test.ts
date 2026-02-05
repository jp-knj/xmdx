/**
 * @file Tests for plugin system functionality
 */

import { describe, expect, test } from 'bun:test';
import { pipe, when } from './pipeline/pipe.js';
import type { TransformContext, TransformConfig } from './types.js';

interface TestContext {
  code: string;
  config?: { enabled: boolean };
  source?: string;
  filename?: string;
  frontmatter?: Record<string, unknown>;
  headings?: Array<{ text: string; depth: number }>;
}

interface PluginLike {
  name: string;
  enforce?: 'pre' | 'post';
  afterParse?: (ctx: TestContext) => TestContext;
  beforeOutput?: (ctx: TestContext) => TestContext;
}

/**
 * Since collectHooks is not exported from index.js, we test the plugin behavior
 * through the pipeline composition patterns that the plugin system uses.
 */

describe('plugin hook patterns', () => {
  describe('hook collection and ordering', () => {
    test('hooks execute in order', async () => {
      const order: string[] = [];

      const hooks = [
        (ctx: TestContext) => {
          order.push('first');
          return ctx;
        },
        (ctx: TestContext) => {
          order.push('second');
          return ctx;
        },
        (ctx: TestContext) => {
          order.push('third');
          return ctx;
        },
      ];

      const pipeline = pipe(...hooks);
      await pipeline({ code: 'test' });

      expect(order).toEqual(['first', 'second', 'third']);
    });

    test('async hooks execute in sequence', async () => {
      const order: string[] = [];

      const hooks = [
        async (ctx: TestContext) => {
          await new Promise((r) => setTimeout(r, 10));
          order.push('first');
          return ctx;
        },
        async (ctx: TestContext) => {
          await new Promise((r) => setTimeout(r, 5));
          order.push('second');
          return ctx;
        },
        (ctx: TestContext) => {
          order.push('third');
          return ctx;
        },
      ];

      const pipeline = pipe(...hooks);
      await pipeline({ code: 'test' });

      expect(order).toEqual(['first', 'second', 'third']);
    });

    test('hooks can modify context', async () => {
      const hooks = [
        (ctx: TestContext) => ({ ...ctx, code: ctx.code + ' modified1' }),
        (ctx: TestContext) => ({ ...ctx, code: ctx.code + ' modified2' }),
      ];

      const pipeline = pipe(...hooks);
      const result = await pipeline({ code: 'original' });

      expect(result.code).toBe('original modified1 modified2');
    });
  });

  describe('preprocess hook pattern', () => {
    test('preprocess transforms source before parsing', () => {
      const preprocessors = [
        (source: string, _filename: string) => source.replace(/WARNING/g, 'CAUTION'),
        (source: string, _filename: string) => source.replace(/NOTE/g, 'TIP'),
      ];

      let source = 'This is a WARNING and a NOTE';
      for (const preprocess of preprocessors) {
        source = preprocess(source, '/test.md');
      }

      expect(source).toBe('This is a CAUTION and a TIP');
    });

    test('preprocess receives filename', () => {
      const receivedFilenames: string[] = [];
      const preprocessors = [
        (source: string, filename: string) => {
          receivedFilenames.push(filename);
          return source;
        },
      ];

      let source = 'test';
      for (const preprocess of preprocessors) {
        source = preprocess(source, '/path/to/file.md');
      }

      expect(receivedFilenames).toEqual(['/path/to/file.md']);
    });
  });

  describe('conditional transforms with hooks', () => {
    test('hooks can be combined with when()', async () => {
      const userHook = (ctx: TestContext) => ({ ...ctx, code: ctx.code + ' [user]' });
      const conditionalTransform = when<TestContext>(
        (ctx) => ctx.config?.enabled ?? false,
        (ctx) => ({ ...ctx, code: ctx.code + ' [built-in]' })
      );

      const pipeline = pipe(userHook, conditionalTransform);

      const result1 = await pipeline({
        code: 'start',
        config: { enabled: true },
      });
      expect(result1.code).toBe('start [user] [built-in]');

      const result2 = await pipeline({
        code: 'start',
        config: { enabled: false },
      });
      expect(result2.code).toBe('start [user]');
    });
  });

  describe('plugin enforce ordering simulation', () => {
    test('pre plugins run before normal plugins', async () => {
      const plugins: PluginLike[] = [
        { name: 'normal1', enforce: undefined, afterParse: (ctx) => ({ ...ctx, code: ctx.code + ' normal1' }) },
        { name: 'pre1', enforce: 'pre', afterParse: (ctx) => ({ ...ctx, code: ctx.code + ' pre1' }) },
        { name: 'post1', enforce: 'post', afterParse: (ctx) => ({ ...ctx, code: ctx.code + ' post1' }) },
        { name: 'pre2', enforce: 'pre', afterParse: (ctx) => ({ ...ctx, code: ctx.code + ' pre2' }) },
      ];

      // Simulate collectHooks sorting
      const sorted = [...plugins].sort((a, b) => {
        const order: Record<string, number> = { pre: 0, undefined: 1, post: 2 };
        const aOrder = order[String(a.enforce)] ?? 1;
        const bOrder = order[String(b.enforce)] ?? 1;
        return aOrder - bOrder;
      });

      const hooks = sorted.filter((p) => p.afterParse).map((p) => p.afterParse!);
      const pipeline = pipe(...hooks);
      const result = await pipeline({ code: 'start' });

      // pre plugins first, then normal, then post
      expect(result.code).toBe('start pre1 pre2 normal1 post1');
    });
  });

  describe('realistic plugin examples', () => {
    test('custom directive replacement plugin', async () => {
      const customDirectivePlugin = {
        name: 'custom-directive',
        afterParse(ctx: TestContext) {
          const newCode = ctx.code
            .replace(/<Warning>/g, '<Aside type="caution">')
            .replace(/<\/Warning>/g, '</Aside>');
          return { ...ctx, code: newCode };
        },
      };

      const hooks = [customDirectivePlugin.afterParse];
      const pipeline = pipe(...hooks);
      const result = await pipeline({
        code: '<Warning>Be careful!</Warning>',
      });

      expect(result.code).toBe('<Aside type="caution">Be careful!</Aside>');
    });

    test('analytics plugin that doesn\'t modify code', async () => {
      const processedFiles: string[] = [];
      const analyticsPlugin = {
        name: 'analytics',
        beforeOutput(ctx: TestContext) {
          if (ctx.filename) {
            processedFiles.push(ctx.filename);
          }
          return ctx; // Return unchanged
        },
      };

      const hooks = [analyticsPlugin.beforeOutput];
      const pipeline = pipe(...hooks);
      const result = await pipeline({
        code: 'original code',
        filename: '/path/to/file.md',
      });

      expect(result.code).toBe('original code');
      expect(processedFiles).toEqual(['/path/to/file.md']);
    });

    test('code wrapper plugin', async () => {
      const wrapperPlugin = {
        name: 'wrapper',
        beforeOutput(ctx: TestContext) {
          const wrapped = `/* Generated by Xmdx */\n${ctx.code}`;
          return { ...ctx, code: wrapped };
        },
      };

      const hooks = [wrapperPlugin.beforeOutput];
      const pipeline = pipe(...hooks);
      const result = await pipeline({ code: 'export default function() {}' });

      expect(result.code).toContain('/* Generated by Xmdx */');
      expect(result.code).toContain('export default function() {}');
    });
  });
});

describe('TransformContext structure', () => {
  test('context contains all required properties', async () => {
    let receivedCtx: TransformContext | null = null;

    const inspectorHook = (ctx: TransformContext) => {
      receivedCtx = ctx;
      return ctx;
    };

    const pipeline = pipe(inspectorHook);
    await pipeline({
      code: '<div>Hello</div>',
      source: '# Hello',
      filename: '/test.md',
      frontmatter: { title: 'Test' },
      headings: [{ text: 'Hello', depth: 1, slug: 'hello' }],
      config: {
        expressiveCode: null,
        starlightComponents: true,
        shiki: null,
      },
    });

    expect(receivedCtx).toHaveProperty('code');
    expect(receivedCtx).toHaveProperty('source');
    expect(receivedCtx).toHaveProperty('filename');
    expect(receivedCtx).toHaveProperty('frontmatter');
    expect(receivedCtx).toHaveProperty('headings');
    expect(receivedCtx).toHaveProperty('config');
    expect(receivedCtx!.config).toHaveProperty('expressiveCode');
    expect(receivedCtx!.config).toHaveProperty('starlightComponents');
    expect(receivedCtx!.config).toHaveProperty('shiki');
  });
});
