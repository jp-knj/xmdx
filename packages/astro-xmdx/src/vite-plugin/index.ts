/** Barrel re-exports — the plugin factory lives in ../vite-plugin.ts */

// Re-export types
export type {
  XmdxBinding,
  XmdxCompiler,
  CompileResult,
  BatchCompileResult,
  ParseBlocksResult,
  XmdxPluginOptions,
} from './types.js';

export { DEFAULT_EXTENSIONS } from '../utils/paths.js';

// Re-export binding loader
export { loadXmdxBinding, resetBindingPromise, ENABLE_SHIKI, IS_MDAST } from './binding-loader.js';

// Re-export JSX module utilities
export { compileFallbackModule } from './fallback/compile.js';

// Re-export directive rewriter
export { rewriteFallbackDirectives, injectFallbackImports } from './fallback/directive-rewriter.js';

// Re-export config normalization utilities
export { normalizeStarlightComponents } from './normalize-config.js';
export type { NormalizedStarlightComponents } from './normalize-config.js';

// Re-export shiki highlighter
export { createShikiHighlighter } from './highlighting/shiki-highlighter.js';
export type { ShikiHighlighter } from '../transforms/shiki.js';
