import { describe, expect, test, beforeAll } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const exampleDir = resolve(import.meta.dirname, '../../../../examples/starlight');
const distDir = join(exampleDir, 'dist');

function readPage(pagePath: string): string {
  const filePath = pagePath === ''
    ? join(distDir, 'index.html')
    : join(distDir, pagePath, 'index.html');
  return readFileSync(filePath, 'utf-8');
}

function readCssFiles(): string[] {
  const astroDir = join(distDir, '_astro');
  if (!existsSync(astroDir)) return [];
  return readdirSync(astroDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(astroDir, f), 'utf-8'));
}

describe.skipIf(!existsSync(exampleDir))('Starlight build integration', () => {
  beforeAll(() => {
    if (!existsSync(join(distDir, 'index.html'))) {
      execSync('pnpm build', { cwd: exampleDir, stdio: 'pipe', timeout: 120_000 });
    }
  });

  describe('build output structure', () => {
    test('all expected pages exist', () => {
      const expectedPages = [
        'index.html',
        'guides/components/index.html',
        'guides/code-examples/index.html',
        'guides/configuration/index.html',
        'guides/getting-started/index.html',
        'guides/mdx-features/index.html',
      ];
      for (const page of expectedPages) {
        expect(existsSync(join(distDir, page))).toBe(true);
      }
    });
  });

  describe('components page', () => {
    let html: string;
    beforeAll(() => {
      html = readPage('guides/components');
    });

    test('renders Aside variants', () => {
      expect(html).toContain('starlight-aside--note');
      expect(html).toContain('starlight-aside--tip');
      expect(html).toContain('starlight-aside--caution');
      expect(html).toContain('starlight-aside--danger');
    });

    test('renders Aside with custom title', () => {
      expect(html).toContain('aria-label="Custom Title"');
    });

    test('renders Badge component', () => {
      expect(html).toContain('class="sl-badge');
    });

    test('renders Card and CardGrid', () => {
      expect(html).toContain('card sl-flex');
      expect(html).toContain('card-grid');
    });

    test('renders LinkCard', () => {
      expect(html).toContain('sl-link-card');
    });

    test('renders FileTree', () => {
      expect(html).toContain('<starlight-file-tree');
    });

    test('renders Steps', () => {
      expect(html).toContain('sl-steps');
    });

    test('renders Tabs', () => {
      expect(html).toContain('<starlight-tabs');
      expect(html).toContain('role="tablist"');
    });
  });

  describe('code examples page', () => {
    let html: string;
    beforeAll(() => {
      html = readPage('guides/code-examples');
    });

    test('renders ExpressiveCode containers', () => {
      const count = html.split('class="expressive-code"').length - 1;
      expect(count).toBeGreaterThanOrEqual(10);
    });

    test('renders syntax-highlighted spans with EC CSS variables', () => {
      expect(html).toMatch(/style="--0:/);
    });
  });

  describe('MDX features page', () => {
    let html: string;
    beforeAll(() => {
      html = readPage('guides/mdx-features');
    });

    test('renders JSX expressions (exported const version)', () => {
      expect(html).toContain('2.1.0');
    });

    test('renders dynamic CardGrid', () => {
      const count = html.split('card sl-flex').length - 1;
      expect(count).toBeGreaterThanOrEqual(2);
    });

    test('renders conditional Aside', () => {
      expect(html).toContain('starlight-aside--tip');
      expect(html).toContain('aria-label="Stable Release"');
    });
  });

  describe('cross-cutting concerns', () => {
    test('no leaked raw import statements in rendered content', () => {
      const pages = [
        'guides/components',
        'guides/code-examples',
        'guides/configuration',
        'guides/getting-started',
        'guides/mdx-features',
      ];
      for (const page of pages) {
        const html = readPage(page);
        // Strip all <pre>...</pre>, <code>...</code>, and <script>...</script>
        // blocks since those legitimately contain import syntax
        const contentOnly = html
          .replace(/<pre[\s>][\s\S]*?<\/pre>/gi, '')
          .replace(/<code[\s>][\s\S]*?<\/code>/gi, '')
          .replace(/<script[\s>][\s\S]*?<\/script>/gi, '');
        expect(contentOnly).not.toMatch(/\bimport\s*\{[^}]+\}\s*from\s*['"]/);
      }
    });

    test('CSS output includes @layer declarations', () => {
      const cssFiles = readCssFiles();
      const combined = cssFiles.join('\n');
      expect(combined).toContain('@layer');
    });
  });
});
