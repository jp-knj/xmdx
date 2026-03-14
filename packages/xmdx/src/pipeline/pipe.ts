/**
 * Functional pipeline utilities for composing transformations
 * @module pipeline/pipe
 */

/**
 * Compose functions into a pipeline that passes data through each step.
 * Supports both sync and async functions.
 *
 * @example
 * const transform = pipe(
 *   (data) => step1(data),
 *   async (data) => await step2(data),
 *   (data) => step3(data)
 * );
 * const result = await transform(input);
 */
export function pipe<T>(...fns: Array<(input: T) => T | Promise<T>>): (input: T) => Promise<T> {
  return async (input: T): Promise<T> => {
    let result = input;
    for (const fn of fns) {
      result = await fn(result);
    }
    return result;
  };
}

/**
 * Create a conditional pipeline step.
 * Only executes transform if condition is met.
 *
 * @example
 * const pipeline = pipe(
 *   when(config.enableShiki, (data) => highlightCode(data)),
 *   when((data) => data.hasComponents, (data) => injectImports(data))
 * );
 */
export function when<T>(
  condition: boolean | ((data: T) => boolean),
  transform: (data: T) => T | Promise<T>
): (data: T) => Promise<T> {
  return async (data: T): Promise<T> => {
    const shouldRun = typeof condition === 'function'
      ? condition(data)
      : condition;

    if (!shouldRun) {
      return data;
    }
    return await transform(data);
  };
}

/**
 * Tap into pipeline for side effects without modifying data.
 * Useful for logging, validation, or triggering watchers.
 *
 * @example
 * const pipeline = pipe(
 *   transform1,
 *   tap((data) => console.log('After transform1:', data)),
 *   transform2
 * );
 */
export function tap<T>(sideEffect: (data: T) => void | Promise<void>): (data: T) => Promise<T> {
  return async (data: T): Promise<T> => {
    await sideEffect(data);
    return data;
  };
}
