/**
 * Configuration resolution utilities
 * @module utils/config
 */

import type { Registry } from 'xmdx/registry';
import { starlightLibrary, expressiveCodeLibrary } from 'xmdx/registry';

/**
 * Resolved ExpressiveCode configuration.
 */
export interface ExpressiveCodeConfig {
  /** Component name (e.g., "Code" or "ExpressiveCode") */
  component: string;
  /** Module to import from */
  moduleId: string;
}

/**
 * ExpressiveCode user configuration input.
 */
export interface ExpressiveCodeUserConfig {
  /** Whether enabled */
  enabled?: boolean;
  /** Component name (internal key) */
  component?: string;
  /** Module path (internal key) */
  module?: string;
  /** Component name (public API key) */
  componentName?: string;
  /** Module path (public API key) */
  importSource?: string;
}

/**
 * Resolve ExpressiveCode configuration.
 * Normalizes boolean/object config into consistent object format.
 *
 * @example
 * resolveExpressiveCodeConfig(true)
 * // => { component: "ExpressiveCode", moduleId: "astro-expressive-code/components" }
 *
 * resolveExpressiveCodeConfig({ component: "Code", module: "my-module" })
 * // => { component: "Code", moduleId: "my-module" }
 */
export function resolveExpressiveCodeConfig(
  config: boolean | ExpressiveCodeUserConfig | null | undefined,
  registry?: Registry
): ExpressiveCodeConfig | null {
  if (!config) return null;

  // Get defaults from registry if available, otherwise use library preset
  let defaultComponent = expressiveCodeLibrary.components[0]?.name ?? 'Code';
  let defaultModuleId = expressiveCodeLibrary.defaultModulePath;

  if (registry) {
    // Prefer Starlight's Code component when available. In Starlight projects,
    // this keeps imports stable (`@astrojs/starlight/components`) and avoids
    // requiring consumers to resolve `astro-expressive-code/components` directly.
    const starlightCode = registry
      .getComponentsByModule(starlightLibrary.defaultModulePath)
      .find((c) => c.name === 'Code');

    if (starlightCode) {
      defaultComponent = starlightCode.name;
      defaultModuleId = starlightCode.modulePath;
    } else {
      const ecComponents = registry.getComponentsByModule(expressiveCodeLibrary.defaultModulePath);
      if (ecComponents.length > 0 && ecComponents[0]) {
        defaultComponent = ecComponents[0].name;
        defaultModuleId = ecComponents[0].modulePath;
      }
    }
  }

  if (config === true) {
    return {
      component: defaultComponent,
      moduleId: defaultModuleId,
    };
  }
  if (typeof config === 'object') {
    if (config.enabled === false) return null;
    const configuredComponent = config.component ?? config.componentName;
    const configuredModule = config.module ?? config.importSource;
    const component =
      typeof configuredComponent === 'string' && configuredComponent.length > 0
        ? configuredComponent
        : defaultComponent;
    const moduleId =
      typeof configuredModule === 'string' && configuredModule.length > 0
        ? configuredModule
        : defaultModuleId;
    return { component, moduleId };
  }
  return null;
}

/**
 * Resolved Starlight configuration.
 */
export interface StarlightConfig {
  /** Component names to inject */
  components: string[];
  /** Module to import from */
  moduleId: string;
}

/**
 * Starlight user configuration input.
 */
export interface StarlightUserConfig {
  /** Component names */
  components?: string[];
  /** Module path */
  module?: string;
}

/**
 * Resolve Starlight configuration.
 * Normalizes boolean/object config into consistent object format.
 *
 * @example
 * resolveStarlightConfig(true)
 * // => { components: ["Aside", "Tabs", ...], moduleId: "@astrojs/starlight/components" }
 *
 * resolveStarlightConfig({ components: ["Aside"], module: "my-module" })
 * // => { components: ["Aside"], moduleId: "my-module" }
 */
export function resolveStarlightConfig(
  config: boolean | StarlightUserConfig | null | undefined,
  registry?: Registry
): StarlightConfig | null {
  if (!config) return null;

  // Get defaults from registry if available, otherwise use library preset
  let defaultComponents = starlightLibrary.components.map((c) => c.name);
  let defaultModuleId = starlightLibrary.defaultModulePath;

  if (registry) {
    const slComponents = registry.getComponentsByModule(starlightLibrary.defaultModulePath);
    if (slComponents.length > 0 && slComponents[0]) {
      defaultComponents = slComponents.map((c) => c.name);
      defaultModuleId = slComponents[0].modulePath;
    }
  }

  if (config === true) {
    return {
      components: defaultComponents,
      moduleId: defaultModuleId,
    };
  }
  if (typeof config === 'object') {
    const components = Array.isArray(config.components)
      ? config.components
      : defaultComponents;
    const moduleId =
      typeof config.module === 'string' && config.module.length > 0
        ? config.module
        : defaultModuleId;
    return { components, moduleId };
  }
  return null;
}
