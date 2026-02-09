//! NAPI-exposed data structures.

use napi_derive::napi;
use serde::Serialize;
use serde_json::Value as JsonValue;

/// Parsed frontmatter document plus any parser errors.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct FrontmatterResult {
    /// Structured frontmatter data represented as JSON.
    pub frontmatter: JsonValue,
    /// Any syntax or parsing errors surfaced by the extractor.
    pub errors: Vec<String>,
}

/// Options passed to the compiler constructor.
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct CompilerConfig {
    /// Enables GFM extensions (currently always on; placeholder for parity).
    pub gfm: Option<bool>,
    /// Enables smart punctuation substitutions (placeholder flag).
    pub smartypants: Option<bool>,
    /// Enables syntax highlighting (placeholder flag).
    pub syntax_highlighting: Option<bool>,
    /// Overrides the module used for JSX runtime helpers.
    pub jsx_import_source: Option<String>,
    /// Component registry configuration (JSON).
    pub registry: Option<JsonValue>,
    /// Whether to rewrite JSX code blocks to HTML format for ExpressiveCode.
    /// Only set to true when ExpressiveCode is enabled.
    pub rewrite_code_blocks: Option<bool>,
}

/// File-specific overrides that accompany each compilation.
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct FileOptions {
    /// Route URL that Astro associates with the file.
    pub url: Option<String>,
    /// Absolute file path (overrides the `filepath` argument when provided).
    pub file: Option<String>,
    /// Explicitly sets the file type so callers can override extension-based detection.
    pub file_type: Option<FileInputType>,
}

/// File categories supported by the compiler.
#[napi(string_enum)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileInputType {
    /// Standard Markdown (.md) without MDX extensions.
    Markdown,
    /// Full MDX documents (.mdx) with JSX/ESM hoisting.
    Mdx,
}

/// Heading metadata returned from the compiler.
#[napi(object)]
#[derive(Debug, Clone, Serialize)]
pub struct HeadingEntry {
    /// Heading depth (1-6).
    pub depth: u8,
    /// Slugified identifier.
    pub slug: String,
    /// Visible heading text.
    pub text: String,
}

/// Imported module referenced by the compiled output.
#[napi(object)]
#[derive(Debug, Clone, Serialize)]
pub struct ImportedModule {
    /// Resolved file path of the import.
    pub path: String,
    /// Logical category (`layout`, `component`, etc.).
    pub kind: String,
}

/// Parse warning returned from Rust
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ParseWarningEntry {
    /// Warning type (e.g., "unclosed_code_fence")
    pub warning_type: String,
    /// Line number where warning occurred
    pub line: u32,
    /// Human-readable message
    pub message: String,
}

/// Diagnostics returned with compilation result
#[napi(object)]
#[derive(Debug, Clone)]
pub struct Diagnostics {
    /// Non-fatal warnings
    pub warnings: Vec<ParseWarningEntry>,
}

/// Result returned by the streaming compiler.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct CompileResult {
    /// Compiled JavaScript/JSX module text.
    pub code: String,
    /// Source map in v3 format (null when unavailable).
    pub map: Option<String>,
    /// JSON string containing serialized frontmatter.
    pub frontmatter_json: String,
    /// Heading metadata collected during compilation.
    pub headings: Vec<HeadingEntry>,
    /// Dependencies referenced while compiling (layouts/imports).
    pub imports: Vec<ImportedModule>,
    /// Parse diagnostics (warnings, not errors)
    pub diagnostics: Diagnostics,
}

/// Neutral IR returned when Astro-compat codegen is disabled.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct CompileIrResult {
    /// Rendered JSX output (string form).
    pub html: String,
    /// Hoisted imports captured during parsing (structured).
    pub hoisted_imports: Vec<ImportSpec>,
    /// Hoisted exports captured during parsing (structured).
    pub hoisted_exports: Vec<ExportSpec>,
    /// Serialized frontmatter JSON string.
    pub frontmatter_json: String,
    /// Heading metadata collected during parsing.
    pub headings: Vec<HeadingEntry>,
    /// Absolute or workspace-relative file path of the source.
    pub file_path: String,
    /// Route URL (if provided) associated with the file.
    pub url: Option<String>,
    /// Layout import path extracted from frontmatter (if any).
    pub layout_import: Option<String>,
    /// JSX runtime import source to be used by JS adapters.
    pub runtime_import: String,
    /// Parse diagnostics (warnings, not errors)
    pub diagnostics: Diagnostics,
    /// Whether user provided their own `export default` statement.
    pub has_user_default_export: bool,
}

/// Structured import returned by the compiler IR.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ImportSpec {
    /// Raw import statement text.
    pub source: String,
    /// Logical kind (hoisted or transform-required).
    pub kind: ImportKind,
}

/// Structured export returned by the compiler IR.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ExportSpec {
    /// Raw export statement text.
    pub source: String,
    /// Whether this is a default export (`export default ...`).
    pub is_default: bool,
}

/// Import category surfaced to JS callers.
#[napi(string_enum)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportKind {
    /// Import lifted from document root.
    Hoisted,
    /// Import required by transforms (e.g., directive mapper).
    Transform,
}

/// Options for the mdast v2 block renderer.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct BlockOptions {
    /// Enable directive preprocessing (:::note, etc.). Defaults to true.
    pub enable_directives: Option<bool>,
    /// Enable smart punctuation transformations. Defaults to false.
    pub enable_smartypants: Option<bool>,
    /// Enable lazy loading for images. Defaults to false.
    pub enable_lazy_images: Option<bool>,
    /// Allow raw HTML (<script>, <style>, etc.) to pass through. Defaults to true.
    pub allow_raw_html: Option<bool>,
}

/// Represents a rendering block returned by parse_blocks().
///
/// JavaScript receives this as:
/// ```ts
/// type RenderBlock =
///   | { type: "html", content: string }
///   | { type: "component", name: string, props: Record<string, string>, slotChildren: RenderBlock[] }
///   | { type: "code", code: string, lang?: string, meta?: string }
/// ```
#[napi(object)]
#[derive(Debug, Clone)]
pub struct RenderBlock {
    /// Block type: "html", "component", or "code"
    pub r#type: String,
    /// HTML content (for type="html")
    pub content: Option<String>,
    /// Component name (for type="component")
    pub name: Option<String>,
    /// Component props (for type="component")
    pub props: Option<JsonValue>,
    /// Structured slot children (for type="component")
    pub slot_children: Option<Vec<RenderBlock>>,
    /// Code content (for type="code")
    pub code: Option<String>,
    /// Code language (for type="code")
    pub lang: Option<String>,
    /// Code meta string (for type="code")
    pub meta: Option<String>,
}

/// Result of parseBlocks() with blocks and extracted headings.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ParseBlocksResult {
    /// Rendering blocks (HTML or Component).
    pub blocks: Vec<RenderBlock>,
    /// Extracted heading metadata.
    pub headings: Vec<HeadingEntry>,
}

/// Result from MDX compilation using mdxjs-rs.
/// Unlike CompileIrResult which returns JSX for further processing,
/// this returns complete JavaScript code ready for use.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct MdxCompileResult {
    /// Compiled JavaScript code (complete module with MDXContent export).
    pub code: String,
    /// Serialized frontmatter JSON string.
    pub frontmatter_json: String,
    /// Heading metadata collected during parsing.
    pub headings: Vec<HeadingEntry>,
}
