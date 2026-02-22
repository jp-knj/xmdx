import { describe, it, expect } from 'bun:test';
import {
  findStarlightIntegration,
  getStarlightComponentOverrides,
  applyStarlightOverrides,
} from './starlight-detection.js';
import type { ComponentLibrary } from 'xmdx/registry';

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
});
