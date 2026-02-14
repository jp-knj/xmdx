import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export function countHtmlFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(d, entry.name));
      else if (entry.name.endsWith('.html')) count++;
    }
  };
  walk(dir);
  return count;
}

export function findHtmlFiles(dir: string, limit: number): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    if (files.length >= limit) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (files.length >= limit) return;
      if (entry.isDirectory()) walk(join(d, entry.name));
      else if (entry.name.endsWith('.html')) files.push(join(d, entry.name));
    }
  };
  walk(dir);
  return files;
}
