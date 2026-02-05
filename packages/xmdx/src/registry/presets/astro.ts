/**
 * Astro core library preset for component registry.
 * @module registry/presets/astro
 */

import type { ComponentLibrary } from '../types.js';

export const astroLibrary: ComponentLibrary = {
  id: 'astro',
  name: 'Astro Core',
  defaultModulePath: 'astro/components',
  components: [
    { name: 'Code', modulePath: 'astro/components', exportType: 'named' },
  ],
  directiveMappings: [],
};
