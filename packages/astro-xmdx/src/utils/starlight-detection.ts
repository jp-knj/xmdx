/**
 * Starlight auto-detection and component override utilities.
 * @module utils/starlight-detection
 */

import path from 'node:path';
import type { ComponentLibrary, ComponentDefinition } from 'xmdx/registry';
import { isRecord } from '../ops/type-narrowing.js';
import { normalizePath } from 'xmdx/utils/paths';

/**
 * Result of finding the Starlight integration in an Astro config.
 */
export interface StarlightDetectionResult {
  integration: unknown;
  config: unknown;
  componentOverrides: Map<string, string>;
}

/**
 * Finds the Starlight integration in an Astro integrations array.
 * Returns the integration, its resolved config, and any component overrides,
 * or `null` if Starlight is not present.
 */
export function findStarlightIntegration(
  integrations: unknown[] | undefined
): StarlightDetectionResult | null {
  if (!integrations) return null;

  const integration = integrations.find((i) => isRecord(i) && i.name === '@astrojs/starlight');
  if (!integration) return null;

  const config = extractStarlightConfig(integration);
  const componentOverrides = getStarlightComponentOverrides(config);

  return { integration, config, componentOverrides };
}

/**
 * Extracts the Starlight user config from the integration object.
 * Starlight stores it in one of several locations depending on version.
 */
function extractStarlightConfig(integration: unknown): unknown {
  if (!isRecord(integration)) return null;
  if ('config' in integration && integration.config != null) return integration.config;
  if ('options' in integration && integration.options != null) return integration.options;
  if (isRecord(integration._dependencies) && integration._dependencies.starlightConfig != null) {
    return integration._dependencies.starlightConfig;
  }
  return null;
}

/**
 * Extracts Starlight component overrides from a resolved Starlight config.
 * Starlight stores user overrides as `{ components: { ComponentName: 'path/to/Override.astro' } }`.
 * Returns a map of override name -> override path for content-affecting components.
 */
export function getStarlightComponentOverrides(
  starlightConfig: unknown
): Map<string, string> {
  const overrides = new Map<string, string>();

  if (!isRecord(starlightConfig) || !isRecord(starlightConfig.components)) {
    return overrides;
  }

  for (const [name, importPath] of Object.entries(starlightConfig.components)) {
    if (typeof importPath === 'string' && importPath.length > 0) {
      overrides.set(name, importPath);
    }
  }
  return overrides;
}

/**
 * Applies Starlight component overrides to a library's component list.
 * Returns a new library with overridden import paths where applicable.
 *
 * When `rootDir` is provided, relative override paths (e.g. `./src/CustomAside.astro`)
 * are resolved to absolute paths. This is necessary because the generated import
 * statements are emitted inside virtual modules that Vite resolves relative to
 * the MDX file directory, not the project root.
 */
export function applyStarlightOverrides(
  library: ComponentLibrary,
  overrides: Map<string, string>,
  rootDir?: string
): ComponentLibrary {
  if (overrides.size === 0) return library;

  const updatedComponents: ComponentDefinition[] = library.components.map((comp) => {
    const overridePath = overrides.get(comp.name);
    if (overridePath) {
      // Resolve relative paths against rootDir so they work from any MDX file location
      const resolvedPath = rootDir && (overridePath.startsWith('./') || overridePath.startsWith('../'))
        ? normalizePath(path.resolve(rootDir, overridePath))
        : overridePath;
      return {
        ...comp,
        modulePath: resolvedPath,
        exportType: 'default' as const,
      };
    }
    return comp;
  });

  return {
    ...library,
    components: updatedComponents,
  };
}
