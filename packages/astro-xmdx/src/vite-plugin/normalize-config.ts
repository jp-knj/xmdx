/**
 * Configuration normalization utilities for Xmdx Vite plugin
 * @module vite-plugin/normalize-config
 */

/**
 * Normalized starlightComponents configuration.
 * Strips the `enabled` property which is only used for initial boolean check.
 */
export type NormalizedStarlightComponents = boolean | { components?: string[]; module?: string };

/**
 * Normalizes starlightComponents configuration from plugin options.
 * Converts `{ enabled?: boolean; components?: string[]; module?: string }` to `boolean | { components?; module? }`.
 *
 * @param value - The raw starlightComponents option value
 * @returns Normalized configuration suitable for TransformContext
 */
export function normalizeStarlightComponents(
  value: boolean | { enabled?: boolean; components?: string[]; module?: string }
): NormalizedStarlightComponents {
  if (typeof value === 'object' && value !== null) {
    if (value.enabled === false) {
      return false;
    }
    return { components: value.components, module: value.module };
  }
  return Boolean(value);
}
