/**
 * Unified JSX transform abstraction.
 * Detects Vite version and uses transformWithOxc (Vite 8+) when available,
 * falling back to transformWithEsbuild (Vite 7 and earlier).
 * @module vite-plugin/jsx-transform
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import type { SourceMapInput } from 'rollup';
import { ESBUILD_JSX_CONFIG, OXC_JSX_CONFIG } from '../constants.js';
import { asBinding, asSourceMap, asViteWithOxc } from '../ops/type-narrowing.js';
import type { OxcTransformModule, EsbuildModule, EsbuildOutputFile } from '../ops/type-narrowing.js';

// Use createRequire to bypass Vite's SSR module runner, which may be
// closed between build phases causing "Vite module runner has been closed".
const _require = createRequire(import.meta.url);

interface TransformResult {
  code: string;
  map?: SourceMapInput;
}

type TransformFn = (code: string, filename: string, options: Record<string, unknown>) => Promise<TransformResult>;

let resolvedTransform: TransformFn | null = null;
let resolvedBatchTransform: BatchTransformFn | null = null;

async function resolveTransformFn(): Promise<TransformFn> {
  if (resolvedTransform) return resolvedTransform;

  let vite: typeof import('vite');
  try {
    vite = asBinding<typeof import('vite')>(_require('vite'));
  } catch {
    vite = await import('vite');
  }
  const viteWithOxc = asViteWithOxc(vite);

  // Try Vite 8+ transformWithOxc first
  if (typeof viteWithOxc.transformWithOxc === 'function') {
    const transformWithOxc = viteWithOxc.transformWithOxc;

    const fn: TransformFn = async (code, filename, _options) => {
      const result = await transformWithOxc(code, filename, OXC_JSX_CONFIG);
      return {
        code: result.code,
        map: asSourceMap(result.map),
      };
    };
    resolvedTransform = fn;
    return fn;
  }

  // Fallback to transformWithEsbuild
  const { transformWithEsbuild } = vite;
  const fn: TransformFn = async (code, filename, _options) => {
    const result = await transformWithEsbuild(code, filename, ESBUILD_JSX_CONFIG);
    return {
      code: result.code,
      map: asSourceMap(result.map),
    };
  };
  resolvedTransform = fn;
  return fn;
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

function resolveBatchTransformFn(): BatchTransformFn {
  if (resolvedBatchTransform) return resolvedBatchTransform;

  // Try oxc-transform npm package first
  try {
    const oxcTransform = asBinding<OxcTransformModule>(_require('oxc-transform'));
    if (oxcTransform && typeof oxcTransform.transform === 'function') {
      const oxcTransformFn = oxcTransform.transform;

      resolvedBatchTransform = (inputs) => {
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
            map: typeof result.map === 'string' ? result.map : undefined,
          });
        }
        return Promise.resolve(results);
      };
      return resolvedBatchTransform;
    }
  } catch {
    // oxc-transform not available
  }

  // Fallback: use esbuild build API
  resolvedBatchTransform = (inputs) => {
    return esbuildBatchFallback(inputs);
  };
  return resolvedBatchTransform;
}

async function esbuildBatchFallback(
  inputs: BatchTransformInput[]
): Promise<Map<string, { code: string; map?: SourceMapInput }>> {
  const { build: esbuildBuild } = asBinding<EsbuildModule>(_require('esbuild'));

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
        setup(build: {
          onResolve: (opts: { filter: RegExp }, cb: (args: { path: string }) => { path: string; namespace?: string; external?: boolean } | null) => void;
          onLoad: (opts: { filter: RegExp; namespace?: string }, cb: (args: { path: string }) => { contents: string; loader: string } | null) => void;
        }) {
          build.onResolve({ filter: /^entry\d+\.jsx$/ }, (args: { path: string }) => {
            return { path: args.path, namespace: 'xmdx-jsx' };
          });
          build.onResolve({ filter: /.*/ }, (args: { path: string }) => {
            return { path: args.path, external: true };
          });
          build.onLoad({ filter: /.*/, namespace: 'xmdx-jsx' }, (args: { path: string }) => {
            const entry = entryMap.get(args.path);
            return entry ? { contents: entry.jsx, loader: 'jsx' } : null;
          });
        },
      },
    ],
  });

  const results = new Map<string, { code: string; map?: SourceMapInput }>();
  for (const output of result.outputFiles) {
    const basename = path.basename(output.path);
    if (basename.endsWith('.map')) continue;
    const entryName = basename.replace(/\.js$/, '.jsx');
    const entry = entryMap.get(entryName);
    if (entry) {
      const mapOutput = result.outputFiles.find((o: EsbuildOutputFile) => o.path === output.path + '.map');
      results.set(entry.id, {
        code: output.text,
        map: mapOutput?.text,
      });
    }
  }

  return results;
}

/**
 * Batch-transform JSX files to JS.
 * Uses oxc-transform when available, esbuild.build() otherwise.
 */
export function batchTransformJsx(
  inputs: BatchTransformInput[]
): Promise<Map<string, { code: string; map?: SourceMapInput }>> {
  const batchTransform = resolveBatchTransformFn();
  return batchTransform(inputs);
}

/**
 * Check if OXC-based transform is available (for logging/diagnostics).
 */
export function isOxcAvailable(): boolean {
  try {
    const vite = asBinding<typeof import('vite')>(_require('vite'));
    return typeof asViteWithOxc(vite).transformWithOxc === 'function';
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
