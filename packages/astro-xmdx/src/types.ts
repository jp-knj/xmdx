/**
 * Type definitions for Xmdx plugin system
 * @module types
 */

import type { Registry } from 'xmdx/registry';
import type { ExpressiveCodeConfig, StarlightUserConfig } from './utils/config.js';
import type { ShikiHighlighter } from './transforms/shiki.js';

/**
 * Configuration available to transforms.
 */
export interface TransformConfig {
  /** ExpressiveCode configuration or null if disabled */
  expressiveCode: ExpressiveCodeConfig | null;
  /** Starlight components configuration */
  starlightComponents: boolean | StarlightUserConfig;
  /** Shiki highlighter function or null if disabled */
  shiki: ShikiHighlighter | null;
}

/**
 * Transform context passed through the pipeline.
 * Contains the current code state and metadata needed by transforms.
 */
export interface TransformContext {
  /** Current JSX code being transformed */
  code: string;
  /** Original markdown source */
  source: string;
  /** Source file path */
  filename: string;
  /** Parsed frontmatter object */
  frontmatter: Record<string, unknown>;
  /** Extracted headings from the document */
  headings: Array<{ depth: number; slug: string; text: string }>;
  /** Component registry for import resolution */
  registry?: Registry;
  /** Plugin configuration for transforms */
  config: TransformConfig;
}

/**
 * A Xmdx plugin that can hook into the transform pipeline.
 */
export interface XmdxPlugin {
  /** Plugin identifier for debugging and ordering */
  name: string;
  /** Execution order: 'pre' runs before built-in transforms, 'post' runs after */
  enforce?: 'pre' | 'post';
  /** Hook called after markdown is parsed to JSX, before any transforms */
  afterParse?: (ctx: TransformContext) => TransformContext | Promise<TransformContext>;
  /** Hook called before component injection transforms */
  beforeInject?: (ctx: TransformContext) => TransformContext | Promise<TransformContext>;
  /** Hook called after all transforms, before esbuild */
  beforeOutput?: (ctx: TransformContext) => TransformContext | Promise<TransformContext>;
  /** Hook to preprocess raw markdown source before parsing */
  preprocess?: (source: string, filename: string) => string;
}

/**
 * Collected hooks from plugins, organized by hook type.
 */
export interface PluginHooks {
  afterParse: Array<(ctx: TransformContext) => TransformContext | Promise<TransformContext>>;
  beforeInject: Array<(ctx: TransformContext) => TransformContext | Promise<TransformContext>>;
  beforeOutput: Array<(ctx: TransformContext) => TransformContext | Promise<TransformContext>>;
  preprocess: Array<(source: string, filename: string) => string>;
}

/**
 * Options for handling MDX import/export statements.
 * Allows fine-grained control over which imports are allowed vs trigger fallback.
 */
export interface MdxImportHandlingOptions {
  /**
   * Import sources to allow. Files importing only from these sources
   * won't trigger fallback to @mdx-js/mdx.
   * Supports glob patterns (e.g., '~/components/*').
   * @example ['@astrojs/starlight/components', '~/components/*']
   */
  allowImports?: string[];
  /**
   * Ignore import/export patterns inside code fences when detecting fallback.
   * @default true
   */
  ignoreCodeFences?: boolean;
}

// Re-export types from submodules for convenience
export type { ExpressiveCodeConfig, StarlightUserConfig } from './utils/config.js';
export type { ShikiHighlighter } from './transforms/shiki.js';
