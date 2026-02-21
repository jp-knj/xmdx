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

export type LinuxLibc = 'gnu' | 'musl' | null;

export function detectLinuxLibc(requireFn: NodeRequire): LinuxLibc {
  try {
    const fs = requireFn('node:fs') as typeof import('node:fs');
    if (fs.readFileSync('/usr/bin/ldd', 'utf8').includes('musl')) {
      return 'musl';
    }
  } catch {
    // ignore
  }

  try {
    const report =
      typeof process.report?.getReport === 'function'
        ? process.report.getReport() as {
          header?: { glibcVersionRuntime?: unknown };
          sharedObjects?: string[];
        }
        : null;

    if (report?.header?.glibcVersionRuntime) {
      return 'gnu';
    }

    if (Array.isArray(report?.sharedObjects)) {
      const hasMusl = report.sharedObjects.some((file: string) =>
        file.includes('libc.musl-') || file.includes('ld-musl-')
      );
      if (hasMusl) {
        return 'musl';
      }
    }
  } catch {
    // ignore
  }

  try {
    const childProcess = requireFn('node:child_process') as typeof import('node:child_process');
    const lddVersion = childProcess.execSync('ldd --version', {
      encoding: 'utf8',
    });
    if (lddVersion.includes('musl')) {
      return 'musl';
    }
    if (lddVersion.toLowerCase().includes('glibc') || lddVersion.includes('GNU C Library')) {
      return 'gnu';
    }
  } catch {
    // ignore
  }

  return null;
}

export function getNativeBinaryCandidates(
  platform = process.platform,
  arch = process.arch,
  libc: LinuxLibc = null,
): string[] {
  const names: string[] = [];
  const push = (name: string) => {
    if (!names.includes(name)) names.push(name);
  };

  const triplet = `${platform}-${arch}`;

  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    if (libc === 'gnu') {
      push(`xmdx.linux-${arch}-gnu.node`);
      push(`xmdx-linux-${arch}-gnu.node`);
    } else if (libc === 'musl') {
      push(`xmdx.linux-${arch}-musl.node`);
      push(`xmdx-linux-${arch}-musl.node`);
    }

    push(`xmdx.linux-${arch}-gnu.node`);
    push(`xmdx-linux-${arch}-gnu.node`);
    push(`xmdx.linux-${arch}-musl.node`);
    push(`xmdx-linux-${arch}-musl.node`);
  }

  push(`xmdx.${triplet}.node`);
  push(`xmdx-${triplet}.node`);
  push(`xmdx.${platform}-${arch}.node`);

  return names;
}

export function selectCompatibleNodeFile(
  entries: string[],
  platform = process.platform,
  arch = process.arch,
  libc: LinuxLibc = null,
): string | null {
  const nodeEntries = entries.filter((entry) => entry.endsWith('.node'));
  if (nodeEntries.length === 0) return null;

  const directMatch = getNativeBinaryCandidates(platform, arch, libc)
    .find((name) => nodeEntries.includes(name));
  if (directMatch) return directMatch;

  const triplet = `${platform}-${arch}`;
  const compatible = nodeEntries.filter((name) => name.includes(triplet));
  if (compatible.length === 0) return null;

  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    const linuxOrder = libc === 'musl'
      ? [`linux-${arch}-musl`, `linux-${arch}-gnu`]
      : [`linux-${arch}-gnu`, `linux-${arch}-musl`];

    for (const token of linuxOrder) {
      const match = compatible.find((name) => name.includes(token));
      if (match) return match;
    }
  }

  return compatible[0] ?? null;
}

/**
 * Loads the native Xmdx binding.
 * Uses require() directly on the .node binary to bypass Vite SSR runner.
 */
export async function loadXmdxBinding(): Promise<XmdxBinding> {
  if (!bindingPromise) {
    bindingPromise = (async () => {
      const require = createRequire(import.meta.url);
      const pkgRoot = path.dirname(require.resolve('@xmdx/napi/package.json'));

      const findBinaryPath = (): string => {
        const libc = process.platform === 'linux' ? detectLinuxLibc(require) : null;
        const candidates = getNativeBinaryCandidates(process.platform, process.arch, libc)
          .map((name) => path.resolve(pkgRoot, name));

        const fs = require('node:fs') as typeof import('node:fs');

        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }

        // Last resort fallback: only allow platform/arch-compatible .node files.
        const entries = fs.readdirSync(pkgRoot);
        const compatibleNodeFile = selectCompatibleNodeFile(entries, process.platform, process.arch, libc);
        if (compatibleNodeFile) {
          return path.resolve(pkgRoot, compatibleNodeFile);
        }

        throw new Error(
          `@xmdx/napi native binary not found for ${process.platform}-${process.arch}` +
          `${libc ? ` (${libc})` : ''}. Tried: ${candidates.join(', ')}`
        );
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
