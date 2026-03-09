import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_EXPRESSIVE_CODE_MODULE_ID,
  ExpressiveCodeManager,
} from './expressive-code-manager.js';

describe('ExpressiveCodeManager runtime support', () => {
  test('canRewrite stays true when local engine can pre-render default runtime imports', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'xmdx-ec-runtime-'));
    await writeFile(path.join(tempRoot, 'package.json'), '{"name":"fixture","type":"module"}\n');

    const manager = new ExpressiveCodeManager({
      component: 'Code',
      moduleId: DEFAULT_EXPRESSIVE_CODE_MODULE_ID,
    });

    expect(await manager.canRewrite(DEFAULT_EXPRESSIVE_CODE_MODULE_ID, tempRoot)).toBe(true);
  });

  test('does not treat engine availability as runtime rewrite availability', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'xmdx-ec-runtime-'));
    await writeFile(path.join(tempRoot, 'package.json'), '{"name":"fixture","type":"module"}\n');

    const manager = new ExpressiveCodeManager({
      component: 'Code',
      moduleId: DEFAULT_EXPRESSIVE_CODE_MODULE_ID,
    });

    const support = await manager.getSupport(DEFAULT_EXPRESSIVE_CODE_MODULE_ID, tempRoot);

    expect(support.canPreRenderEngine).toBe(true);
    expect(support.canRewriteRuntime).toBe(false);
  });

  test('allows relative custom runtimes without package resolution', async () => {
    const manager = new ExpressiveCodeManager({
      component: 'Code',
      moduleId: './components/code.js',
    });

    expect(await manager.canRewrite('./components/code.js')).toBe(true);
  });

  test('treats starlight-managed rendering as rewrite-safe without local engine', async () => {
    const manager = new ExpressiveCodeManager({
      component: 'Code',
      moduleId: '@astrojs/starlight/components',
    }, true);

    const support = await manager.getSupport('@astrojs/starlight/components');

    expect(support.canRewriteRuntime).toBe(true);
    expect(support.canPreRenderEngine).toBe(false);
  });
});
