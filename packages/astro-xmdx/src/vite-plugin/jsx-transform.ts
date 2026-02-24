/**
 * Unified JSX transform abstraction.
 * Detects Vite version and uses transformWithOxc (Vite 8+) when available,
 * falling back to transformWithEsbuild (Vite 7 and earlier).
 * @module vite-plugin/jsx-transform
 */

import type { SourceMapInput } from 'rollup';
import { ESBUILD_JSX_CONFIG, OXC_JSX_CONFIG } from '../constants.js';

interface TransformResult {
  code: string;
  map?: SourceMapInput;
}

type TransformFn = (code: string, filename: string, options: Record<string, unknown>) => Promise<TransformResult>;

let resolvedTransform: TransformFn | null = null;
let resolvedBatchTransform: BatchTransformFn | null = null;

async function resolveTransformFn(): Promise<TransformFn> {
  if (resolvedTransform) return resolvedTransform;

  // Try Vite 8+ transformWithOxc first
  try {
    const vite = await import('vite');
    if ('transformWithOxc' in vite && typeof vite.transformWithOxc === 'function') {
      const transformWithOxc = vite.transformWithOxc as (
        code: string,
        filename: string,
        options?: Record<string, unknown>
      ) => Promise<{ code: string; map?: unknown }>;

      resolvedTransform = async (code, filename, _options) => {
        const result = await transformWithOxc(code, filename, OXC_JSX_CONFIG);
        return {
          code: result.code,
          map: result.map as SourceMapInput | undefined,
        };
      };
      return resolvedTransform;
    }
  } catch {
    // transformWithOxc not available
  }

  // Fallback to transformWithEsbuild
  const { transformWithEsbuild } = await import('vite');
  resolvedTransform = async (code, filename, _options) => {
    const result = await transformWithEsbuild(code, filename, ESBUILD_JSX_CONFIG);
    return {
      code: result.code,
      map: result.map as SourceMapInput | undefined,
    };
  };
  return resolvedTransform;
}

/**
 * Transform JSX code to JS using the best available engine.
 * Uses transformWithOxc on Vite 8+, transformWithEsbuild otherwise.
 */
export async function transformJsx(
  code: string,
  filename: string
): Promise<TransformResult> {
  const transform = await resolveTransformFn();
  return transform(code, filename, {});
}

// ── Batch transform (for build-time) ─────────────────────────────────────

interface BatchTransformInput {
  id: string;
  jsx: string;
}

type BatchTransformFn = (
  inputs: BatchTransformInput[]
) => Promise<Map<string, { code: string; map?: SourceMapInput }>>;

async function resolveBatchTransformFn(): Promise<BatchTransformFn> {
  if (resolvedBatchTransform) return resolvedBatchTransform;

  // Try oxc-transform npm package first
  try {
    // Dynamic import with string indirection to avoid TS module resolution errors
    const moduleName = 'oxc-transform';
    const oxcTransform = await (import(moduleName) as Promise<Record<string, unknown>>);
    if (oxcTransform && typeof oxcTransform.transform === 'function') {
      const oxcTransformFn = oxcTransform.transform as (
        filename: string,
        code: string,
        options?: Record<string, unknown>
      ) => { code: string; map?: unknown; errors?: unknown[] };

      resolvedBatchTransform = async (inputs) => {
        const results = new Map<string, { code: string; map?: SourceMapInput }>();
        for (const input of inputs) {
          const result = oxcTransformFn(`${input.id}.jsx`, input.jsx, {
            lang: 'jsx',
            sourcemap: true,
            jsx: {
              runtime: 'classic',
              pragma: '_jsx',
              pragmaFrag: '_Fragment',
            },
          });
          results.set(input.id, {
            code: result.code,
            map: typeof result.map === 'string' ? result.map as SourceMapInput : undefined,
          });
        }
        return results;
      };
      return resolvedBatchTransform;
    }
  } catch {
    // oxc-transform not available
  }

  // Fallback: use esbuild build API
  resolvedBatchTransform = async (inputs) => {
    return esbuildBatchFallback(inputs);
  };
  return resolvedBatchTransform;
}

async function esbuildBatchFallback(
  inputs: BatchTransformInput[]
): Promise<Map<string, { code: string; map?: SourceMapInput }>> {
  const { build: esbuildBuild } = await import('esbuild');
  const path = await import('node:path');

  const entryMap = new Map<string, { id: string; jsx: string }>();
  for (let i = 0; i < inputs.length; i++) {
    const entry = `entry${i}.jsx`;
    const input = inputs[i]!;
    entryMap.set(entry, { id: input.id, jsx: input.jsx });
  }

  const result = await esbuildBuild({
    write: false,
    bundle: false,
    format: 'esm',
    sourcemap: 'external',
    loader: { '.jsx': 'jsx' },
    jsx: 'transform',
    jsxFactory: '_jsx',
    jsxFragment: '_Fragment',
    entryPoints: Array.from(entryMap.keys()),
    outdir: 'out',
    plugins: [
      {
        name: 'xmdx-virtual-jsx',
        setup(build) {
          build.onResolve({ filter: /^entry\d+\.jsx$/ }, (args) => {
            return { path: args.path, namespace: 'xmdx-jsx' };
          });
          build.onResolve({ filter: /.*/ }, (args) => {
            return { path: args.path, external: true };
          });
          build.onLoad({ filter: /.*/, namespace: 'xmdx-jsx' }, (args) => {
            const entry = entryMap.get(args.path);
            return entry ? { contents: entry.jsx, loader: 'jsx' } : null;
          });
        },
      },
    ],
  });

  const results = new Map<string, { code: string; map?: SourceMapInput }>();
  for (const output of result.outputFiles || []) {
    const basename = path.basename(output.path);
    if (basename.endsWith('.map')) continue;
    const entryName = basename.replace(/\.js$/, '.jsx');
    const entry = entryMap.get(entryName);
    if (entry) {
      const mapOutput = result.outputFiles?.find((o) => o.path === output.path + '.map');
      results.set(entry.id, {
        code: output.text,
        map: mapOutput?.text as SourceMapInput | undefined,
      });
    }
  }

  return results;
}

/**
 * Batch-transform JSX files to JS.
 * Uses oxc-transform when available, esbuild.build() otherwise.
 */
export async function batchTransformJsx(
  inputs: BatchTransformInput[]
): Promise<Map<string, { code: string; map?: SourceMapInput }>> {
  const batchTransform = await resolveBatchTransformFn();
  return batchTransform(inputs);
}

/**
 * Check if OXC-based transform is available (for logging/diagnostics).
 */
export async function isOxcAvailable(): Promise<boolean> {
  try {
    const vite = await import('vite');
    return 'transformWithOxc' in vite && typeof vite.transformWithOxc === 'function';
  } catch {
    return false;
  }
}

/**
 * Reset cached transform functions (for testing).
 */
export function resetTransformCache(): void {
  resolvedTransform = null;
  resolvedBatchTransform = null;
}
