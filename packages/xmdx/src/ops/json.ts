// Centralized JSON parsing — the ONLY file allowed to use `as` for JSON.parse.

export function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

export function parseJsonRecord(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>;
}

export function parseJsonString(json: string): string {
  return JSON.parse(json) as string;
}
