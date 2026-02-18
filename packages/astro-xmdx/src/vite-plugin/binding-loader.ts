/**
 * Native binding loader for Xmdx
 * @module vite-plugin/binding-loader
 */

import { createRequire } from 'node:module';
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
 * Uses @xmdx/napi package resolver for platform-correct native loading.
 */
export async function loadXmdxBinding(): Promise<XmdxBinding> {
  if (!bindingPromise) {
    bindingPromise = (async () => {
      const require = createRequire(import.meta.url);
      try {
        // Delegate platform/arch detection to NAPI-RS generated loader.
        const binding = require('@xmdx/napi') as XmdxBinding;
        logBindingSource('@xmdx/napi');
        return binding;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        throw new Error(
          `[xmdx] failed to load @xmdx/napi on ${process.platform}-${process.arch}: ${e.message}`
        );
      }
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
