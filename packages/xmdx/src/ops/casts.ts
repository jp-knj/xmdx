// Centralized type narrowing — the ONLY file allowed to use `as` for generic casts.
import type { SourceMapInput } from 'rollup';

/**
 * Type guard: checks that value is a non-null object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Returns the `name` string from a value, or `'unknown'` when not present.
 */
export function nameOf(value: unknown): string {
  if (isRecord(value) && typeof value.name === 'string') {
    return value.name;
  }
  return 'unknown';
}

/**
 * Returns the `directive` string from a value, or `'unknown'` when not present.
 */
export function directiveNameOf(value: unknown): string {
  if (isRecord(value) && typeof value.directive === 'string') {
    return value.directive;
  }
  return 'unknown';
}

/**
 * Cast for dynamic `import()` modules.
 */
export function asModule<T>(value: unknown): T {
  return value as T;
}

/**
 * Cast for dynamic `require()` results.
 */
export function asBinding<T>(value: unknown): T {
  return value as T;
}

/**
 * Type-safe cast for validated Record fields.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Extract a method from a record after confirming it is a function.
 */
export function asFunction<T>(value: unknown): T {
  return value as T;
}

export function asSourceMap(map: unknown): SourceMapInput | undefined {
  return map as SourceMapInput | undefined;
}

export function asMutableConfig(config: unknown): Record<string, unknown> {
  return config as Record<string, unknown>;
}

export function asStringArray(value: unknown): unknown[] {
  return value as unknown[];
}

/**
 * Type-safe cast for HastNode children arrays.
 */
export function asHastChildren<T>(children: unknown): T[] | null {
  return Array.isArray(children) ? (children as T[]) : null;
}

/**
 * Cast for shiki language loading (accepts BundledLanguage | SpecialLanguage).
 */
export function asShikiLanguage(lang: string): unknown {
  return lang as unknown;
}

/**
 * Safely extract an optional string from an unknown value.
 */
export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
