/* tslint:disable */
/* eslint-disable */
/**
 * Renders markdown into an HTML `String`.
 */
export function render_html(input: string, enforce_img_loading_lazy?: boolean | null, enable_directives?: boolean | null, enable_hoist?: boolean | null, enable_smartypants?: boolean | null, enable_components?: boolean | null): string;
/**
 * Streams rendered HTML chunks into the provided JavaScript callback.
 *
 * The callback is invoked with each UTF-8 chunk produced by the streaming
 * renderer, so callers can forward output to a `WritableStream`, append to the
 * DOM incrementally, or buffer it manually.
 */
export function stream_html(input: string, chunk_callback: Function, enforce_img_loading_lazy?: boolean | null, enable_directives?: boolean | null, enable_hoist?: boolean | null, enable_smartypants?: boolean | null, enable_components?: boolean | null): void;
/**
 * Parses markdown into structured RenderBlock objects using the mdast v2 renderer.
 *
 * This function uses the Block Architecture to return a structured representation
 * of the markdown content, allowing JavaScript to dynamically map component names
 * to actual Astro components without hardcoding in Rust.
 *
 * # Arguments
 *
 * * `input` - The markdown text to parse
 * * `opts` - Optional JavaScript object with options:
 *   - `inject_starlight_css`: boolean (default: false)
 *   - `enable_directives`: boolean (default: true)
 *
 * # Returns
 *
 * Returns a JavaScript array of RenderBlock objects. Each block is either:
 * - `{type: "html", content: "<p>...</p>"}` - Plain HTML content
 * - `{type: "component", name: "note", props: {title: "..."}, slot_html: "..."}` - Component block
 *
 * # Example (JavaScript)
 *
 * ```javascript
 * import { parse_blocks } from './xmdx_wasm';
 *
 * const input = `:::note[Important]
 * This is **bold** text.
 * :::`;
 *
 * const blocks = parse_blocks(input, { enable_directives: true });
 * // blocks = [
 * //   {
 * //     type: "component",
 * //     name: "note",
 * //     props: { title: "Important" },
 * //     slot_html: "<p>This is <strong>bold</strong> text.</p>"
 * //   }
 * // ]
 * ```
 */
export function parse_blocks(input: string, opts: any): any;
/**
 * Compiles MDX source into an Astro-compatible JavaScript module.
 *
 * This function extracts frontmatter, hoists imports/exports, parses markdown
 * to JSX, and generates a complete module with createComponent wrapper.
 *
 * # Arguments
 *
 * * `source` - The MDX source code
 * * `filepath` - File path for error messages and `export const file`
 *
 * # Returns
 *
 * Returns a JavaScript object with:
 * - `code`: The generated module code
 * - `frontmatter_json`: Serialized frontmatter
 * - `headings`: Array of heading metadata
 * - `has_user_default_export`: Whether user provided export default
 */
export function compile(source: string, filepath: string): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly compile: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly parse_blocks: (a: number, b: number, c: any) => [number, number, number];
  readonly render_html: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
  readonly stream_html: (a: number, b: number, c: any, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
