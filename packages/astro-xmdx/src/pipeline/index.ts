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
 * import { createPipeline, createContext } from 'astro-xmdx/pipeline';
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
export { pipe, when, tap } from './pipe.js';

// Pipeline orchestrator for creating standard and custom pipelines
export { createPipeline, createCustomPipeline, createContext } from './orchestrator.js';

// Type exports
export type { TransformContext, TransformConfig, Transform, PipelineOptions } from './types.js';
