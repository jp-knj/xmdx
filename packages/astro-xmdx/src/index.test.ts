import { describe, expect, test } from 'bun:test';
import xmdx from './index.js';

describe('xmdx integration setup', () => {
  test('registers renderer using built server file URL entrypoint', async () => {
    const integration = xmdx();
    const setupHook = integration.hooks['astro:config:setup'];

    expect(setupHook).toBeDefined();

    const renderers: Array<{ name: string; serverEntrypoint: string }> = [];
    const updatedConfigs: unknown[] = [];

    await setupHook?.({
      config: {
        integrations: [],
      },
      updateConfig: (config: unknown) => {
        updatedConfigs.push(config);
      },
      addRenderer: (renderer: { name: string; serverEntrypoint: string }) => {
        renderers.push(renderer);
      },
    } as unknown as Parameters<NonNullable<typeof setupHook>>[0]);

    expect(renderers).toHaveLength(1);
    expect(renderers[0]?.name).toBe('astro:jsx');
    expect(renderers[0]?.serverEntrypoint.startsWith('file://')).toBe(true);
    expect(renderers[0]?.serverEntrypoint.endsWith('/server.js')).toBe(true);
    expect(updatedConfigs).toHaveLength(1);
  });
});
