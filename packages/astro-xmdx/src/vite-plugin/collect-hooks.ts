/**
 * Collects and sorts plugin hooks by execution order.
 * @module vite-plugin/collect-hooks
 */

import type { XmdxPlugin, PluginHooks } from '../types.js';

/**
 * Collects hooks from an array of plugins, organizing them by hook type.
 */
export function collectHooks(plugins: XmdxPlugin[]): PluginHooks {
  const hooks: PluginHooks = {
    afterParse: [],
    beforeInject: [],
    beforeOutput: [],
    preprocess: [],
  };

  // Sort plugins: 'pre' first, then undefined, then 'post'
  const sorted = [...plugins].sort((a, b) => {
    const order: Record<string, number> = { pre: 0, undefined: 1, post: 2 };
    const aOrder = order[a.enforce ?? 'undefined'] ?? 1;
    const bOrder = order[b.enforce ?? 'undefined'] ?? 1;
    return aOrder - bOrder;
  });

  for (const plugin of sorted) {
    if (plugin.afterParse) hooks.afterParse.push(plugin.afterParse);
    if (plugin.beforeInject) hooks.beforeInject.push(plugin.beforeInject);
    if (plugin.beforeOutput) hooks.beforeOutput.push(plugin.beforeOutput);
    if (plugin.preprocess) hooks.preprocess.push(plugin.preprocess);
  }

  return hooks;
}
