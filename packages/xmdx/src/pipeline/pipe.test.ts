import { describe, it, expect } from 'bun:test';
import { pipe, when, tap } from './pipe.js';

describe('pipe', () => {
  it('should compose sync functions', async () => {
    const add1 = (x: number): number => x + 1;
    const mult2 = (x: number): number => x * 2;
    const sub3 = (x: number): number => x - 3;

    const pipeline = pipe(add1, mult2, sub3);
    const result = await pipeline(5);

    // (5 + 1) * 2 - 3 = 9
    expect(result).toBe(9);
  });

  it('should compose async functions', async () => {
    const asyncAdd = async (x: number): Promise<number> => x + 1;
    const asyncMult = async (x: number): Promise<number> => x * 2;

    const pipeline = pipe(asyncAdd, asyncMult);
    const result = await pipeline(5);

    // (5 + 1) * 2 = 12
    expect(result).toBe(12);
  });

  it('should handle mixed sync and async functions', async () => {
    const syncFn = (x: number): number => x + 1;
    const asyncFn = async (x: number): Promise<number> => x * 2;

    const pipeline = pipe(syncFn, asyncFn, syncFn);
    const result = await pipeline(5);

    // ((5 + 1) * 2) + 1 = 13
    expect(result).toBe(13);
  });

  it('should pass data through empty pipeline', async () => {
    const pipeline = pipe<number>();
    const result = await pipeline(42);

    expect(result).toBe(42);
  });

  it('should work with object transformations', async () => {
    interface Data {
      initial?: string;
      added?: boolean;
      count?: number;
    }
    const addField = (obj: Data): Data => ({ ...obj, added: true });
    const incrementCount = (obj: Data): Data => ({ ...obj, count: (obj.count || 0) + 1 });

    const pipeline = pipe(addField, incrementCount);
    const result = await pipeline({ initial: 'data' });

    expect(result).toEqual({
      initial: 'data',
      added: true,
      count: 1,
    });
  });
});

describe('when', () => {
  it('should execute transform when condition is true', async () => {
    const transform = when(true, (x: number) => x * 2);
    const result = await transform(5);

    expect(result).toBe(10);
  });

  it('should skip transform when condition is false', async () => {
    const transform = when(false, (x: number) => x * 2);
    const result = await transform(5);

    expect(result).toBe(5);
  });

  it('should evaluate dynamic condition with function', async () => {
    const transform = when((x: number) => x > 10, (x: number) => x * 2);

    const result1 = await transform(5);
    expect(result1).toBe(5); // Condition false, unchanged

    const result2 = await transform(15);
    expect(result2).toBe(30); // Condition true, transformed
  });

  it('should work with async transforms', async () => {
    const asyncTransform = when(true, async (x: number) => {
      return x + 10;
    });

    const result = await asyncTransform(5);
    expect(result).toBe(15);
  });

  it('should work in pipeline composition', async () => {
    const pipeline = pipe(
      (x: number) => x + 1,
      when(false, (x: number) => x * 100), // Skipped
      when(true, (x: number) => x * 2),    // Applied
      (x: number) => x - 3
    );

    const result = await pipeline(5);
    // (5 + 1) * 2 - 3 = 9
    expect(result).toBe(9);
  });

  it('should handle condition function with object data', async () => {
    interface Data {
      enabled: boolean;
      processed?: boolean;
    }
    const transform = when<Data>(
      (data) => data.enabled === true,
      (data) => ({ ...data, processed: true })
    );

    const result1 = await transform({ enabled: false });
    expect(result1).toEqual({ enabled: false });

    const result2 = await transform({ enabled: true });
    expect(result2).toEqual({ enabled: true, processed: true });
  });
});

describe('tap', () => {
  it('should execute side effect without modifying data', async () => {
    let sideEffectValue = 0;
    const transform = tap((x: number) => {
      sideEffectValue = x * 2;
    });

    const result = await transform(5);

    expect(result).toBe(5); // Data unchanged
    expect(sideEffectValue).toBe(10); // Side effect executed
  });

  it('should work with async side effects', async () => {
    const collected: number[] = [];
    const transform = tap(async (x: number) => {
      collected.push(x);
    });

    await transform(10);
    await transform(20);

    expect(collected).toEqual([10, 20]);
  });

  it('should work in pipeline composition', async () => {
    const log: string[] = [];
    const pipeline = pipe(
      (x: number) => x + 1,
      tap((x: number) => log.push(`after add: ${x}`)),
      (x: number) => x * 2,
      tap((x: number) => log.push(`after mult: ${x}`)),
      (x: number) => x - 3
    );

    const result = await pipeline(5);

    expect(result).toBe(9); // (5 + 1) * 2 - 3 = 9
    expect(log).toEqual([
      'after add: 6',
      'after mult: 12',
    ]);
  });

  it('should not affect data flow even if side effect does nothing', async () => {
    const transform = tap(() => {
      // Side effect that doesn't throw
    });

    const result = await transform({ data: 'test' });
    expect(result).toEqual({ data: 'test' });
  });

  it('should handle object mutations in side effect', async () => {
    const metadata: { callCount: number; lastValue?: number } = { callCount: 0 };
    const transform = tap((data: number) => {
      metadata.callCount++;
      metadata.lastValue = data;
    });

    await transform(10);
    await transform(20);

    expect(metadata.callCount).toBe(2);
    expect(metadata.lastValue).toBe(20);
  });
});

describe('integration', () => {
  it('should combine pipe, when, and tap', async () => {
    const log: string[] = [];
    const pipeline = pipe(
      (x: number) => x + 1,
      tap((x: number) => log.push(`step1: ${x}`)),
      when((x: number) => x % 2 === 0, (x: number) => x * 10), // Only for even numbers
      tap((x: number) => log.push(`step2: ${x}`)),
      (x: number) => x + 5
    );

    const result1 = await pipeline(5);
    // (5 + 1 = 6) * 10 + 5 = 65
    expect(result1).toBe(65);
    expect(log).toEqual(['step1: 6', 'step2: 60']);

    log.length = 0; // Clear log

    const result2 = await pipeline(4);
    // (4 + 1 = 5) + 5 = 10 (when condition false, no mult)
    expect(result2).toBe(10);
    expect(log).toEqual(['step1: 5', 'step2: 5']);
  });

  it('should work with complex data transformations', async () => {
    interface Data {
      enabled: boolean;
      value: number;
      step?: number;
      processed?: boolean;
      logs?: string[];
    }
    const pipeline = pipe<Data>(
      (data) => ({ ...data, step: 1 }),
      tap((data) => { data.logs = ['start']; }),
      when(
        (data) => data.enabled,
        (data) => ({ ...data, processed: true, step: 2 })
      ),
      (data) => ({ ...data, step: (data.step ?? 0) + 1 })
    );

    const result = await pipeline({ enabled: true, value: 42 });

    expect(result).toEqual({
      enabled: true,
      value: 42,
      step: 3,
      processed: true,
      logs: ['start'],
    });
  });
});
