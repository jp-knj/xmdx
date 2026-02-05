import { describe, it, expect } from 'bun:test';
import { validateRegistry, validateLibrary } from './validation.js';
import { createRegistry } from './index.js';
import { starlightLibrary } from './presets/starlight.js';
import { astroLibrary } from './presets/astro.js';
import type { ComponentLibrary } from './types.js';

describe('validateLibrary', () => {
  it('should validate a valid library', () => {
    const result = validateLibrary(starlightLibrary);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should validate astro library', () => {
    const result = validateLibrary(astroLibrary);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should return error for null library', () => {
    const result = validateLibrary(null);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.message).toContain('Library must be an object');
  });

  it('should return error for non-object library', () => {
    const result = validateLibrary('not an object');

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
  });

  it('should return error for component without name', () => {
    const library = {
      components: [
        { modulePath: 'some/path' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('name'))).toBe(true);
  });

  it('should return error for component without modulePath', () => {
    const library = {
      components: [
        { name: 'Test' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('modulePath'))).toBe(true);
  });

  it('should return error for component with empty name', () => {
    const library = {
      components: [
        { name: '', modulePath: 'some/path' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('name'))).toBe(true);
  });

  it('should return error for component with empty modulePath', () => {
    const library = {
      components: [
        { name: 'Test', modulePath: '' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('modulePath'))).toBe(true);
  });

  it('should return error for directive without directive name', () => {
    const library = {
      components: [
        { name: 'Aside', modulePath: 'some/path' },
      ],
      directiveMappings: [
        { component: 'Aside' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === 'directive')).toBe(true);
  });

  it('should return error for directive without component', () => {
    const library = {
      components: [
        { name: 'Aside', modulePath: 'some/path' },
      ],
      directiveMappings: [
        { directive: 'note' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === 'directive')).toBe(true);
  });

  it('should return error for directive referencing unknown component', () => {
    const library = {
      components: [
        { name: 'Aside', modulePath: 'some/path' },
      ],
      directiveMappings: [
        { directive: 'note', component: 'Unknown' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('unknown component'))).toBe(true);
  });

  it('should validate library with valid directive mappings', () => {
    const library = {
      components: [
        { name: 'Aside', modulePath: 'some/path', exportType: 'named' as const },
      ],
      directiveMappings: [
        { directive: 'note', component: 'Aside' },
        { directive: 'tip', component: 'Aside' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should collect multiple errors', () => {
    const library = {
      components: [
        { name: '', modulePath: '' },
        { modulePath: 'path' },
      ],
    };

    const result = validateLibrary(library);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });
});

describe('validateRegistry', () => {
  it('should validate a valid registry', () => {
    const registry = createRegistry([starlightLibrary, astroLibrary]);
    const result = validateRegistry(registry);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should validate an empty registry', () => {
    const registry = createRegistry([]);
    const result = validateRegistry(registry);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should return error for null registry', () => {
    const result = validateRegistry(null);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.message).toContain('Registry must be an object');
  });

  it('should return error for non-object registry', () => {
    const result = validateRegistry('not an object');

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
  });

  it('should validate registry with starlight library', () => {
    const registry = createRegistry([starlightLibrary]);
    const result = validateRegistry(registry);

    expect(result.valid).toBe(true);
  });

  it('should validate registry created from library with directive mappings', () => {
    const library: ComponentLibrary = {
      id: 'test',
      name: 'Test Library',
      defaultModulePath: 'some/path',
      components: [
        { name: 'Aside', modulePath: 'some/path', exportType: 'named' },
      ],
      directiveMappings: [
        { directive: 'note', component: 'Aside' },
      ],
    };
    const registry = createRegistry([library]);

    const result = validateRegistry(registry);

    expect(result.valid).toBe(true);
  });
});
