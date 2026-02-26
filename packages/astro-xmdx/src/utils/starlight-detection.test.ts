import { describe, it, expect } from 'bun:test';
import {
  findStarlightIntegration,
  getStarlightComponentOverrides,
  applyStarlightOverrides,
} from './starlight-detection.js';
import type { ComponentLibrary } from 'xmdx/registry';
import type { XmdxOptions } from '../index.js';

describe('findStarlightIntegration', () => {
  it('should return null when integrations is undefined', () => {
    expect(findStarlightIntegration(undefined)).toBe(null);
  });

  it('should return null when integrations array is empty', () => {
    expect(findStarlightIntegration([])).toBe(null);
  });

  it('should return null when Starlight is not present', () => {
    const integrations = [
      { name: '@astrojs/mdx' },
      { name: '@astrojs/sitemap' },
    ];
    expect(findStarlightIntegration(integrations)).toBe(null);
  });

  it('should find Starlight integration by name', () => {
    const starlightIntegration = {
      name: '@astrojs/starlight',
      config: { components: { Aside: './src/Aside.astro' } },
    };
    const integrations = [
      { name: '@astrojs/mdx' },
      starlightIntegration,
    ];

    const result = findStarlightIntegration(integrations);
    expect(result).not.toBe(null);
    expect(result!.integration).toBe(starlightIntegration);
  });

  it('should extract config and component overrides', () => {
    const integrations = [{
      name: '@astrojs/starlight',
      config: {
        components: {
          Aside: './src/Aside.astro',
          Code: './src/Code.astro',
        },
      },
    }];

    const result = findStarlightIntegration(integrations)!;
    expect(result.config).toEqual({
      components: {
        Aside: './src/Aside.astro',
        Code: './src/Code.astro',
      },
    });
    expect(result.componentOverrides.size).toBe(2);
    expect(result.componentOverrides.get('Aside')).toBe('./src/Aside.astro');
    expect(result.componentOverrides.get('Code')).toBe('./src/Code.astro');
  });

  it('should return empty overrides when no components configured', () => {
    const integrations = [{
      name: '@astrojs/starlight',
      config: { title: 'My Docs' },
    }];

    const result = findStarlightIntegration(integrations)!;
    expect(result.componentOverrides.size).toBe(0);
  });
});

describe('getStarlightComponentOverrides', () => {
  it('should return empty map for null config', () => {
    expect(getStarlightComponentOverrides(null).size).toBe(0);
  });

  it('should return empty map for undefined config', () => {
    expect(getStarlightComponentOverrides(undefined).size).toBe(0);
  });

  it('should return empty map when components is not an object', () => {
    expect(getStarlightComponentOverrides({ components: 'invalid' }).size).toBe(0);
  });

  it('should return empty map when no components key', () => {
    expect(getStarlightComponentOverrides({ title: 'Docs' }).size).toBe(0);
  });

  it('should extract string component overrides', () => {
    const config = {
      components: {
        Aside: './src/Aside.astro',
        Code: './src/Code.astro',
      },
    };
    const result = getStarlightComponentOverrides(config);
    expect(result.size).toBe(2);
    expect(result.get('Aside')).toBe('./src/Aside.astro');
    expect(result.get('Code')).toBe('./src/Code.astro');
  });

  it('should skip non-string and empty string values', () => {
    const config = {
      components: {
        Aside: './src/Aside.astro',
        Code: '',
        Tabs: 42,
        TabItem: null,
      },
    };
    const result = getStarlightComponentOverrides(config);
    expect(result.size).toBe(1);
    expect(result.get('Aside')).toBe('./src/Aside.astro');
  });
});

describe('applyStarlightOverrides', () => {
  const baseLibrary: ComponentLibrary = {
    id: 'starlight',
    name: 'Starlight',
    defaultModulePath: '@astrojs/starlight/components',
    components: [
      { name: 'Aside', modulePath: '@astrojs/starlight/components', exportType: 'named' },
      { name: 'Code', modulePath: '@astrojs/starlight/components', exportType: 'named' },
      { name: 'Tabs', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    ],
  };

  it('should return the same library when overrides are empty', () => {
    const result = applyStarlightOverrides(baseLibrary, new Map());
    expect(result).toBe(baseLibrary);
  });

  it('should replace modulePath and set exportType to default for overridden components', () => {
    const overrides = new Map([['Aside', './src/CustomAside.astro']]);
    const result = applyStarlightOverrides(baseLibrary, overrides);

    expect(result).not.toBe(baseLibrary);
    expect(result.id).toBe('starlight');

    const aside = result.components.find(c => c.name === 'Aside')!;
    expect(aside.modulePath).toBe('./src/CustomAside.astro');
    expect(aside.exportType).toBe('default');

    // Non-overridden components remain unchanged
    const code = result.components.find(c => c.name === 'Code')!;
    expect(code.modulePath).toBe('@astrojs/starlight/components');
    expect(code.exportType).toBe('named');
  });

  it('should handle multiple overrides', () => {
    const overrides = new Map([
      ['Aside', './src/Aside.astro'],
      ['Tabs', './src/Tabs.astro'],
    ]);
    const result = applyStarlightOverrides(baseLibrary, overrides);

    const aside = result.components.find(c => c.name === 'Aside')!;
    const tabs = result.components.find(c => c.name === 'Tabs')!;
    const code = result.components.find(c => c.name === 'Code')!;

    expect(aside.modulePath).toBe('./src/Aside.astro');
    expect(aside.exportType).toBe('default');
    expect(tabs.modulePath).toBe('./src/Tabs.astro');
    expect(tabs.exportType).toBe('default');
    expect(code.modulePath).toBe('@astrojs/starlight/components');
    expect(code.exportType).toBe('named');
  });

  it('should not mutate the original library', () => {
    const overrides = new Map([['Aside', './src/Aside.astro']]);
    applyStarlightOverrides(baseLibrary, overrides);

    // Original should be untouched
    expect(baseLibrary.components[0].modulePath).toBe('@astrojs/starlight/components');
    expect(baseLibrary.components[0].exportType).toBe('named');
  });

  it('should ignore overrides for components not in the library', () => {
    const overrides = new Map([['NonExistent', './src/Nope.astro']]);
    const result = applyStarlightOverrides(baseLibrary, overrides);

    // All components remain unchanged (but a new library object is returned)
    for (const comp of result.components) {
      expect(comp.modulePath).toBe('@astrojs/starlight/components');
      expect(comp.exportType).toBe('named');
    }
  });

  it('should resolve relative override paths to absolute when rootDir is provided', () => {
    const overrides = new Map([['Aside', './src/CustomAside.astro']]);
    const result = applyStarlightOverrides(baseLibrary, overrides, '/projects/my-site');

    const aside = result.components.find(c => c.name === 'Aside')!;
    expect(aside.modulePath).toBe('/projects/my-site/src/CustomAside.astro');
    expect(aside.exportType).toBe('default');
  });

  it('should not modify absolute override paths when rootDir is provided', () => {
    const overrides = new Map([['Aside', '/absolute/path/CustomAside.astro']]);
    const result = applyStarlightOverrides(baseLibrary, overrides, '/projects/my-site');

    const aside = result.components.find(c => c.name === 'Aside')!;
    expect(aside.modulePath).toBe('/absolute/path/CustomAside.astro');
  });

  it('should not modify package paths when rootDir is provided', () => {
    const overrides = new Map([['Aside', 'my-package/Aside.astro']]);
    const result = applyStarlightOverrides(baseLibrary, overrides, '/projects/my-site');

    const aside = result.components.find(c => c.name === 'Aside')!;
    expect(aside.modulePath).toBe('my-package/Aside.astro');
  });
});

describe('starlightDetected gating', () => {
  // This tests the conditional logic from index.ts:
  // starlightDetected should only be set when starlightComponents !== false.
  // We replicate the exact conditional used in the integration hook.

  function isStarlightDisabled(value: unknown): boolean {
    if (value === false) return true;
    if (typeof value === 'object' && value !== null && (value as Record<string, unknown>).enabled === false) return true;
    return false;
  }

  function resolveStarlightDetected(
    resolvedOptions: Record<string, unknown>,
    starlightFound: boolean,
  ): boolean {
    // Mirrors the logic in index.ts astro:config:setup hook
    if (starlightFound) {
      if (resolvedOptions.starlightComponents === undefined) {
        resolvedOptions.starlightComponents = true;
      }
      if (!isStarlightDisabled(resolvedOptions.starlightComponents)) {
        resolvedOptions.starlightDetected = true;
      }
    }
    return resolvedOptions.starlightDetected === true;
  }

  it('should set starlightDetected when Starlight is found and starlightComponents is undefined', () => {
    const opts: Record<string, unknown> = {};
    const result = resolveStarlightDetected(opts, true);
    expect(result).toBe(true);
    expect(opts.starlightDetected).toBe(true);
  });

  it('should set starlightDetected when starlightComponents is explicitly true', () => {
    const opts: Record<string, unknown> = { starlightComponents: true };
    const result = resolveStarlightDetected(opts, true);
    expect(result).toBe(true);
    expect(opts.starlightDetected).toBe(true);
  });

  it('should NOT set starlightDetected when starlightComponents is explicitly false', () => {
    const opts: Record<string, unknown> = { starlightComponents: false };
    const result = resolveStarlightDetected(opts, true);
    expect(result).toBe(false);
    expect(opts.starlightDetected).toBeUndefined();
  });

  it('should NOT set starlightDetected when starlightComponents is { enabled: false }', () => {
    const opts: Record<string, unknown> = { starlightComponents: { enabled: false } };
    const result = resolveStarlightDetected(opts, true);
    expect(result).toBe(false);
    expect(opts.starlightDetected).toBeUndefined();
  });

  it('should NOT set starlightDetected when Starlight is not found', () => {
    const opts: Record<string, unknown> = {};
    const result = resolveStarlightDetected(opts, false);
    expect(result).toBe(false);
    expect(opts.starlightDetected).toBeUndefined();
  });
});
