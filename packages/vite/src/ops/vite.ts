// Centralized Vite-specific type narrowing — the ONLY file allowed to use `as` for Vite casts.

/**
 * Cast for Vite config mutation.
 * Vite's ResolvedConfig is readonly, but configResolved needs mutation.
 */
export function asMutableViteConfig(config: unknown): Record<string, unknown> & {
  esbuild?: unknown;
  optimizeDeps?: { exclude?: string[] };
  ssr?: { external?: string[] };
} {
  return config as Record<string, unknown> & {
    esbuild?: unknown;
    optimizeDeps?: { exclude?: string[] };
    ssr?: { external?: string[] };
  };
}

/**
 * Return type for asViteWithOxc — Vite namespace with optional OXC support (Vite 8+).
 */
export interface ViteWithOxc {
  transformWithOxc?: (
    code: string,
    filename: string,
    options: Record<string, unknown>,
  ) => Promise<{ code: string; map?: unknown }>;
  [key: string]: unknown;
}

/**
 * Cast for Vite namespace with optional OXC support (Vite 8+).
 */
export function asViteWithOxc(vite: unknown): ViteWithOxc {
  return vite as ViteWithOxc;
}

/**
 * Cast for Vite Plugin return type (satisfies Vite's any-typed Plugin).
 */
export function asVitePlugin<T>(value: unknown): T {
  return value as T;
}

/**
 * Typed interface for oxc-transform module (loaded via require()).
 */
export interface OxcTransformResult { code: string; map?: string }
export interface OxcTransformModule {
  transform: (filename: string, code: string, options: Record<string, unknown>) => OxcTransformResult;
}

/**
 * Typed interface for esbuild module (loaded via require()).
 */
export interface EsbuildOutputFile { path: string; text: string }
export interface EsbuildBuildResult {
  outputFiles: EsbuildOutputFile[];
}
export interface EsbuildModule {
  build: (options: Record<string, unknown>) => Promise<EsbuildBuildResult>;
}
