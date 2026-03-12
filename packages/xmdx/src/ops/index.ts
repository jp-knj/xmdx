export { parseJson, parseJsonRecord, parseJsonString } from './json.js';
export { toError } from './errors.js';
export {
  isRecord,
  nameOf,
  directiveNameOf,
  asModule,
  asBinding,
  asRecord,
  asFunction,
  asSourceMap,
  asMutableConfig,
  asStringArray,
  asHastChildren,
  asShikiLanguage,
  asOptionalString,
} from './casts.js';
export {
  asMutableViteConfig,
  asViteWithOxc,
  asVitePlugin,
} from './vite.js';
export type {
  OxcTransformResult,
  OxcTransformModule,
  EsbuildOutputFile,
  EsbuildBuildResult,
  EsbuildModule,
} from './vite.js';
