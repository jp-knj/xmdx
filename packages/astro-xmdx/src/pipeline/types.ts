/**
 * Type definitions for Xmdx transform pipeline
 * @module pipeline/types
 */

import type { Registry } from 'xmdx/registry';
import type { ExpressiveCodeConfig, StarlightUserConfig } from '../utils/config.js';
import type { ShikiHighlighter } from '../transforms/shiki.js';

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
 * A transform function that takes a context and returns a modified context.
 * Can be synchronous or asynchronous.
 */
export type Transform = (ctx: TransformContext) => TransformContext | Promise<TransformContext>;

/**
 * Options for creating a standard Xmdx pipeline with hooks.
 */
export interface PipelineOptions {
  /** Hooks to run after parsing, before built-in transforms */
  afterParse?: Transform[];
  /** Hooks to run before component injection */
  beforeInject?: Transform[];
  /** Hooks to run after all transforms, before output */
  beforeOutput?: Transform[];
}
