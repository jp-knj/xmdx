import { describe, it, expect } from 'bun:test';
import { createPipeline, createCustomPipeline, createContext } from './orchestrator.js';
import type { TransformContext } from './types.js';

describe('createContext', () => {
  it('should create context with default values', () => {
    const ctx = createContext();

    expect(ctx.code).toBe('');
    expect(ctx.source).toBe('');
    expect(ctx.filename).toBe('');
    expect(ctx.frontmatter).toEqual({});
    expect(ctx.headings).toEqual([]);
    expect(ctx.registry).toBeUndefined();
    expect(ctx.config).toEqual({
      expressiveCode: null,
      starlightComponents: false,
      shiki: null,
    });
  });

  it('should override default values with provided values', () => {
    const ctx = createContext({
      code: '<h1>Hello</h1>',
      source: '# Hello',
      filename: '/path/to/file.md',
      frontmatter: { title: 'Test' },
      headings: [{ depth: 1, text: 'Hello', slug: 'hello' }],
    });

    expect(ctx.code).toBe('<h1>Hello</h1>');
    expect(ctx.source).toBe('# Hello');
    expect(ctx.filename).toBe('/path/to/file.md');
    expect(ctx.frontmatter).toEqual({ title: 'Test' });
    expect(ctx.headings).toEqual([{ depth: 1, text: 'Hello', slug: 'hello' }]);
  });

  it('should merge config with defaults', () => {
    const ctx = createContext({
      config: {
        expressiveCode: { component: 'Code', moduleId: 'test' },
        starlightComponents: false,
        shiki: null,
      },
    });

    expect(ctx.config.expressiveCode).toEqual({ component: 'Code', moduleId: 'test' });
    expect(ctx.config.starlightComponents).toBe(false);
    expect(ctx.config.shiki).toBeNull();
  });

  it('should preserve registry when provided', () => {
    const mockRegistry = { lookup: () => null } as unknown as TransformContext['registry'];
    const ctx = createContext({ registry: mockRegistry });

    expect(ctx.registry).toBe(mockRegistry);
  });
});

describe('createPipeline', () => {
  it('should create pipeline with empty hooks', async () => {
    const pipeline = createPipeline();
    const ctx = createContext({
      code: '<p>test</p>',
      source: 'test',
      filename: 'test.md',
    });

    const result = await pipeline(ctx);

    // Pipeline should return context (transforms may or may not modify it)
    expect(result).toBeDefined();
    expect(result.code).toBeDefined();
  });

  it('should execute afterParse hooks first', async () => {
    const order: string[] = [];
    const afterParseHook = (ctx: TransformContext): TransformContext => {
      order.push('afterParse');
      return { ...ctx, code: ctx.code + ':afterParse' };
    };

    const pipeline = createPipeline({
      afterParse: [afterParseHook],
    });

    const ctx = createContext({ code: 'start' });
    const result = await pipeline(ctx);

    expect(order).toEqual(['afterParse']);
    expect(result.code).toContain('afterParse');
  });

  it('should execute hooks in correct order', async () => {
    const order: string[] = [];

    const afterParseHook = (ctx: TransformContext): TransformContext => {
      order.push('afterParse');
      return ctx;
    };

    const beforeInjectHook = (ctx: TransformContext): TransformContext => {
      order.push('beforeInject');
      return ctx;
    };

    const beforeOutputHook = (ctx: TransformContext): TransformContext => {
      order.push('beforeOutput');
      return ctx;
    };

    const pipeline = createPipeline({
      afterParse: [afterParseHook],
      beforeInject: [beforeInjectHook],
      beforeOutput: [beforeOutputHook],
    });

    const ctx = createContext({ code: 'test' });
    await pipeline(ctx);

    // Verify hook order: afterParse -> (built-in transforms) -> beforeInject -> (built-in transforms) -> beforeOutput
    expect(order.indexOf('afterParse')).toBeLessThan(order.indexOf('beforeInject'));
    expect(order.indexOf('beforeInject')).toBeLessThan(order.indexOf('beforeOutput'));
  });

  it('should handle multiple hooks per phase', async () => {
    const order: string[] = [];

    const pipeline = createPipeline({
      afterParse: [
        (ctx: TransformContext) => { order.push('afterParse1'); return ctx; },
        (ctx: TransformContext) => { order.push('afterParse2'); return ctx; },
      ],
      beforeOutput: [
        (ctx: TransformContext) => { order.push('beforeOutput1'); return ctx; },
        (ctx: TransformContext) => { order.push('beforeOutput2'); return ctx; },
      ],
    });

    const ctx = createContext({ code: 'test' });
    await pipeline(ctx);

    // Hooks should run in order within each phase
    expect(order.indexOf('afterParse1')).toBeLessThan(order.indexOf('afterParse2'));
    expect(order.indexOf('beforeOutput1')).toBeLessThan(order.indexOf('beforeOutput2'));
  });

  it('should handle async hooks', async () => {
    const asyncHook = async (ctx: TransformContext): Promise<TransformContext> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ...ctx, code: ctx.code + ':async' };
    };

    const pipeline = createPipeline({
      afterParse: [asyncHook],
    });

    const ctx = createContext({ code: 'start' });
    const result = await pipeline(ctx);

    expect(result.code).toContain('async');
  });

  it('should pass context through all transforms', async () => {
    const addMetadata = (ctx: TransformContext): TransformContext => ({
      ...ctx,
      frontmatter: { ...ctx.frontmatter, transformed: true },
    });

    const pipeline = createPipeline({
      afterParse: [addMetadata],
    });

    const ctx = createContext({
      code: 'test',
      frontmatter: { title: 'Original' },
    });
    const result = await pipeline(ctx);

    expect(result.frontmatter.title).toBe('Original');
    expect(result.frontmatter.transformed).toBe(true);
  });
});

describe('createCustomPipeline', () => {
  it('should create pipeline with only specified transforms', async () => {
    const transform1 = (ctx: TransformContext): TransformContext => ({ ...ctx, code: ctx.code + ':t1' });
    const transform2 = (ctx: TransformContext): TransformContext => ({ ...ctx, code: ctx.code + ':t2' });

    const pipeline = createCustomPipeline(transform1, transform2);
    const ctx = createContext({ code: 'start' });
    const result = await pipeline(ctx);

    expect(result.code).toBe('start:t1:t2');
  });

  it('should not include any built-in transforms', async () => {
    // Create a custom pipeline with only a simple transform
    const simpleTransform = (ctx: TransformContext): TransformContext & { customOnly: boolean } => ({ ...ctx, customOnly: true });

    const pipeline = createCustomPipeline(simpleTransform);
    const ctx = createContext({ code: '<pre><code>test</code></pre>' });
    const result = await pipeline(ctx);

    // The code should not be modified by built-in transforms
    expect(result.code).toBe('<pre><code>test</code></pre>');
    expect((result as TransformContext & { customOnly?: boolean }).customOnly).toBe(true);
  });

  it('should compose async transforms', async () => {
    const asyncTransform1 = async (ctx: TransformContext): Promise<TransformContext> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ...ctx, code: ctx.code + ':async1' };
    };

    const asyncTransform2 = async (ctx: TransformContext): Promise<TransformContext> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ...ctx, code: ctx.code + ':async2' };
    };

    const pipeline = createCustomPipeline(asyncTransform1, asyncTransform2);
    const ctx = createContext({ code: 'start' });
    const result = await pipeline(ctx);

    expect(result.code).toBe('start:async1:async2');
  });

  it('should work with empty transforms', async () => {
    const pipeline = createCustomPipeline();
    const ctx = createContext({ code: 'unchanged' });
    const result = await pipeline(ctx);

    expect(result.code).toBe('unchanged');
  });
});

describe('standalone usage', () => {
  it('should work without Vite context', async () => {
    // Simulate standalone usage: create context manually and run pipeline
    const ctx = createContext({
      code: `
import { Fragment } from 'astro/jsx-runtime';
export default function Content() {
  return <Fragment><h1>Hello</h1><p>World</p></Fragment>;
}`,
      source: '# Hello\n\nWorld',
      filename: '/standalone/test.md',
      frontmatter: { title: 'Standalone Test' },
      headings: [{ depth: 1, text: 'Hello', slug: 'hello' }],
    });

    const pipeline = createPipeline();
    const result = await pipeline(ctx);

    expect(result.code).toBeDefined();
    expect(result.filename).toBe('/standalone/test.md');
    expect(result.frontmatter.title).toBe('Standalone Test');
  });

  it('should allow custom transforms in standalone mode', async () => {
    const addBanner = (ctx: TransformContext): TransformContext => ({
      ...ctx,
      code: `// Generated by custom pipeline\n${ctx.code}`,
    });

    const pipeline = createCustomPipeline(addBanner);

    const ctx = createContext({
      code: 'export default function() {}',
      source: 'test',
      filename: 'test.md',
    });

    const result = await pipeline(ctx);

    expect(result.code).toStartWith('// Generated by custom pipeline');
  });

  it('should support composing multiple custom pipelines', async () => {
    const pipeline1 = createCustomPipeline(
      (ctx: TransformContext) => ({ ...ctx, code: ctx.code + ':p1' })
    );

    const pipeline2 = createCustomPipeline(
      (ctx: TransformContext) => ({ ...ctx, code: ctx.code + ':p2' })
    );

    // Compose pipelines manually
    const combinedPipeline = async (ctx: TransformContext): Promise<TransformContext> => {
      const intermediate = await pipeline1(ctx);
      return pipeline2(intermediate);
    };

    const ctx = createContext({ code: 'start' });
    const result = await combinedPipeline(ctx);

    expect(result.code).toBe('start:p1:p2');
  });
});

describe('error handling', () => {
  it('should propagate errors from transforms', async () => {
    const failingTransform = (): TransformContext => {
      throw new Error('Transform failed');
    };

    const pipeline = createCustomPipeline(failingTransform);
    const ctx = createContext({ code: 'test' });

    await expect(pipeline(ctx)).rejects.toThrow('Transform failed');
  });

  it('should propagate errors from async transforms', async () => {
    const asyncFailingTransform = async (): Promise<TransformContext> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('Async transform failed');
    };

    const pipeline = createCustomPipeline(asyncFailingTransform);
    const ctx = createContext({ code: 'test' });

    await expect(pipeline(ctx)).rejects.toThrow('Async transform failed');
  });
});
