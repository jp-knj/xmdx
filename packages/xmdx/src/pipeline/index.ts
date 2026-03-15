/**
 * Xmdx transform pipeline - public API
 *
 * This module provides tools for creating and composing transform pipelines.
 * It can be used standalone (without Vite) for processing markdown/MDX files.
 *
 * @module pipeline
 *
 * @example
 * // Standalone usage (without Vite)
 * import { createPipeline, createContext } from 'xmdx/pipeline';
 * import { compile } from 'some-markdown-compiler';
 *
 * const pipeline = createPipeline({
 *   afterParse: [myCustomTransform],
 * });
 *
 * const compiled = compile(markdownSource);
 * const ctx = createContext({
 *   code: compiled.code,
 *   source: markdownSource,
 *   filename: '/path/to/file.md',
 *   frontmatter: compiled.frontmatter,
 *   headings: compiled.headings,
 * });
 *
 * const result = await pipeline(ctx);
 * console.log(result.code);
 */

// Pipe utilities for composing transforms
export { pipe, tap,when } from './pipe.js';

// Pipeline orchestrator for creating standard and custom pipelines
export { createContext,createCustomPipeline, createPipeline } from './orchestrator.js';

// Type exports
export type { PipelineOptions,Transform, TransformConfig, TransformContext } from './types.js';
