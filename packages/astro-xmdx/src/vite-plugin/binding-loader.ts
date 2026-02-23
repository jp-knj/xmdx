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

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function normalizeLibc(libc: string | null | undefined): 'gnu' | 'musl' | null {
  if (libc === 'gnu' || libc === 'musl') return libc;
  return null;
}

/**
 * Returns platform-compatible native binary candidate names in priority order.
 */
export function getNativeBinaryCandidates(
  platform: string,
  arch: string,
  libc?: string | null
): string[] {
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    const preferred = normalizeLibc(libc) ?? 'gnu';
    const secondary = preferred === 'gnu' ? 'musl' : 'gnu';
    return dedupe([
      `xmdx.linux-${arch}-${preferred}.node`,
      `xmdx-linux-${arch}-${preferred}.node`,
      `xmdx.linux-${arch}-${secondary}.node`,
      `xmdx-linux-${arch}-${secondary}.node`,
    ]);
  }

  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return dedupe([
      `xmdx.darwin-${arch}.node`,
      `xmdx-darwin-${arch}.node`,
    ]);
  }

  if (platform === 'win32' && arch === 'x64') {
    return dedupe([
      'xmdx.win32-x64-msvc.node',
      'xmdx-win32-x64-msvc.node',
    ]);
  }

  return dedupe([
    `xmdx.${platform}-${arch}.node`,
    `xmdx-${platform}-${arch}.node`,
  ]);
}

/**
 * Selects the first compatible native binary from discovered files.
 */
export function selectCompatibleNodeFile(
  files: string[],
  platform: string,
  arch: string,
  libc?: string | null
): string | null {
  const fileSet = new Set(files);
  const candidates = getNativeBinaryCandidates(platform, arch, libc ?? null);
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

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
