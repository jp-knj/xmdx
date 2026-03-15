/**
 * Type definitions for Xmdx transform pipeline
 * @module pipeline/types
 */

import type { TransformConfig,TransformContext } from '../types.js';

// Re-export core types so consumers can import from pipeline
export type { TransformConfig,TransformContext };

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
