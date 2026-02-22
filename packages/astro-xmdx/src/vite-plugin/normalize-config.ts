/**
 * Configuration normalization utilities for Xmdx Vite plugin
 * @module vite-plugin/normalize-config
 */

/**
 * Normalized starlightComponents configuration.
 * Strips the `enabled` property which is only used for initial boolean check.
 */
type NormalizedStarlightComponents = boolean | { components?: string[]; module?: string };

// PERF: Cache normalized results to avoid redundant object creation
// Key: original value reference, Value: normalized result
const normalizedCache = new WeakMap<object, NormalizedStarlightComponents>();
let lastBooleanInput: boolean | undefined;
let lastBooleanResult: NormalizedStarlightComponents | undefined;

/**
 * Normalizes starlightComponents configuration from plugin options.
 * Converts `{ enabled?: boolean; components?: string[]; module?: string }` to `boolean | { components?; module? }`.
 *
 * PERF: Caches results for repeated calls with same input (common in buildStart + load hooks).
 *
 * @param value - The raw starlightComponents option value
 * @returns Normalized configuration suitable for TransformContext
 */
export function normalizeStarlightComponents(
  value: boolean | { enabled?: boolean; components?: string[]; module?: string }
): NormalizedStarlightComponents {
  if (typeof value === 'object' && value !== null) {
    // Check cache first
    const cached = normalizedCache.get(value);
    if (cached !== undefined) {
      return cached;
    }

    let result: NormalizedStarlightComponents;
    if (value.enabled === false) {
      result = false;
    } else {
      result = { components: value.components, module: value.module };
    }

    normalizedCache.set(value, result);
    return result;
  }

  // Cache boolean results too
  const boolResult = Boolean(value);
  if (value === lastBooleanInput && lastBooleanResult !== undefined) {
    return lastBooleanResult;
  }
  lastBooleanInput = value;
  lastBooleanResult = boolResult;
  return boolResult;
}
