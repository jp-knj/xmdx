import { describe, test, expect } from 'bun:test';
import { detectUsedComponents } from './component-detection.js';
import type { Registry } from 'xmdx/registry';

/**
 * Creates a minimal mock registry for testing.
 */
function createMockRegistry(components: Array<{ name: string; modulePath: string; exportType: 'named' | 'default' }>): Registry {
  const map = new Map(components.map(c => [c.name, c]));
  return {
    getComponent: (name: string) => map.get(name),
    getAllComponents: () => components,
    getDirectiveMapping: () => undefined,
    getSlotNormalization: () => undefined,
    getSupportedDirectives: () => [],
    getAllSlotNormalizations: () => [],
    getComponentsByModule: () => [],
    hasComponent: (name: string) => map.has(name),
    getImportPath: () => undefined,
  } as unknown as Registry;
}

const registry = createMockRegistry([
  { name: 'Foo', modulePath: './Foo.astro', exportType: 'default' },
  { name: 'Bar', modulePath: './Bar.astro', exportType: 'default' },
  { name: 'Baz', modulePath: './components', exportType: 'named' },
]);

describe('detectUsedComponents', () => {
  test('single-line imports are recognized', () => {
    const code = [
      "import Foo from './Foo.astro';",
      '',
      'function MDXContent() {',
      '  return jsx(Foo, {});',
      '}',
    ].join('\n');

    const result = detectUsedComponents(code, registry);
    // Foo is already imported, should not appear in result
    expect(result.find(c => c.name === 'Foo')).toBeUndefined();
  });

  test('multi-line named import is recognized as existing', () => {
    const code = [
      'import {',
      '  Foo,',
      '  Bar',
      "} from './components';",
      '',
      'function MDXContent() {',
      '  return jsx(Foo, { children: jsx(Bar, {}) });',
      '}',
    ].join('\n');

    const result = detectUsedComponents(code, registry);
    // Both Foo and Bar are already imported, neither should appear
    expect(result.find(c => c.name === 'Foo')).toBeUndefined();
    expect(result.find(c => c.name === 'Bar')).toBeUndefined();
  });

  test('partially covered multi-line import only detects unimported components', () => {
    const code = [
      'import {',
      '  Foo',
      "} from './Foo.astro';",
      '',
      'function MDXContent() {',
      '  return jsx(Foo, { children: jsx(Bar, {}) });',
      '}',
    ].join('\n');

    const result = detectUsedComponents(code, registry);
    // Foo is imported, should not appear
    expect(result.find(c => c.name === 'Foo')).toBeUndefined();
    // Bar is NOT imported, should be detected
    expect(result.find(c => c.name === 'Bar')).toBeDefined();
  });

  test('multi-line import with default and named imports', () => {
    const code = [
      'import Baz, {',
      '  Foo,',
      '  Bar',
      "} from './components';",
      '',
      'function MDXContent() {',
      '  return jsx(Foo, { children: [jsx(Bar, {}), jsx(Baz, {})] });',
      '}',
    ].join('\n');

    const result = detectUsedComponents(code, registry);
    expect(result).toEqual([]);
  });

  test('unimported registry components are detected', () => {
    const code = [
      "import Something from './other';",
      '',
      'function MDXContent() {',
      '  return jsx(Foo, { children: jsx(Bar, {}) });',
      '}',
    ].join('\n');

    const result = detectUsedComponents(code, registry);
    expect(result.find(c => c.name === 'Foo')).toBeDefined();
    expect(result.find(c => c.name === 'Bar')).toBeDefined();
  });
});
