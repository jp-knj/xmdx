/**
 * Starlight library preset for component registry.
 * @module registry/presets/starlight
 */

import type { ComponentLibrary } from '../types.js';

export const starlightLibrary: ComponentLibrary = {
  id: 'starlight',
  name: 'Astro Starlight',
  defaultModulePath: '@astrojs/starlight/components',
  components: [
    { name: 'Aside', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'Tabs', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'TabItem', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'Steps', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'FileTree', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'CardGrid', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'LinkCard', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'LinkButton', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'Card', modulePath: '@astrojs/starlight/components', exportType: 'named' },
    { name: 'Code', modulePath: '@astrojs/starlight/components', exportType: 'named' },
  ],
  directiveMappings: [
    { directive: 'note', component: 'Aside', injectProps: { type: { source: 'directive_name' } } },
    { directive: 'tip', component: 'Aside', injectProps: { type: { source: 'directive_name' } } },
    { directive: 'info', component: 'Aside', injectProps: { type: { source: 'directive_name' } } },
    { directive: 'caution', component: 'Aside', injectProps: { type: { source: 'directive_name' } } },
    { directive: 'warning', component: 'Aside', injectProps: { type: { source: 'directive_name' } } },
    { directive: 'danger', component: 'Aside', injectProps: { type: { source: 'directive_name' } } },
  ],
  slotNormalizations: [
    { component: 'Steps', strategy: 'wrap_in_ol' },
    { component: 'FileTree', strategy: 'wrap_in_ul', wrapperClass: 'filetree' },
  ],
};
