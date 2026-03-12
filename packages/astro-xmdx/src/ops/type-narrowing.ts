// Centralized type narrowing — the ONLY file allowed to use `as`.
// Generic utilities are re-exported from xmdx/ops. Astro-specific casts remain here.

// Re-export generic ops from xmdx
export {
  parseJson,
  parseJsonRecord,
  parseJsonString,
  toError,
  isRecord,
  nameOf,
  directiveNameOf,
  asModule,
  asBinding,
  asRecord,
  asFunction,
  asSourceMap,
  asMutableConfig,
  asStringArray,
  asHastChildren,
  asShikiLanguage,
  asOptionalString,
  asMutableViteConfig,
  asViteWithOxc,
  asVitePlugin,
} from 'xmdx/ops';
export type {
  OxcTransformResult,
  OxcTransformModule,
  EsbuildOutputFile,
  EsbuildBuildResult,
  EsbuildModule,
} from 'xmdx/ops';

// --- Astro-specific casts below ---

/**
 * Checks if a value has a symbol property that indicates an MDX component.
 */
export function hasMdxComponentSymbol(value: unknown): boolean {
  return isRecord(value) && Boolean((value as Record<symbol, unknown>)[Symbol.for('mdx-component')]);
}

/**
 * Checks if a result has the AstroJSX marker.
 */
export function hasAstroJsxMarker(result: unknown, marker: string | symbol): boolean {
  return isRecord(result) && Boolean((result as Record<string | symbol, unknown>)[marker]);
}

/**
 * Adds error metadata (title, hint) to an Error object.
 */
export function addErrorHint(error: Error, title: string, hint: string): void {
  (error as Error & { title?: string; hint?: string }).title = title;
  (error as Error & { hint?: string }).hint = hint;
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
 * Cast an unknown value to string (e.g. renderJSX return).
 */
export function asString(value: unknown): string {
  return value as string;
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
