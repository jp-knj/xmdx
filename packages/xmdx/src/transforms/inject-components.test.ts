import { runInjectComponentsTests } from '../../../../test/shared/transforms/inject-components-spec.ts';
import {
  injectComponentImports,
  injectStarlightComponents,
  injectAstroComponents,
  injectComponentImportsFromRegistry,
} from './inject-components.js';
import { createRegistry, starlightLibrary, astroLibrary } from 'xmdx/registry';

const registry = createRegistry([starlightLibrary, astroLibrary]);

runInjectComponentsTests({
  injectComponentImports,
  injectStarlightComponents,
  injectAstroComponents,
  injectComponentImportsFromRegistry,
  registry,
  astroComponentsModule: astroLibrary.defaultModulePath,
});
