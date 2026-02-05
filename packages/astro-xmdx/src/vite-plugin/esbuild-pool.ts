/**
 * Worker pool management for parallel esbuild processing.
 * Spawns multiple worker threads to handle large batches of JSX files.
 * Uses inline worker code to avoid Node.js TypeScript loading issues.
 * @module vite-plugin/esbuild-pool
 */

import { Worker } from 'node:worker_threads';
import os from 'node:os';

interface WorkerInput {
  entries: Array<{ entryName: string; id: string; jsx: string }>;
}

interface WorkerOutput {
  results: Array<{ id: string; code: string; map?: string }>;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Inline worker code as a string.
 * This avoids issues with Node.js not supporting TypeScript in node_modules.
 */
const WORKER_CODE = `
const { parentPort } = require('node:worker_threads');
const { build: esbuildBuild } = require('esbuild');
const path = require('node:path');

async function processChunk(input) {
  const entryMap = new Map();
  for (const entry of input.entries) {
    entryMap.set(entry.entryName, { id: entry.id, jsx: entry.jsx });
  }

  const results = [];
  const errors = [];

  try {
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
      plugins: [{
        name: 'xmdx-virtual-jsx-worker',
        setup(build) {
          build.onResolve({ filter: /^entry\\d+\\.jsx$/ }, args => ({
            path: args.path, namespace: 'xmdx-jsx'
          }));
          build.onResolve({ filter: /.*/ }, args => ({
            path: args.path, external: true
          }));
          build.onLoad({ filter: /.*/, namespace: 'xmdx-jsx' }, args => {
            const entry = entryMap.get(args.path);
            return entry ? { contents: entry.jsx, loader: 'jsx' } : null;
          });
        }
      }]
    });

    for (const output of result.outputFiles || []) {
      const basename = path.basename(output.path);
      if (basename.endsWith('.map')) continue;
      const entryName = basename.replace(/\\.js$/, '.jsx');
      const entry = entryMap.get(entryName);
      if (entry) {
        const mapOutput = result.outputFiles.find(o => o.path === output.path + '.map');
        results.push({ id: entry.id, code: output.text, map: mapOutput?.text });
      }
    }
  } catch (err) {
    for (const entry of input.entries) {
      errors.push({ id: entry.id, error: err.message });
    }
  }

  return { results, errors };
}

parentPort.on('message', async (input) => {
  const output = await processChunk(input);
  parentPort.postMessage(output);
});
`;

/**
 * Run esbuild in parallel using worker threads.
 * Splits the input into chunks and processes them concurrently.
 *
 * @param jsxInputs - Array of JSX inputs to transform
 * @returns Map of file IDs to transformed code and source maps
 */
export async function runParallelEsbuild(
  jsxInputs: Array<{ id: string; jsx: string }>
): Promise<Map<string, { code: string; map?: string }>> {
  // Use CPU count - 1, capped at 8 workers max
  const workerCount = Math.max(1, Math.min(os.cpus().length - 1, 8));
  const chunkSize = Math.ceil(jsxInputs.length / workerCount);

  // Split into chunks
  const chunks: Array<Array<{ entryName: string; id: string; jsx: string }>> = [];
  for (let i = 0; i < jsxInputs.length; i += chunkSize) {
    const chunk = jsxInputs.slice(i, i + chunkSize).map((input, j) => ({
      entryName: `entry${i + j}.jsx`,
      id: input.id,
      jsx: input.jsx,
    }));
    chunks.push(chunk);
  }

  // Run workers in parallel
  const workerPromises = chunks.map((chunk) => runWorker(chunk));
  const results = await Promise.all(workerPromises);

  // Merge results
  const merged = new Map<string, { code: string; map?: string }>();
  for (const result of results) {
    for (const item of result.results) {
      merged.set(item.id, { code: item.code, map: item.map });
    }
    // Log any errors (but don't fail the whole batch)
    for (const error of result.errors) {
      console.warn(`[xmdx] Worker esbuild error for ${error.id}: ${error.error}`);
    }
  }

  return merged;
}

/**
 * Run a single worker with the given entries using inline code.
 */
function runWorker(
  entries: Array<{ entryName: string; id: string; jsx: string }>
): Promise<WorkerOutput> {
  return new Promise<WorkerOutput>((resolve, reject) => {
    // Use eval mode to execute inline JavaScript code
    const worker = new Worker(WORKER_CODE, { eval: true });

    // 60 second timeout
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker timeout after 60s'));
    }, 60000);

    worker.on('message', (output: WorkerOutput) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(output);
    });

    worker.on('error', (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(err);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Worker exited with code ${code}`));
      }
    });

    worker.postMessage({ entries } satisfies WorkerInput);
  });
}
