#![deny(missing_docs)]
//! Node.js bindings that surface xmdx's Rust implementation.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::path::Path;
use xmdx_core::{MarkflowError, extract_frontmatter};

/// Batch processing types and functions.
pub mod batch;
/// Module code generation helpers.
mod codegen;
/// The stateful compiler and its configuration.
pub mod compiler;
/// NAPI-exposed data structures.
pub mod types;
/// Utility helpers.
mod utils;
#[allow(deprecated)]
pub use batch::*;
pub use types::*;
use utils::empty_frontmatter;
pub(crate) use utils::{build_import_list, dedupe_imports};

/// Converts HTML entities to JSX-safe expressions.
///
/// When slot content with nested components is embedded directly in JSX,
/// HTML entities must be handled appropriately based on context:
/// - Text content: entities → JSX expressions (e.g., `&amp;` → `{"&"}`)
/// - Attribute values: entities stay as-is (browser interprets them)
/// - JSX expression attributes: curly braces decoded (e.g., `=&#123;` → `={`)
#[napi(js_name = "htmlEntitiesToJsx")]
pub fn html_entities_to_jsx_napi(s: String) -> String {
    xmdx_astro::codegen::html_entities_to_jsx(&s)
}

/// Checks if string contains PascalCase JSX tags (e.g., `<Card`, `<Aside`).
///
/// This is used to detect nested JSX components in slot content. When components
/// are present, the slot content must be embedded directly (not via `set:html`)
/// so that Astro processes them as components rather than raw HTML.
#[napi(js_name = "hasPascalCaseTag")]
pub fn has_pascal_case_tag_napi(s: String) -> bool {
    xmdx_astro::codegen::has_pascal_case_tag(&s)
}

/// Extracts YAML or TOML frontmatter without compiling the entire Markdown document.
#[napi]
pub fn parse_frontmatter(content: String) -> napi::Result<FrontmatterResult> {
    match extract_frontmatter(&content) {
        Ok(result) => Ok(FrontmatterResult {
            frontmatter: result.value,
            errors: Vec::new(),
        }),
        Err(err) => Ok(FrontmatterResult {
            frontmatter: empty_frontmatter(),
            errors: vec![err.to_string()],
        }),
    }
}

/// Converts a core RenderBlock to an NAPI RenderBlock.
fn convert_render_block(block: xmdx_astro::renderer::mdast::RenderBlock) -> RenderBlock {
    use xmdx_astro::renderer::mdast;
    match block {
        mdast::RenderBlock::Html { content } => RenderBlock {
            r#type: "html".to_string(),
            content: Some(content),
            name: None,
            props: None,
            slot_children: None,
            code: None,
            lang: None,
            meta: None,
        },
        mdast::RenderBlock::Component {
            name,
            props,
            slot_children,
        } => {
            let props_json = serde_json::to_value(&props)
                .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
            let napi_children: Vec<RenderBlock> = slot_children
                .into_iter()
                .map(convert_render_block)
                .collect();

            RenderBlock {
                r#type: "component".to_string(),
                content: None,
                name: Some(name),
                props: Some(props_json),
                slot_children: Some(napi_children),
                code: None,
                lang: None,
                meta: None,
            }
        }
        mdast::RenderBlock::Code { code, lang, meta } => RenderBlock {
            r#type: "code".to_string(),
            content: None,
            name: None,
            props: None,
            slot_children: None,
            code: Some(code),
            lang,
            meta,
        },
    }
}

/// Parses markdown into structured RenderBlock objects using the mdast v2 renderer.
///
/// This function uses the Block Architecture to return a structured representation
/// of the markdown content, allowing JavaScript to dynamically map component names
/// to actual Astro components without hardcoding in Rust.
///
/// # Arguments
///
/// * `input` - The markdown text to parse
/// * `opts` - Optional configuration object with:
///   - `enable_directives`: boolean (default: true)
///
/// # Returns
///
/// Returns an array of RenderBlock objects. Each block is either:
/// - `{type: "html", content: "<p>...</p>"}` - Plain HTML content
/// - `{type: "component", name: "note", props: {title: "..."}, slotChildren: [...]}` - Component block
/// - `{type: "code", code: "...", lang: "ts", meta: null}` - Code block
///
/// # Example (JavaScript)
///
/// ```javascript
/// const { parseBlocks } = require('@xmdx/napi');
///
/// const input = `:::note[Important]
/// This is **bold** text.
/// :::`;
///
/// const blocks = parseBlocks(input, { enable_directives: true });
/// // blocks = [
/// //   {
/// //     type: "component",
/// //     name: "note",
/// //     props: { title: "Important" },
/// //     slotChildren: [{ type: "html", content: "<p>This is <strong>bold</strong> text.</p>" }]
/// //   }
/// // ]
/// ```
#[napi(js_name = "parseBlocks")]
pub fn parse_blocks(input: String, opts: Option<BlockOptions>) -> napi::Result<ParseBlocksResult> {
    use xmdx_astro::renderer::mdast;

    // Parse options from JavaScript
    let options = if let Some(o) = opts {
        mdast::Options {
            enable_directives: o.enable_directives.unwrap_or(true),
            enable_smartypants: o.enable_smartypants.unwrap_or(false),
            enable_lazy_images: o.enable_lazy_images.unwrap_or(false),
            allow_raw_html: o.allow_raw_html.unwrap_or(false),
            enable_heading_autolinks: o.enable_heading_autolinks.unwrap_or(false),
            enable_math: o.enable_math.unwrap_or(false),
        }
    } else {
        mdast::Options {
            enable_directives: true,
            allow_raw_html: false,
            ..Default::default()
        }
    };

    // Parse markdown to blocks and extract headings
    let result = mdast::to_blocks(&input, &options)
        .map_err(|e| Error::from_reason(format!("Failed to parse blocks: {e}")))?;

    // Convert core RenderBlock to NAPI RenderBlock
    let blocks: Vec<RenderBlock> = result
        .blocks
        .into_iter()
        .map(convert_render_block)
        .collect();

    // Convert headings
    let headings: Vec<HeadingEntry> = result
        .headings
        .into_iter()
        .map(|h| HeadingEntry {
            depth: h.depth,
            slug: h.slug,
            text: h.text,
        })
        .collect();

    Ok(ParseBlocksResult { blocks, headings })
}

/// Represents the type of the input file, either Markdown or MDX.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileType {
    /// Standard Markdown file.
    Markdown,
    /// MDX (Markdown with JSX) file.
    Mdx,
}

impl FileType {
    #[allow(dead_code)]
    fn from_path(path: &Path) -> Self {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("mdx"))
            .map(|is_mdx| {
                if is_mdx {
                    FileType::Mdx
                } else {
                    FileType::Markdown
                }
            })
            .unwrap_or(FileType::Markdown)
    }
}

impl From<FileInputType> for FileType {
    fn from(value: FileInputType) -> Self {
        match value {
            FileInputType::Markdown => FileType::Markdown,
            FileInputType::Mdx => FileType::Mdx,
        }
    }
}

/// Derives a machine-readable error code from a `napi::Error` message.
pub(crate) fn error_code_from(e: &napi::Error) -> String {
    let msg = e.to_string();
    if msg.contains("parse error")
        || msg.contains("Parse error")
        || msg.contains("Markdown parser error")
    {
        "PARSE_ERROR".to_string()
    } else if msg.contains("Render error") {
        "RENDER_ERROR".to_string()
    } else if msg.contains("Unknown component") {
        "UNKNOWN_COMPONENT".to_string()
    } else {
        "INTERNAL_ERROR".to_string()
    }
}

/// Improved error converter that matches on enum variants
fn convert_error<E: Into<MarkflowError>>(err: E) -> Error {
    let err = err.into();
    match err {
        // Map specific errors to specific NAPI statuses
        MarkflowError::EncodingError(e) => {
            Error::new(Status::InvalidArg, format!("Encoding error: {}", e))
        }
        // IO errors and Adapter errors usually imply a runtime failure
        MarkflowError::IoError(e) => Error::from_reason(format!("IO error: {}", e)),
        MarkflowError::MarkdownAdapter { message, location } => Error::from_reason(format!(
            "Markdown parser error at {}: {}",
            location, message
        )),
        MarkflowError::RenderError { message, location } => Error::new(
            Status::InvalidArg,
            format!("Render error at {}: {}", location, message),
        ),
        MarkflowError::UnknownComponent { name, location } => Error::new(
            Status::InvalidArg,
            format!("Unknown component '{}' at {}", name, location),
        ),
        MarkflowError::InternalError(msg) => Error::from_reason(format!("Internal error: {}", msg)),
    }
}

#[cfg(test)]
mod tests {
    use super::{empty_frontmatter, parse_frontmatter};
    use crate::compiler::InternalCompilerConfig;
    use serde_json::Value as JsonValue;

    #[test]
    fn parses_yaml_frontmatter_block() {
        let input = "---\ntitle: Test\n---\nBody".to_string();
        let result = parse_frontmatter(input).unwrap();
        assert!(result.errors.is_empty());
        let title = result
            .frontmatter
            .get("title")
            .and_then(JsonValue::as_str)
            .unwrap();
        assert_eq!(title, "Test");
    }

    #[test]
    fn returns_empty_object_when_no_frontmatter() {
        let result = parse_frontmatter("# Heading".to_string()).unwrap();
        assert!(result.errors.is_empty());
        assert_eq!(result.frontmatter, empty_frontmatter());
    }

    #[test]
    fn compile_document_emits_frontmatter_json() {
        let config = InternalCompilerConfig::new(None);
        let source = "---\ntitle: Test\n---\n# Hello".to_string();
        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        assert_eq!(result.frontmatter_json, "{\"title\":\"Test\"}");
        assert!(
            result
                .code
                .contains("export const frontmatter = {\"title\":\"Test\"};"),
            "code: {}",
            result.code
        );
    }

    #[test]
    fn compile_document_handles_missing_frontmatter() {
        let config = InternalCompilerConfig::new(None);
        let source = "# Hello".to_string();
        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        assert_eq!(result.frontmatter_json, "{}");
        assert!(
            result.code.contains("export const frontmatter = {};"),
            "code: {}",
            result.code
        );
    }

    #[test]
    fn compile_document_hoists_root_imports() {
        let config = InternalCompilerConfig::new(None);
        let source = "import X from './x';\n\n# Title".to_string();
        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        let content_pos = result.code.find("function xmdxContent").unwrap();
        let hoist_pos = result.code.find("import X from './x';").unwrap();
        assert!(
            hoist_pos < content_pos,
            "import should be hoisted before JSX content: {}",
            result.code
        );
        assert_eq!(
            result.code.matches("import X from './x';").count(),
            1,
            "hoisted import should not appear in JSX body: {}",
            result.code
        );
    }

    #[test]
    fn compile_document_ignores_imports_inside_fences() {
        let config = InternalCompilerConfig::new(None);
        let source = "```\nimport Y from './y'\n```\n\n# Title".to_string();
        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        let content_pos = result.code.find("function xmdxContent").unwrap();
        let fenced_pos = result.code.find("import Y from './y'").unwrap();
        assert!(
            fenced_pos > content_pos,
            "fenced import should remain in JSX body: {}",
            result.code
        );
        assert_eq!(
            result.code.matches("import Y from './y'").count(),
            2, // appears twice: once in profiling branch, once in normal branch
            "fenced import should not be hoisted: {}",
            result.code
        );
        // HTML blocks are now wrapped with Fragment set:html, so quotes are escaped in JSON
        assert!(
            result.code.contains(r#"<pre class=\"astro-code\""#)
                && result.code.contains("import Y from './y'"),
            "fenced import should stay in rendered JSX: {}",
            result.code
        );
    }

    #[test]
    fn compile_document_hoists_multiline_leading_exports() {
        let config = InternalCompilerConfig::new(None);
        // Test multi-line arrow function export at document start
        let source =
            "export const foo = () => {\n  return 1\n}\n\nexport { foo };\n\n# Title".to_string();

        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        let content_pos = result.code.find("function xmdxContent").unwrap();

        // Multi-line export should be hoisted completely
        let hoist_pos = result.code.find("export const foo = () => {").unwrap();
        assert!(
            hoist_pos < content_pos,
            "multi-line export should be hoisted before JSX content: {}",
            result.code
        );

        // The closing brace should also be hoisted (part of the same statement)
        assert!(
            result.code[..content_pos].contains("return 1"),
            "multi-line export body should be hoisted: {}",
            result.code
        );

        // Should not appear in JSX body
        assert!(
            !result.code[content_pos..].contains("return 1"),
            "multi-line export should not appear in JSX body: {}",
            result.code
        );

        // Re-export should also work
        let reexport_pos = result.code.find("export { foo };").unwrap();
        assert!(
            reexport_pos < content_pos,
            "re-export should be hoisted: {}",
            result.code
        );
    }

    #[test]
    fn compile_document_hoists_exports_variants() {
        let config = InternalCompilerConfig::new(None);
        let source = "\nexport const foo = () => {\n  return 1\n}\n\nexport default function bar()\n{\n  return foo();\n}\n\nexport { foo };\n\n\n# Title"
            .to_string();

        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        let content_pos = result.code.find("function xmdxContent").unwrap();

        // hoisted exports appear before JSX content
        let hoist_pos = result.code.find("export const foo").unwrap();
        assert!(
            hoist_pos < content_pos,
            "exports should be hoisted before JSX content: {}",
            result.code
        );
        assert_eq!(
            result.code.matches("export const foo").count(),
            1,
            "hoisted exports should not appear in JSX body: {}",
            result.code
        );

        // default export body hoisted, not in JSX
        let default_pos = result.code.find("export default function bar()").unwrap();
        assert!(
            default_pos < content_pos,
            "default export should be hoisted before JSX content: {}",
            result.code
        );
    }

    #[test]
    fn compile_document_does_not_hoist_exports_inside_fence() {
        let config = InternalCompilerConfig::new(None);
        let source = "```\nexport const no = true\n```\n\nexport const yes = true;".to_string();
        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        let content_pos = result.code.find("function xmdxContent").unwrap();
        let fenced_pos = result.code.find("export const no = true").unwrap();

        // Hoisting now handles all root-level imports/exports throughout the document
        // (see compile_document_hoists_mid_document_imports test below)

        assert!(
            fenced_pos > content_pos,
            "fenced export should stay in JSX body: {}",
            result.code
        );
        // HTML is now inside a JSON string literal via set:html, so quotes are escaped
        assert!(
            result.code.contains(r#"<pre class=\"astro-code\""#)
                && result.code.contains("export const no = true"),
            "fenced export should stay in rendered JSX: {}",
            result.code
        );
    }

    #[test]
    fn compile_document_hoists_export_edge_cases() {
        let config = InternalCompilerConfig::new(None);
        let source = "\nexport default async () => {\n  return 1\n}\n\nexport * from './mod';\n\nexport const foo = 1 // inline\n\n\n# Title"
            .to_string();

        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        let content_pos = result.code.find("function xmdxContent").unwrap();
        assert!(
            result.code.find("export default async () => {").unwrap() < content_pos,
            "default async export should be hoisted"
        );
        assert!(
            result.code.find("export * from './mod';").unwrap() < content_pos,
            "export * should be hoisted"
        );
        assert!(
            result.code.find("export const foo = 1 // inline").unwrap() < content_pos,
            "inline comment export should be hoisted"
        );
        assert_eq!(
            result
                .code
                .matches("export const foo = 1 // inline")
                .count(),
            1,
            "inline export should not appear in JSX body: {}",
            result.code
        );
    }

    #[test]
    fn compile_document_hoists_mid_document_imports() {
        let config = InternalCompilerConfig::new(None);
        // Import appears AFTER some markdown content - should still be hoisted
        let source = "# Title\n\nSome content here.\n\nimport { Badge } from './Badge.astro';\n\nMore content with Badge."
            .to_string();

        let result =
            crate::compiler::compile_document(&config, source, "test.mdx".into(), None, Vec::new())
                .expect("compile success");
        let content_pos = result.code.find("function xmdxContent").unwrap();
        let hoist_pos = result
            .code
            .find("import { Badge } from './Badge.astro';")
            .unwrap();

        assert!(
            hoist_pos < content_pos,
            "mid-document import should be hoisted before JSX content: {}",
            result.code
        );
        assert_eq!(
            result
                .code
                .matches("import { Badge } from './Badge.astro';")
                .count(),
            1,
            "hoisted import should not appear in JSX body: {}",
            result.code
        );
    }
}
