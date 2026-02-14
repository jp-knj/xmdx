import { describe, test, expect, beforeAll } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';
import { countHtmlFiles } from './utils.js';

const XMDX_ROOT = join(import.meta.dir, '../..');

async function buildProject(dir: string): Promise<{ exitCode: number; stderr: string }> {
  const result = await $`cd ${dir} && pnpm build`.quiet().nothrow();
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
  };
}

describe('examples/basic', () => {
  const projectDir = join(XMDX_ROOT, 'examples/basic');
  const distDir = join(projectDir, 'dist');

  beforeAll(async () => {
    await $`rm -rf ${distDir} ${join(projectDir, '.astro')}`.quiet().nothrow();
  });

  test('builds successfully and produces valid output', async () => {
    const { exitCode, stderr } = await buildProject(projectDir);
    if (exitCode !== 0) console.error(stderr);
    expect(exitCode).toBe(0);

    const count = countHtmlFiles(distDir);
    expect(count).toBeGreaterThan(0);

    const indexPath = join(distDir, 'index.html');
    expect(existsSync(indexPath)).toBe(true);
    const html = await Bun.file(indexPath).text();
    expect(html).toContain('<h1');
  }, 120_000);
});

describe('examples/starlight', () => {
  const projectDir = join(XMDX_ROOT, 'examples/starlight');
  const distDir = join(projectDir, 'dist');

  beforeAll(async () => {
    await $`rm -rf ${distDir} ${join(projectDir, '.astro')}`.quiet().nothrow();
  });

  test('builds successfully and produces valid output', async () => {
    const { exitCode, stderr } = await buildProject(projectDir);
    if (exitCode !== 0) console.error(stderr);
    expect(exitCode).toBe(0);

    const count = countHtmlFiles(distDir);
    expect(count).toBeGreaterThan(0);

    const indexPath = join(distDir, 'index.html');
    expect(existsSync(indexPath)).toBe(true);
  }, 120_000);
});
