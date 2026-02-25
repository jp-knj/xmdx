import { describe, test, expect } from 'bun:test';
import { generateComponentImports } from './component-imports.js';
import { createRegistry, starlightLibrary } from 'xmdx/registry';
import type { UsedComponent } from './component-detection.js';

describe('generateComponentImports', () => {
  const registry = createRegistry([starlightLibrary]);

  test('produces identical output for identical input (stability)', () => {
    const components: UsedComponent[] = [
      { name: 'Tabs', modulePath: '@astrojs/starlight/components', exportType: 'named' },
      { name: 'Card', modulePath: '@astrojs/starlight/components', exportType: 'named' },
      { name: 'Aside', modulePath: '@astrojs/starlight/components', exportType: 'default' },
    ];

    const first = generateComponentImports(components, registry);
    const second = generateComponentImports(components, registry);

    expect(first).toBe(second);
  });

  test('groups named imports by module and generates default imports individually', () => {
    const components: UsedComponent[] = [
      { name: 'Tabs', modulePath: '@astrojs/starlight/components', exportType: 'named' },
      { name: 'Card', modulePath: '@astrojs/starlight/components', exportType: 'named' },
      { name: 'Badge', modulePath: '@astrojs/starlight/components', exportType: 'named' },
      { name: 'Aside', modulePath: '@my/components', exportType: 'default' },
    ];

    const result = generateComponentImports(components, registry);
    const lines = result.split('\n');

    expect(lines).toEqual([
      "import { Tabs, Card, Badge } from '@astrojs/starlight/components';",
      "import Aside from '@my/components/Aside.astro';",
    ]);
  });

  test('returns empty string for no components', () => {
    const result = generateComponentImports([], registry);
    expect(result).toBe('');
  });

  test('default export with file extension imports directly', () => {
    const components: UsedComponent[] = [
      { name: 'Widget', modulePath: './src/Widget.astro', exportType: 'default' },
    ];

    const result = generateComponentImports(components, registry);
    expect(result).toBe("import Widget from './src/Widget.astro';");
  });

  test('absolute POSIX path gets /@fs/ prefix', () => {
    const components: UsedComponent[] = [
      { name: 'Aside', modulePath: '/projects/my-site/src/CustomAside.astro', exportType: 'default' },
    ];

    const result = generateComponentImports(components, registry);
    expect(result).toBe("import Aside from '/@fs/projects/my-site/src/CustomAside.astro';");
  });

  test('absolute Windows path gets /@fs/ prefix', () => {
    const components: UsedComponent[] = [
      { name: 'Widget', modulePath: 'C:/Users/foo/src/Widget.astro', exportType: 'default' },
    ];

    const result = generateComponentImports(components, registry);
    expect(result).toBe("import Widget from '/@fs/C:/Users/foo/src/Widget.astro';");
  });

  test('relative and package paths are unchanged', () => {
    const components: UsedComponent[] = [
      { name: 'Widget', modulePath: './src/Widget.astro', exportType: 'default' },
      { name: 'Tabs', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    ];

    const result = generateComponentImports(components, registry);
    const lines = result.split('\n');
    expect(lines).toEqual([
      "import { Tabs } from '@astrojs/starlight/components';",
      "import Widget from './src/Widget.astro';",
    ]);
  });

  test('absolute Windows path with backslashes gets normalized and /@fs/ prefix', () => {
    const components: UsedComponent[] = [
      { name: 'Widget', modulePath: 'C:\\Users\\foo\\src\\Widget.astro', exportType: 'default' },
    ];
    const result = generateComponentImports(components, registry);
    expect(result).toBe("import Widget from '/@fs/C:/Users/foo/src/Widget.astro';");
  });

  test('absolute Windows backslash path without extension appends name.astro', () => {
    const components: UsedComponent[] = [
      { name: 'Card', modulePath: 'C:\\project\\src\\components', exportType: 'default' },
    ];
    const result = generateComponentImports(components, registry);
    expect(result).toBe("import Card from '/@fs/C:/project/src/components/Card.astro';");
  });

  test('absolute path without file extension appends name.astro with /@fs/ prefix', () => {
    const components: UsedComponent[] = [
      { name: 'Card', modulePath: '/projects/my-site/src/components', exportType: 'default' },
    ];

    const result = generateComponentImports(components, registry);
    expect(result).toBe("import Card from '/@fs/projects/my-site/src/components/Card.astro';");
  });
});
