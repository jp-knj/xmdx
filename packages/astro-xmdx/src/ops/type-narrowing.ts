// Centralized type narrowing — the ONLY file allowed to use `as`.
import type { SourceMapInput } from 'rollup';

export function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

export function parseJsonRecord(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>;
}

export function parseJsonString(json: string): string {
  return JSON.parse(json) as string;
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function asSourceMap(map: unknown): SourceMapInput | undefined {
  return map as SourceMapInput | undefined;
}

export function asMutableConfig(config: unknown): Record<string, unknown> {
  return config as Record<string, unknown>;
}

export function asStringArray(value: unknown): unknown[] {
  return value as unknown[];
}

/**
 * Type guard: checks that value is a non-null object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Returns the `name` string from a value, or `'unknown'` when not present.
 */
export function nameOf(value: unknown): string {
  if (isRecord(value) && typeof value.name === 'string') {
    return value.name;
  }
  return 'unknown';
}

/**
 * Returns the `directive` string from a value, or `'unknown'` when not present.
 */
export function directiveNameOf(value: unknown): string {
  if (isRecord(value) && typeof value.directive === 'string') {
    return value.directive;
  }
  return 'unknown';
}

/**
 * Type-safe cast for HastNode children arrays.
 */
export function asHastChildren<T>(children: unknown): T[] | null {
  return Array.isArray(children) ? (children as T[]) : null;
}

/**
 * Cast for dynamic `require()` results.
 */
export function asBinding<T>(value: unknown): T {
  return value as T;
}

/**
 * Cast for dynamic `import()` modules.
 */
export function asModule<T>(value: unknown): T {
  return value as T;
}

/**
 * Cast for shiki language loading (accepts BundledLanguage | SpecialLanguage).
 */
export function asShikiLanguage(lang: string): unknown {
  return lang as unknown;
}

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
 * Checks if a value has a symbol property that indicates an MDX component.
 */
export function hasMdxComponentSymbol(value: unknown): boolean {
  return isRecord(value) && Boolean((value as Record<symbol, unknown>)[Symbol.for('mdx-component')]);
}

/**
 * Checks if a result has the AstroJSX marker.
 */
export function hasAstroJsxMarker(result: unknown, marker: symbol): boolean {
  return isRecord(result) && Boolean((result as Record<symbol, unknown>)[marker]);
}

/**
 * Adds error metadata (title, hint) to an Error object.
 */
export function addErrorHint(error: Error, title: string, hint: string): void {
  (error as Error & { title?: string; hint?: string }).title = title;
  (error as Error & { hint?: string }).hint = hint;
}

/**
 * Vite config with optional OXC support (Vite 8+).
 */
export function asViteWithOxc(vite: unknown): typeof import('vite') & {
  transformWithOxc?: (
    code: string,
    filename: string,
    options: Record<string, unknown>,
  ) => Promise<{ code: string; map?: unknown }>;
} {
  return vite as typeof import('vite') & {
    transformWithOxc?: (
      code: string,
      filename: string,
      options: Record<string, unknown>,
    ) => Promise<{ code: string; map?: unknown }>;
  };
}

/**
 * Type-safe cast for PropValue from Rust compiler.
 */
export function asPropValue<T>(value: unknown): T {
  return value as T;
}

/**
 * Cast an integration array to unknown[] for iteration.
 */
export function asIntegrationArray(value: unknown): unknown[] {
  return value as unknown[];
}

/**
 * Cast for Vite Plugin return type (satisfies Vite's any-typed Plugin).
 */
export function asVitePlugin<T>(value: unknown): T {
  return value as T;
}

/**
 * Safely extract an optional string from an unknown value.
 */
export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Cast an unknown value to string (e.g. renderJSX return).
 */
export function asString(value: unknown): string {
  return value as string;
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

/**
 * Wraps the Astro `jsx()` call whose return type is `any`, narrowing to `unknown`.
 */
export function callJsx(
  fn: (...args: any[]) => any,
  component: unknown,
  props: Record<string, unknown>,
): unknown {
  return fn(component, props);
}

/**
 * Wraps `renderJSX()` whose return type is `any`, narrowing to `Promise<string>`.
 */
export async function callRenderJSX(
  fn: (...args: any[]) => any,
  result: unknown,
  vnode: unknown,
): Promise<string> {
  return (await fn(result, vnode)) as string;
}

type AddPageExtensionFn = (ext: string) => void;
type AddContentEntryTypeFn = (config: {
  extensions: string[];
  getEntryInfo: (params: { fileUrl: URL; contents: string }) => Promise<{
    data: Record<string, unknown>;
    body: string;
    slug?: string;
    rawData: string;
  }>;
  contentModuleTypes: string;
  handlePropagation?: boolean;
}) => void;

/**
 * Extract the internal `addPageExtension` API from Astro hook options.
 */
export function getAddPageExtension(options: unknown): AddPageExtensionFn | undefined {
  const rec = options as Record<string, unknown>;
  return typeof rec.addPageExtension === 'function'
    ? (rec.addPageExtension as AddPageExtensionFn)
    : undefined;
}

/**
 * Extract the internal `addContentEntryType` API from Astro hook options.
 */
export function getAddContentEntryType(options: unknown): AddContentEntryTypeFn | undefined {
  const rec = options as Record<string, unknown>;
  return typeof rec.addContentEntryType === 'function'
    ? (rec.addContentEntryType as AddContentEntryTypeFn)
    : undefined;
}
