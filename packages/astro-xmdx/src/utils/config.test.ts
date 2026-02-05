import { describe, it, expect } from 'bun:test';
import { resolveExpressiveCodeConfig, resolveStarlightConfig } from './config.js';
import {
  createRegistry,
  starlightLibrary,
  expressiveCodeLibrary,
} from 'xmdx/registry';

const STARLIGHT_COMPONENTS = starlightLibrary.components.map((c) => c.name);
const STARLIGHT_COMPONENTS_MODULE = starlightLibrary.defaultModulePath;
const EXPRESSIVE_CODE_COMPONENT = expressiveCodeLibrary.components[0]?.name ?? 'Code';
const EXPRESSIVE_CODE_MODULE = expressiveCodeLibrary.defaultModulePath;

describe('resolveExpressiveCodeConfig', () => {
  it('should return null for falsy values', () => {
    expect(resolveExpressiveCodeConfig(null)).toBe(null);
    expect(resolveExpressiveCodeConfig(undefined)).toBe(null);
    expect(resolveExpressiveCodeConfig(false)).toBe(null);
  });

  it('should return default config for true', () => {
    const result = resolveExpressiveCodeConfig(true);

    expect(result).toEqual({
      component: EXPRESSIVE_CODE_COMPONENT,
      moduleId: EXPRESSIVE_CODE_MODULE,
    });
  });

  it('should use defaults for empty object', () => {
    const result = resolveExpressiveCodeConfig({});

    expect(result).toEqual({
      component: EXPRESSIVE_CODE_COMPONENT,
      moduleId: EXPRESSIVE_CODE_MODULE,
    });
  });

  it('should use custom component name', () => {
    const result = resolveExpressiveCodeConfig({
      component: 'CustomCode',
    });

    expect(result).toEqual({
      component: 'CustomCode',
      moduleId: EXPRESSIVE_CODE_MODULE,
    });
  });

  it('should use custom module path', () => {
    const result = resolveExpressiveCodeConfig({
      module: 'my-custom-module',
    });

    expect(result).toEqual({
      component: EXPRESSIVE_CODE_COMPONENT,
      moduleId: 'my-custom-module',
    });
  });

  it('should use both custom component and module', () => {
    const result = resolveExpressiveCodeConfig({
      component: 'MyCode',
      module: 'my-module',
    });

    expect(result).toEqual({
      component: 'MyCode',
      moduleId: 'my-module',
    });
  });

  it('should ignore empty string component', () => {
    const result = resolveExpressiveCodeConfig({
      component: '',
    });

    expect(result?.component).toBe(EXPRESSIVE_CODE_COMPONENT);
  });

  it('should ignore empty string module', () => {
    const result = resolveExpressiveCodeConfig({
      module: '',
    });

    expect(result?.moduleId).toBe(EXPRESSIVE_CODE_MODULE);
  });
});

describe('resolveStarlightConfig', () => {
  it('should return null for falsy values', () => {
    expect(resolveStarlightConfig(null)).toBe(null);
    expect(resolveStarlightConfig(undefined)).toBe(null);
    expect(resolveStarlightConfig(false)).toBe(null);
  });

  it('should return default config for true', () => {
    const result = resolveStarlightConfig(true);

    expect(result).toEqual({
      components: STARLIGHT_COMPONENTS,
      moduleId: STARLIGHT_COMPONENTS_MODULE,
    });
  });

  it('should use defaults for empty object', () => {
    const result = resolveStarlightConfig({});

    expect(result).toEqual({
      components: STARLIGHT_COMPONENTS,
      moduleId: STARLIGHT_COMPONENTS_MODULE,
    });
  });

  it('should use custom components array', () => {
    const customComponents = ['Aside', 'Tabs'];
    const result = resolveStarlightConfig({
      components: customComponents,
    });

    expect(result).toEqual({
      components: customComponents,
      moduleId: STARLIGHT_COMPONENTS_MODULE,
    });
  });

  it('should use custom module path', () => {
    const result = resolveStarlightConfig({
      module: 'my-starlight-module',
    });

    expect(result).toEqual({
      components: STARLIGHT_COMPONENTS,
      moduleId: 'my-starlight-module',
    });
  });

  it('should use both custom components and module', () => {
    const customComponents = ['CustomAside'];
    const result = resolveStarlightConfig({
      components: customComponents,
      module: 'custom-module',
    });

    expect(result).toEqual({
      components: customComponents,
      moduleId: 'custom-module',
    });
  });

  it('should ignore empty string module', () => {
    const result = resolveStarlightConfig({
      module: '',
    });

    expect(result?.moduleId).toBe(STARLIGHT_COMPONENTS_MODULE);
  });

  it('should handle empty components array', () => {
    const result = resolveStarlightConfig({
      components: [],
    });

    expect(result?.components).toEqual([]);
  });
});

describe('resolveExpressiveCodeConfig with registry', () => {
  const registry = createRegistry([expressiveCodeLibrary]);

  it('should return default config from registry for true', () => {
    const result = resolveExpressiveCodeConfig(true, registry);

    expect(result).toEqual({
      component: 'Code',
      moduleId: 'astro-expressive-code/components',
    });
  });

  it('should use registry defaults for empty object', () => {
    const result = resolveExpressiveCodeConfig({}, registry);

    expect(result).toEqual({
      component: 'Code',
      moduleId: 'astro-expressive-code/components',
    });
  });

  it('should allow custom overrides with registry', () => {
    const result = resolveExpressiveCodeConfig({
      component: 'CustomCode',
      module: 'my-module',
    }, registry);

    expect(result).toEqual({
      component: 'CustomCode',
      moduleId: 'my-module',
    });
  });

  it('should fall back to constants when registry has no matching components', () => {
    const emptyRegistry = createRegistry([]);
    const result = resolveExpressiveCodeConfig(true, emptyRegistry);

    expect(result).toEqual({
      component: EXPRESSIVE_CODE_COMPONENT,
      moduleId: EXPRESSIVE_CODE_MODULE,
    });
  });
});

describe('resolveStarlightConfig with registry', () => {
  const registry = createRegistry([starlightLibrary]);

  it('should return default config from registry for true', () => {
    const result = resolveStarlightConfig(true, registry);

    expect(result?.moduleId).toBe('@astrojs/starlight/components');
    expect(result?.components).toContain('Aside');
    expect(result?.components).toContain('Tabs');
    expect(result?.components).toContain('TabItem');
  });

  it('should use registry defaults for empty object', () => {
    const result = resolveStarlightConfig({}, registry);

    expect(result?.moduleId).toBe('@astrojs/starlight/components');
    expect((result?.components.length ?? 0) > 0).toBe(true);
  });

  it('should allow custom overrides with registry', () => {
    const result = resolveStarlightConfig({
      components: ['CustomAside'],
      module: 'my-module',
    }, registry);

    expect(result).toEqual({
      components: ['CustomAside'],
      moduleId: 'my-module',
    });
  });

  it('should fall back to constants when registry has no matching components', () => {
    const emptyRegistry = createRegistry([]);
    const result = resolveStarlightConfig(true, emptyRegistry);

    expect(result).toEqual({
      components: STARLIGHT_COMPONENTS,
      moduleId: STARLIGHT_COMPONENTS_MODULE,
    });
  });
});
