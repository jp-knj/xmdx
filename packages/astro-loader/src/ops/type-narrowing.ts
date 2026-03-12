// Centralized type narrowing — the ONLY file allowed to use `as`.

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

export function asType<T>(value: unknown): T {
  return value as T;
}
