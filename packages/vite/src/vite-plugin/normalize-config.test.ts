import { describe, test, expect } from 'bun:test';
import { normalizeStarlightComponents } from './normalize-config.js';

describe('normalizeStarlightComponents', () => {
  test('returns true for boolean true input', () => {
    const result = normalizeStarlightComponents(true);
    expect(result).toBe(true);
  });

  test('returns false for boolean false input', () => {
    const result = normalizeStarlightComponents(false);
    expect(result).toBe(false);
  });

  test('returns false when enabled is explicitly false', () => {
    const result = normalizeStarlightComponents({ enabled: false });
    expect(result).toBe(false);
  });

  test('returns false when enabled is false with other properties', () => {
    const result = normalizeStarlightComponents({
      enabled: false,
      components: ['Aside', 'Tabs'],
      module: '@custom/module',
    });
    expect(result).toBe(false);
  });

  test('strips enabled property and preserves components when enabled is true', () => {
    const result = normalizeStarlightComponents({
      enabled: true,
      components: ['Aside', 'Tabs'],
    });
    expect(result).toEqual({ components: ['Aside', 'Tabs'], module: undefined });
  });

  test('strips enabled property and preserves module', () => {
    const result = normalizeStarlightComponents({
      enabled: true,
      module: '@custom/starlight/components',
    });
    expect(result).toEqual({ components: undefined, module: '@custom/starlight/components' });
  });

  test('preserves both components and module', () => {
    const result = normalizeStarlightComponents({
      components: ['Aside', 'Card'],
      module: '@astrojs/starlight/components',
    });
    expect(result).toEqual({
      components: ['Aside', 'Card'],
      module: '@astrojs/starlight/components',
    });
  });

  test('handles object without enabled property', () => {
    const result = normalizeStarlightComponents({
      components: ['Aside'],
    });
    expect(result).toEqual({ components: ['Aside'], module: undefined });
  });

  test('handles empty object', () => {
    const result = normalizeStarlightComponents({});
    expect(result).toEqual({ components: undefined, module: undefined });
  });

  test('handles null input by returning false', () => {
    // Cast to expected type since null is a valid falsy value
    const result = normalizeStarlightComponents(null as unknown as boolean);
    expect(result).toBe(false);
  });

  test('handles undefined input by returning false', () => {
    const result = normalizeStarlightComponents(undefined as unknown as boolean);
    expect(result).toBe(false);
  });
});
