/**
 * Native binding loader for Xmdx
 * @module vite-plugin/binding-loader
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import type { XmdxBinding } from './types.js';

let bindingPromise: Promise<XmdxBinding> | undefined;
const DEBUG_BINDING = process.env.XMDX_DEBUG_BINDING === '1';

/**
 * Environment flags for enabling optional features.
 */
export const ENABLE_SHIKI = process.env.XMDX_SHIKI === '1';
export const IS_MDAST = process.env.XMDX_PIPELINE === 'mdast';

const logBindingSource = (source: string): void => {
  if (!DEBUG_BINDING) return;
  console.info(`[xmdx] binding source: ${source}`);
  const nativePath = process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
  if (nativePath) {
    console.info(`[xmdx] NAPI_RS_NATIVE_LIBRARY_PATH=${nativePath}`);
  } else {
    console.info('[xmdx] NAPI_RS_NATIVE_LIBRARY_PATH is not set');
  }
};

/**
 * Loads the native Xmdx binding.
 * Uses require() directly on the .node binary to bypass Vite SSR runner.
 */
export async function loadXmdxBinding(): Promise<XmdxBinding> {
  if (!bindingPromise) {
    bindingPromise = (async () => {
      const require = createRequire(import.meta.url);
      const pkgRoot = path.dirname(require.resolve('@xmdx/napi/package.json'));

      const guessBinaryName = () => {
        const triplet = `${process.platform}-${process.arch}`;
        return [
          `xmdx.${triplet}.node`,
          `xmdx-${triplet}.node`,
          `xmdx.${process.platform}-${process.arch}.node`,
        ];
      };

      const findBinaryPath = (): string => {
        const candidates = guessBinaryName().map((name) =>
          path.resolve(pkgRoot, name)
        );
        for (const candidate of candidates) {
          if (require('node:fs').existsSync(candidate)) {
            return candidate;
          }
        }
        // Fallback: first .node in package root
        const entries = require('node:fs').readdirSync(pkgRoot);
        const nodeFile = entries.find((f: string) => f.endsWith('.node'));
        if (nodeFile) {
          return path.resolve(pkgRoot, nodeFile);
        }
        throw new Error('@xmdx/napi native binary not found');
      };

      const binaryPath = findBinaryPath();
      const binding = require(binaryPath) as XmdxBinding;
      logBindingSource(binaryPath);
      return binding;
    })();
  }
  return bindingPromise;
}

/**
 * Resets the binding promise (useful for testing).
 */
export function resetBindingPromise(): void {
  bindingPromise = undefined;
}
