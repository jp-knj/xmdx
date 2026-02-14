import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { countHtmlFiles, findHtmlFiles } from './utils.js';

const E2E_ROOT = join(import.meta.dir, '..');
const DOCS_DIST = join(E2E_ROOT, 'withastro-docs/dist');

const docsBuilt = existsSync(DOCS_DIST);

describe.skipIf(!docsBuilt)('withastro/docs build output', () => {
  test('dist/ contains 100+ HTML files', () => {
    const count = countHtmlFiles(DOCS_DIST);
    expect(count).toBeGreaterThanOrEqual(100);
  });

  test('HTML files contain <h1> headings', () => {
    const files = findHtmlFiles(DOCS_DIST, 30);
    let h1Count = 0;
    for (const f of files) {
      const html = readFileSync(f, 'utf-8');
      if (html.includes('<h1')) h1Count++;
    }
    // At least half of sampled pages should have an h1
    expect(h1Count).toBeGreaterThanOrEqual(Math.floor(files.length / 2));
  });

  test('en/getting-started page exists', () => {
    // Structural check: the getting-started guide should be present
    const candidates = [
      join(DOCS_DIST, 'en/getting-started/index.html'),
      join(DOCS_DIST, 'en/getting-started.html'),
    ];
    const found = candidates.some((c) => existsSync(c));
    expect(found).toBe(true);
  });

  test('HTML files are not empty', () => {
    const files = findHtmlFiles(DOCS_DIST, 10);
    for (const f of files) {
      const html = readFileSync(f, 'utf-8');
      expect(html.length).toBeGreaterThan(100);
    }
  });
});
