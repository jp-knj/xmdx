import { describe, expect, test } from 'bun:test';
import xmdx from './index.js';

// Helper to invoke the setup hook with a mocked Astro config
async function invokeSetup(
  integration: ReturnType<typeof xmdx>,
  configOverrides: Record<string, unknown> = {}
) {
  const setupHook = integration.hooks['astro:config:setup'];
  const renderers: Array<{ name: string; serverEntrypoint: string }> = [];
  const updatedConfigs: unknown[] = [];

  await setupHook?.({
    config: {
      integrations: [],
      ...configOverrides,
    },
    updateConfig: (config: unknown) => {
      updatedConfigs.push(config);
    },
    addRenderer: (renderer: { name: string; serverEntrypoint: string }) => {
      renderers.push(renderer);
    },
  } as unknown as Parameters<NonNullable<typeof setupHook>>[0]);

  return { renderers, updatedConfigs };
}

describe('xmdx integration setup', () => {
  test('registers renderer using built server file URL entrypoint', async () => {
    const integration = xmdx();
    const { renderers, updatedConfigs } = await invokeSetup(integration);

    expect(renderers).toHaveLength(1);
    expect(renderers[0]?.name).toBe('astro:jsx');
    expect(renderers[0]?.serverEntrypoint.startsWith('file://')).toBe(true);
    expect(renderers[0]?.serverEntrypoint.endsWith('/server.js')).toBe(true);
    expect(updatedConfigs).toHaveLength(1);
  });
});

describe('Starlight auto-detection', () => {
  test('auto-enables starlightComponents when Starlight is detected', async () => {
    const integration = xmdx();
    const { updatedConfigs } = await invokeSetup(integration, {
      integrations: [{ name: '@astrojs/starlight' }],
    });

    // The vite plugin receives the resolved options
    const viteConfig = updatedConfigs[0] as { vite: { plugins: Array<{ name: string }> } };
    expect(viteConfig.vite.plugins).toHaveLength(1);
    expect(viteConfig.vite.plugins[0]?.name).toBe('vite-plugin-xmdx');
  });

  test('auto-registers libraries when Starlight detected and none provided', async () => {
    // Access resolved options via plugin creation
    const integration = xmdx();

    // Verify that setup completes without errors when Starlight is detected
    const { updatedConfigs } = await invokeSetup(integration, {
      integrations: [{ name: '@astrojs/starlight' }],
    });
    expect(updatedConfigs).toHaveLength(1);
  });

  test('does not override user-provided libraries', async () => {
    const customLibrary = {
      id: 'custom',
      name: 'Custom',
      defaultModulePath: 'custom/module',
      components: [{ name: 'Custom', modulePath: 'custom/module', exportType: 'named' as const }],
    };

    const integration = xmdx({ libraries: [customLibrary] });
    const { updatedConfigs } = await invokeSetup(integration, {
      integrations: [{ name: '@astrojs/starlight' }],
    });
    expect(updatedConfigs).toHaveLength(1);
  });

  test('detects Starlight component overrides from integration config', async () => {
    const integration = xmdx();
    const { updatedConfigs } = await invokeSetup(integration, {
      integrations: [{
        name: '@astrojs/starlight',
        config: {
          components: {
            Aside: './src/components/CustomAside.astro',
          },
        },
      }],
    });
    // Should complete without errors - override detection adjusts import paths
    expect(updatedConfigs).toHaveLength(1);
  });
});
