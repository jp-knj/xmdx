/**
 * Type definitions for the Xmdx Vite plugin
 * @module vite-plugin/types
 */

import type { ComponentLibrary } from 'xmdx/registry';
import type { XmdxPlugin, MdxImportHandlingOptions } from '../types.js';

/**
 * Native NAPI binding interface for Xmdx compiler.
 */
export interface XmdxBinding {
  createCompiler: (config: Record<string, unknown>) => XmdxCompiler;
  XmdxCompiler?: new (config: Record<string, unknown>) => XmdxCompiler;
  parseBlocks: (
    source: string,
    options: { enable_directives: boolean }
  ) => ParseBlocksResult;
  parseFrontmatter: (source: string) => { frontmatter: Record<string, unknown> };
}

/**
 * Compiler instance for single-file and batch compilation.
 */
export interface XmdxCompiler {
  compile: (
    source: string,
    filename: string,
    options: { file?: string; url?: string }
  ) => CompileResult;
  compileBatch: (
    inputs: Array<{ id: string; source: string; filepath?: string }>,
    options: { continueOnError: boolean }
  ) => BatchCompileResult;
  compileBatchToModule: (
    inputs: Array<{ id: string; source: string; filepath?: string }>,
    options: { continueOnError: boolean }
  ) => ModuleBatchCompileResult;
  compileMdxBatch: (
    inputs: Array<{ id: string; source: string; filepath?: string }>,
    options: { continueOnError: boolean }
  ) => MdxBatchCompileResult;
}

/**
 * Result from single-file compilation.
 */
export interface CompileResult {
  code: string;
  map?: unknown;
  frontmatter_json?: string;
  headings?: Array<{ depth: number; slug: string; text: string }>;
  imports?: Array<{ path: string }>;
  diagnostics?: {
    warnings?: Array<{ line: number; message: string }>;
  };
}

/**
 * Export specification from Rust compiler.
 */
export interface ExportSpec {
  source: string;
  isDefault: boolean;
}

/**
 * Result from batch compilation.
 */
export interface BatchCompileResult {
  results: Array<{
    id: string;
    result?: {
      html: string;
      frontmatterJson?: string;
      headings?: Array<{ depth: number; slug: string; text: string }>;
      hoistedImports?: Array<{ source: string; kind: string }>;
      hoistedExports?: ExportSpec[];
      hasUserDefaultExport?: boolean;
    };
  }>;
  stats: {
    succeeded: number;
    total: number;
    processingTimeMs: number;
  };
}

/**
 * Structured batch error with machine-readable code and human-readable message.
 */
export interface BatchError {
  code: string;
  message: string;
}

/**
 * Result from batch compilation to complete Astro modules.
 * Unlike BatchCompileResult which returns IR, this returns complete module code.
 */
export interface ModuleBatchCompileResult {
  results: Array<{
    id: string;
    result?: {
      /** Complete Astro module code ready for esbuild */
      code: string;
      /** Source map (if available) */
      map?: unknown;
      /** Frontmatter as JSON string */
      frontmatterJson: string;
      /** Extracted headings */
      headings: Array<{ depth: number; slug: string; text: string }>;
      /** Imported modules */
      imports: Array<{ path: string; kind: string }>;
      /** Parse diagnostics */
      diagnostics?: {
        warnings?: Array<{ line: number; message: string }>;
      };
    };
    error?: BatchError;
  }>;
  stats: {
    succeeded: number;
    total: number;
    failed: number;
    processingTimeMs: number;
  };
}

/**
 * Result from MDX batch compilation using mdxjs-rs.
 */
export interface MdxBatchCompileResult {
  results: Array<{
    id: string;
    result?: {
      /** Compiled JavaScript code (full module with MDXContent) */
      code: string;
      /** Frontmatter as JSON string */
      frontmatterJson: string;
      /** Extracted headings */
      headings: Array<{ depth: number; slug: string; text: string }>;
    };
    error?: BatchError;
  }>;
  stats: {
    succeeded: number;
    total: number;
    failed: number;
    processingTimeMs: number;
  };
}

/**
 * Result from parsing blocks.
 */
/** A render block from the Rust compiler. */
export interface RenderBlockData {
  type: 'html' | 'component' | 'code';
  content?: string;
  name?: string;
  props?: Record<string, unknown>;
  slotChildren?: RenderBlockData[];
  code?: string;
  lang?: string;
  meta?: string;
}

export interface ParseBlocksResult {
  blocks: RenderBlockData[];
  headings: Array<{ depth: number; slug: string; text: string }>;
}

/**
 * Plugin options for the Xmdx Vite plugin.
 */
export interface XmdxPluginOptions {
  include?: (id: string) => boolean;
  libraries?: ComponentLibrary[];
  starlightComponents?: boolean | { enabled?: boolean; components?: string[]; module?: string };
  expressiveCode?: boolean | { enabled?: boolean; component?: string; module?: string };
  compiler?: {
    jsx?: {
      code_sample_components?: string[];
    };
  };
  plugins?: XmdxPlugin[];
  binding?: XmdxBinding;
  mdx?: MdxImportHandlingOptions;
  /**
   * Set by the integration when Starlight is auto-detected at config time.
   * Avoids re-deriving Starlight status from the libraries array in the vite plugin.
   */
  starlightDetected?: boolean;
  /**
   * Enable disk caching for compilation results.
   * When enabled, compiled results are persisted to `.xmdx-cache/` for faster subsequent builds.
   * Can also be enabled via XMDX_DISK_CACHE=1 environment variable.
   * @default false
   */
  cache?: boolean;
}
