/**
 * Registry validation utilities
 * @module registry/validation
 */

import type {
  ValidationError,
  ValidationResult,
} from './types.js';
import { isRecord, nameOf, directiveNameOf, asFunction } from '../ops/casts.js';

/**
 * Validate a component definition has required fields.
 */
function validateComponent(component: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isRecord(component)) {
    errors.push({
      type: 'component',
      name: 'unknown',
      message: 'Component definition must be an object',
    });
    return errors;
  }

  if (typeof component.name !== 'string' || component.name.length === 0) {
    errors.push({
      type: 'component',
      name: nameOf(component),
      message: 'Component must have a non-empty "name" string',
    });
  }

  if (typeof component.modulePath !== 'string' || component.modulePath.length === 0) {
    errors.push({
      type: 'component',
      name: nameOf(component),
      message: 'Component must have a non-empty "modulePath" string',
    });
  }

  return errors;
}

/**
 * Validate a directive mapping references an existing component.
 */
function validateDirectiveMapping(
  directive: unknown,
  componentNames: Set<string>
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isRecord(directive)) {
    errors.push({
      type: 'directive',
      name: 'unknown',
      message: 'Directive mapping must be an object',
    });
    return errors;
  }

  if (typeof directive.directive !== 'string' || directive.directive.length === 0) {
    errors.push({
      type: 'directive',
      name: directiveNameOf(directive),
      message: 'Directive mapping must have a non-empty "directive" string',
    });
  }

  if (typeof directive.component !== 'string' || directive.component.length === 0) {
    errors.push({
      type: 'directive',
      name: directiveNameOf(directive),
      message: 'Directive mapping must have a non-empty "component" string',
    });
  } else if (!componentNames.has(directive.component)) {
    errors.push({
      type: 'directive',
      name: directiveNameOf(directive),
      message: `Directive mapping references unknown component "${directive.component}"`,
    });
  }

  return errors;
}

/**
 * Validate a component library preset.
 *
 * @param library - Component library to validate
 * @returns Validation result
 *
 * @example
 * import { validateLibrary } from 'xmdx/registry';
 * const result = validateLibrary(starlightLibrary);
 * if (!result.valid) {
 *   console.error('Invalid library:', result.errors);
 * }
 */
export function validateLibrary(library: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isRecord(library)) {
    return {
      valid: false,
      errors: [{
        type: 'component',
        name: 'unknown',
        message: 'Library must be an object',
      }],
    };
  }

  // Validate components
  const components = Array.isArray(library.components) ? library.components : [];
  const componentNames = new Set<string>();

  for (const component of components) {
    const componentErrors = validateComponent(component);
    errors.push(...componentErrors);
    const name = nameOf(component);
    if (name !== 'unknown') {
      componentNames.add(name);
    }
  }

  // Validate directive mappings
  const directives = Array.isArray(library.directiveMappings) ? library.directiveMappings : [];
  for (const directive of directives) {
    const directiveErrors = validateDirectiveMapping(directive, componentNames);
    errors.push(...directiveErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a component registry.
 * Validates all components and directive mappings in the registry.
 *
 * @param registry - Registry to validate
 * @returns Validation result
 *
 * @example
 * import { createRegistry, validateRegistry, starlightLibrary } from 'xmdx/registry';
 * const registry = createRegistry([starlightLibrary]);
 * const result = validateRegistry(registry);
 * if (!result.valid) {
 *   console.error('Invalid registry:', result.errors);
 * }
 */
export function validateRegistry(registry: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isRecord(registry)) {
    return {
      valid: false,
      errors: [{
        type: 'component',
        name: 'unknown',
        message: 'Registry must be an object',
      }],
    };
  }

  // Validate all components
  const getAllComponents = typeof registry.getAllComponents === 'function'
    ? asFunction<() => unknown[]>(registry.getAllComponents)
    : undefined;
  const allComponents = getAllComponents?.() ?? [];
  const componentNames = new Set<string>();

  for (const component of allComponents) {
    const componentErrors = validateComponent(component);
    errors.push(...componentErrors);
    const name = nameOf(component);
    if (name !== 'unknown') {
      componentNames.add(name);
    }
  }

  // Validate directive mappings
  const getSupportedDirectives = typeof registry.getSupportedDirectives === 'function'
    ? asFunction<() => string[]>(registry.getSupportedDirectives)
    : undefined;
  const getDirectiveMapping = typeof registry.getDirectiveMapping === 'function'
    ? asFunction<(name: string) => unknown>(registry.getDirectiveMapping)
    : undefined;
  const supportedDirectives = getSupportedDirectives?.() ?? [];
  for (const directiveName of supportedDirectives) {
    const mapping = getDirectiveMapping?.(directiveName);
    if (mapping) {
      const directiveErrors = validateDirectiveMapping(mapping, componentNames);
      errors.push(...directiveErrors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
