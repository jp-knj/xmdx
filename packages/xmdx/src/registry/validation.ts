/**
 * Registry validation utilities
 * @module registry/validation
 */

import type {
  ComponentDefinition,
  DirectiveMapping,
  ComponentLibrary,
  Registry,
  ValidationError,
  ValidationResult,
} from './types.js';

/**
 * Validate a component definition has required fields.
 */
function validateComponent(component: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!component || typeof component !== 'object') {
    errors.push({
      type: 'component',
      name: 'unknown',
      message: 'Component definition must be an object',
    });
    return errors;
  }

  const comp = component as Record<string, unknown>;

  if (typeof comp.name !== 'string' || comp.name.length === 0) {
    errors.push({
      type: 'component',
      name: (comp.name as string) || 'unknown',
      message: 'Component must have a non-empty "name" string',
    });
  }

  if (typeof comp.modulePath !== 'string' || comp.modulePath.length === 0) {
    errors.push({
      type: 'component',
      name: (comp.name as string) || 'unknown',
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

  if (!directive || typeof directive !== 'object') {
    errors.push({
      type: 'directive',
      name: 'unknown',
      message: 'Directive mapping must be an object',
    });
    return errors;
  }

  const dir = directive as Record<string, unknown>;

  if (typeof dir.directive !== 'string' || dir.directive.length === 0) {
    errors.push({
      type: 'directive',
      name: (dir.directive as string) || 'unknown',
      message: 'Directive mapping must have a non-empty "directive" string',
    });
  }

  if (typeof dir.component !== 'string' || dir.component.length === 0) {
    errors.push({
      type: 'directive',
      name: (dir.directive as string) || 'unknown',
      message: 'Directive mapping must have a non-empty "component" string',
    });
  } else if (!componentNames.has(dir.component as string)) {
    errors.push({
      type: 'directive',
      name: (dir.directive as string) || 'unknown',
      message: `Directive mapping references unknown component "${dir.component}"`,
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

  if (!library || typeof library !== 'object') {
    return {
      valid: false,
      errors: [{
        type: 'component',
        name: 'unknown',
        message: 'Library must be an object',
      }],
    };
  }

  const lib = library as Partial<ComponentLibrary>;

  // Validate components
  const components = lib.components ?? [];
  const componentNames = new Set<string>();

  for (const component of components) {
    const componentErrors = validateComponent(component);
    errors.push(...componentErrors);
    if ((component as ComponentDefinition)?.name) {
      componentNames.add((component as ComponentDefinition).name);
    }
  }

  // Validate directive mappings
  const directives = lib.directiveMappings ?? [];
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

  if (!registry || typeof registry !== 'object') {
    return {
      valid: false,
      errors: [{
        type: 'component',
        name: 'unknown',
        message: 'Registry must be an object',
      }],
    };
  }

  const reg = registry as Partial<Registry>;

  // Validate all components
  const allComponents = reg.getAllComponents?.() ?? [];
  const componentNames = new Set<string>();

  for (const component of allComponents) {
    const componentErrors = validateComponent(component);
    errors.push(...componentErrors);
    if ((component as ComponentDefinition)?.name) {
      componentNames.add((component as ComponentDefinition).name);
    }
  }

  // Validate directive mappings
  const supportedDirectives = reg.getSupportedDirectives?.() ?? [];
  for (const directiveName of supportedDirectives) {
    const mapping = reg.getDirectiveMapping?.(directiveName);
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
