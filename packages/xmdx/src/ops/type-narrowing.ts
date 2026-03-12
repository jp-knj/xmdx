// Centralized type narrowing — the ONLY file allowed to use `as`.

export function parseJsonRecord(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>;
}

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
 * Cast for dynamic module imports.
 */
export function asModule<T>(value: unknown): T {
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
