mod convert;
mod types;

use napi::Result;
use napi_derive::napi;
use types::{BlockOptions, FrontmatterResult, ParseBlocksResult};

/// Parses markdown input into render blocks and heading metadata.
#[napi(js_name = "parseBlocks")]
pub fn parse_blocks(input: String, opts: Option<BlockOptions>) -> Result<ParseBlocksResult> {
    let options = convert::to_mdast_options(opts);
    let result = xmdx_astro::to_blocks(&input, &options)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(convert::convert_blocks_result(&result))
}

/// Extracts YAML frontmatter from a markdown document.
///
/// Returns the parsed frontmatter as a JSON value and any parse errors as strings.
#[napi(js_name = "parseFrontmatter")]
pub fn parse_frontmatter(content: String) -> Result<FrontmatterResult> {
    match xmdx_core::frontmatter::extract_frontmatter(&content) {
        Ok(extraction) => Ok(FrontmatterResult {
            frontmatter: extraction.value,
            errors: vec![],
        }),
        Err(e) => Ok(FrontmatterResult {
            frontmatter: serde_json::Value::Object(Default::default()),
            errors: vec![e.to_string()],
        }),
    }
}

/// Converts HTML entities to JSX-safe expressions for embedding in Astro components.
#[napi(js_name = "htmlEntitiesToJsx")]
pub fn html_entities_to_jsx(s: String) -> String {
    xmdx_astro::codegen::html_entities_to_jsx(&s)
}

/// Checks whether a string contains a PascalCase JSX tag (e.g. `<Card`, `<Aside`).
#[napi(js_name = "hasPascalCaseTag")]
pub fn has_pascal_case_tag(s: String) -> bool {
    xmdx_astro::codegen::has_pascal_case_tag(&s)
}
