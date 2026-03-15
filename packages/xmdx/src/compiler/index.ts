/**
 * Shared document compilation services.
 * These helpers own compile-strategy selection while target packages inject
 * framework-specific wrapping/rendering.
 * @module compiler
 */

import { parseJsonRecord } from '../ops/json.js';
import type { HeadingEntry, MdxImportHandlingOptions } from '../types.js';
import { stripFrontmatter } from '../utils/frontmatter.js';
import { extractImportStatements } from '../utils/imports.js';
import { detectProblematicMdxPatterns } from '../utils/mdx-detection.js';
import { deriveFileOptions } from '../utils/paths.js';

export interface CompilerWarning {
  line: number;
  message: string;
}

export interface CompilerDiagnostics {
  warnings?: CompilerWarning[];
}

export interface CompilerImportEntry {
  path: string;
}

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

export interface SharedCompileResult {
  code: string;
  map?: unknown;
  frontmatter_json?: string;
  headings?: HeadingEntry[];
  imports?: CompilerImportEntry[];
  diagnostics?: CompilerDiagnostics;
}

export interface SharedBatchError {
  code: string;
  message: string;
}

export interface SharedMdxBatchResult {
  results: Array<{
    id: string;
    result?: {
      code: string;
      frontmatterJson: string;
      headings: HeadingEntry[];
    };
    error?: SharedBatchError;
  }>;
}

export interface SharedCompiler {
  compile: (
    source: string,
    filename: string,
    options: { file?: string; url?: string }
  ) => SharedCompileResult;
  compileMdxBatch: (
    inputs: Array<{ id: string; source: string; filepath?: string }>,
    options: { continueOnError: boolean }
  ) => SharedMdxBatchResult;
}

export interface SharedBinding {
  parseBlocks: (
    source: string,
    options: { enable_directives: boolean }
  ) => { blocks: RenderBlockData[]; headings: HeadingEntry[] };
  parseFrontmatter: (source: string) => { frontmatter: Record<string, unknown> };
}

export interface MdxWrapInput {
  code: string;
  filename: string;
  frontmatter: Record<string, unknown>;
  headings: HeadingEntry[];
}

export interface BlockRenderInput {
  blocks: RenderBlockData[];
  filename: string;
  frontmatter: Record<string, unknown>;
  headings: HeadingEntry[];
  userImports: string[];
}

export interface CompileTargetAdapter {
  wrapMdxModule: (input: MdxWrapInput) => string;
  renderBlocksModule: (input: BlockRenderInput) => string;
}

export interface CompileDocumentOptions {
  filename: string;
  source: string;
  mdxOptions?: MdxImportHandlingOptions;
  rootDir?: string;
  useMdast: boolean;
  getCompiler: () => Promise<SharedCompiler>;
  loadBinding: () => Promise<SharedBinding>;
  target: CompileTargetAdapter;
}

export interface CompiledDocument {
  code: string;
  map?: unknown;
  frontmatter: Record<string, unknown>;
  headings: HeadingEntry[];
  imports: CompilerImportEntry[];
  diagnostics?: CompilerDiagnostics;
}

export type CompileDocumentResult =
  | {
      status: 'fallback';
      reason: string;
    }
  | {
      status: 'compiled';
      document: CompiledDocument;
    };

function parseFrontmatterJson(json: string | undefined): Record<string, unknown> {
  if (!json) {
    return {};
  }

  try {
    return parseJsonRecord(json);
  } catch {
    return {};
  }
}

export async function compileDocument(
  options: CompileDocumentOptions
): Promise<CompileDocumentResult> {
  const {
    filename,
    source,
    mdxOptions,
    rootDir,
    useMdast,
    getCompiler,
    loadBinding,
    target,
  } = options;

  const detection = detectProblematicMdxPatterns(source, mdxOptions, filename);
  if (detection.hasProblematicPatterns) {
    return {
      status: 'fallback',
      reason: detection.reason ?? 'Detected problematic MDX patterns',
    };
  }

  if (filename.endsWith('.mdx')) {
    const compiler = await getCompiler();
    const mdxBatchResult = compiler.compileMdxBatch(
      [{ id: filename, source }],
      { continueOnError: false }
    );
    const mdxResult = mdxBatchResult.results[0];

    if (mdxResult?.error) {
      throw new Error(`MDX compilation failed: ${mdxResult.error.message}`);
    }
    if (!mdxResult?.result) {
      throw new Error(`MDX compilation returned no result for ${filename}`);
    }

    const frontmatter = parseFrontmatterJson(mdxResult.result.frontmatterJson);
    const headings = mdxResult.result.headings ?? [];

    return {
      status: 'compiled',
      document: {
        code: target.wrapMdxModule({
          code: mdxResult.result.code,
          filename,
          frontmatter,
          headings,
        }),
        map: null,
        frontmatter,
        headings,
        imports: [],
      },
    };
  }

  if (useMdast) {
    const binding = await loadBinding();
    const userImports = extractImportStatements(source);
    const contentSource = stripFrontmatter(source);
    const parseResult = binding.parseBlocks(contentSource, {
      enable_directives: true,
    });
    const frontmatter = binding.parseFrontmatter(source).frontmatter || {};
    const headings = parseResult.headings;

    return {
      status: 'compiled',
      document: {
        code: target.renderBlocksModule({
          blocks: parseResult.blocks,
          filename,
          frontmatter,
          headings,
          userImports,
        }),
        map: null,
        frontmatter,
        headings,
        imports: [],
      },
    };
  }

  const compiler = await getCompiler();
  const result = compiler.compile(source, filename, deriveFileOptions(filename, rootDir));
  const frontmatter = parseFrontmatterJson(result.frontmatter_json);
  const headings = result.headings ?? [];

  return {
    status: 'compiled',
    document: {
      code: result.code,
      map: result.map,
      frontmatter,
      headings,
      imports: result.imports ?? [],
      diagnostics: result.diagnostics,
    },
  };
}
