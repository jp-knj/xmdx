use napi_derive::napi;
use std::collections::HashMap;

/// Options for block parsing, maps to `xmdx_astro::MdastOptions`.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct BlockOptions {
    pub enable_directives: Option<bool>,
    pub enable_smartypants: Option<bool>,
    pub enable_lazy_images: Option<bool>,
    pub allow_raw_html: Option<bool>,
}

/// Flat representation of a render block for NAPI.
///
/// NAPI doesn't support Rust enums, so we use a `type` discriminator field:
/// - `"html"`: `content` is set
/// - `"component"`: `name`, `props`, `slot_children` are set
/// - `"code"`: `code`, `lang`, `meta` are set
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NapiRenderBlock {
    /// Block type: "html", "component", or "code".
    pub r#type: String,
    /// HTML content (for "html" blocks).
    pub content: Option<String>,
    /// Component name (for "component" blocks).
    pub name: Option<String>,
    /// Component props as JSON-serialized string (for "component" blocks).
    pub props: Option<HashMap<String, String>>,
    /// Nested slot children (for "component" blocks).
    pub slot_children: Option<Vec<NapiRenderBlock>>,
    /// Code content (for "code" blocks).
    pub code: Option<String>,
    /// Language identifier (for "code" blocks).
    pub lang: Option<String>,
    /// Meta string (for "code" blocks).
    pub meta: Option<String>,
}

/// A heading entry extracted during parsing.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NapiHeadingEntry {
    pub depth: u32,
    pub slug: String,
    pub text: String,
}

/// Result of `parseBlocks`.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ParseBlocksResult {
    pub blocks: Vec<NapiRenderBlock>,
    pub headings: Vec<NapiHeadingEntry>,
}

/// Result of `parseFrontmatter`.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct FrontmatterResult {
    pub frontmatter: serde_json::Value,
    pub errors: Vec<String>,
}
