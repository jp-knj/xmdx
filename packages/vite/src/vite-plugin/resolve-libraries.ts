/**
 * Resolves component library configuration from plugin options.
 * @module vite-plugin/resolve-libraries
 */

import {
  createRegistry,
  starlightLibrary,
  astroLibrary,
  type ComponentLibrary,
  type Registry,
} from 'xmdx/registry';
import type { XmdxPluginOptions } from './types.js';

/**
 * Resolves library configuration from options.
 * Supports both new `libraries` API and legacy `starlightComponents` option.
 */
export function resolveLibraries(options: XmdxPluginOptions): {
  libraries: ComponentLibrary[];
  registry: Registry;
} {
  // New API: explicit libraries array
  if (Array.isArray(options.libraries)) {
    const registry = createRegistry(options.libraries);
    return { libraries: options.libraries, registry };
  }

  // Legacy API: derive libraries from starlightComponents option
  const libraries: ComponentLibrary[] = [astroLibrary];

  // Add Starlight library when starlightComponents is set OR expressiveCode is enabled.
  // ExpressiveCode in Starlight projects uses @astrojs/starlight/components for Code.
  if (options.starlightComponents || options.expressiveCode) {
    libraries.push(starlightLibrary);
  }

  const registry = createRegistry(libraries);
  return { libraries, registry };
}
