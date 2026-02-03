use xmdx_astro::MdastOptions;
use xmdx_astro::code_fence::collect_root_statements;
use xmdx_astro::codegen::{AstroModuleOptions, DirectiveMappingResult, blocks_to_jsx_string};
use xmdx_astro::renderer::mdast::to_blocks;
use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

// ============================================================================
// Compile API Types
// ============================================================================

/// Heading metadata extracted from the document.
#[derive(Debug, Clone, Serialize)]
pub struct HeadingEntry {
    /// Heading depth (1-6).
    pub depth: u8,
    /// Slugified identifier.
    pub slug: String,
    /// Visible heading text.
    pub text: String,
}

/// Result of compiling MDX to an Astro-compatible module.
#[derive(Debug, Clone, Serialize)]
pub struct CompileResult {
    /// Generated JavaScript/JSX module code.
    pub code: String,
    /// Serialized frontmatter as JSON string.
    pub frontmatter_json: String,
    /// Extracted heading metadata.
    pub headings: Vec<HeadingEntry>,
    /// Whether the user provided their own export default.
    pub has_user_default_export: bool,
}

// ============================================================================
// Compile API
// ============================================================================

/// Compiles MDX source into an Astro-compatible JavaScript module.
///
/// This function extracts frontmatter, hoists imports/exports, parses markdown
/// to JSX, and generates a complete module with createComponent wrapper.
///
/// # Arguments
///
/// * `source` - The MDX source code
/// * `filepath` - The file path for module metadata
///
/// # Returns
///
/// Returns a `CompileResult` containing the generated module code, frontmatter,
/// and heading metadata.
#[wasm_bindgen]
pub fn compile(source: &str, filepath: &str) -> Result<JsValue, JsError> {
    // 1. Extract frontmatter
    let extraction = xmdx_core::extract_frontmatter(source)
        .map_err(|e| JsError::new(&format!("Frontmatter error: {}", e)))?;
    let frontmatter_json =
        serde_json::to_string(&extraction.value).unwrap_or_else(|_| "{}".to_string());
    let raw_body = &source[extraction.body_start..];

    // 2. Hoist top-level imports/exports
    let (hoisted_statements, body_lines) = collect_root_statements(raw_body);
    let body_without_imports = body_lines.join("\n");
    let has_user_default_export = hoisted_statements
        .exports
        .iter()
        .any(|s| s.trim_start().starts_with("export default"));
    let hoisted_imports = hoisted_statements.imports;
    let hoisted_exports = hoisted_statements.exports;

    // 3. Parse to blocks and render JSX
    let mdast_options = MdastOptions {
        enable_directives: true,
        enable_lazy_images: true,
        ..Default::default()
    };
    let blocks_result = to_blocks(&body_without_imports, &mdast_options)
        .map_err(|e| JsError::new(&format!("Parse error: {}", e)))?;

    let jsx_body = blocks_to_jsx_string(
        &blocks_result.blocks,
        None::<fn(&str) -> Option<DirectiveMappingResult>>,
    );

    // 4. Convert headings
    let headings: Vec<HeadingEntry> = blocks_result
        .headings
        .into_iter()
        .map(|h| HeadingEntry {
            depth: h.depth,
            slug: h.slug,
            text: h.text,
        })
        .collect();

    let headings_json = serde_json::to_string(&headings).unwrap_or_else(|_| "[]".to_string());

    // 6. Generate module code
    let code = xmdx_astro::codegen::generate_astro_module(&AstroModuleOptions {
        jsx: &jsx_body,
        hoisted_imports: &hoisted_imports,
        hoisted_exports: &hoisted_exports,
        frontmatter_json: &frontmatter_json,
        headings_json: &headings_json,
        filepath,
        url: None,
        layout_import: None,
        has_user_default_export,
    });

    // 7. Build result
    let result = CompileResult {
        code,
        frontmatter_json,
        headings,
        has_user_default_export,
    };

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
}

// ============================================================================
// Block Parser API
// ============================================================================

/// Parses markdown into structured RenderBlock objects using the mdast v2 renderer.
///
/// This function uses the Block Architecture to return a structured representation
/// of the markdown content, allowing JavaScript to dynamically map component names
/// to actual Astro components without hardcoding in Rust.
///
/// # Arguments
///
/// * `input` - The markdown text to parse
/// * `opts` - Optional JavaScript object with options:
///   - `enable_directives`: boolean (default: true)
///
/// # Returns
///
/// Returns a JavaScript array of RenderBlock objects. Each block is either:
/// - `{type: "html", content: "<p>...</p>"}` - Plain HTML content
/// - `{type: "component", name: "note", props: {title: "..."}, slot_html: "..."}` - Component block
///
/// # Example (JavaScript)
///
/// ```javascript
/// import { parse_blocks } from './xmdx_wasm';
///
/// const input = `:::note[Important]
/// This is **bold** text.
/// :::`;
///
/// const blocks = parse_blocks(input, { enable_directives: true });
/// // blocks = [
/// //   {
/// //     type: "component",
/// //     name: "note",
/// //     props: { title: "Important" },
/// //     slot_html: "<p>This is <strong>bold</strong> text.</p>"
/// //   }
/// // ]
/// ```
#[wasm_bindgen(js_name = parse_blocks)]
pub fn parse_blocks(input: &str, opts: JsValue) -> Result<JsValue, JsError> {
    use xmdx_astro::renderer::mdast::{Options, to_blocks};

    // Parse options from JavaScript
    let options: Options = if opts.is_undefined() || opts.is_null() {
        Options {
            enable_directives: true,
            ..Default::default()
        }
    } else {
        serde_wasm_bindgen::from_value(opts)
            .map_err(|e| JsError::new(&format!("Invalid options: {}", e)))?
    };

    // Parse markdown to blocks
    let blocks = to_blocks(input, &options).map_err(|e| JsError::new(&e))?;

    // Convert to JavaScript value using zero-copy serialization
    serde_wasm_bindgen::to_value(&blocks)
        .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
}
