//! Generates Astro-compatible module code from the compilation IR.

use crate::types::CompileIrResult;
use napi::bindgen_prelude::Result;
use xmdx_astro::codegen::{AstroModuleOptions, generate_astro_module};

#[allow(clippy::too_many_arguments)]
pub(crate) fn generate_module_code_from_ir(
    ir: &CompileIrResult,
    hoisted_imports: &[String],
    hoisted_exports: &[String],
    headings_json: &str,
    jsx_import_source: Option<&str>,
) -> Result<String> {
    let options = AstroModuleOptions {
        jsx: &ir.html,
        hoisted_imports,
        hoisted_exports,
        frontmatter_json: &ir.frontmatter_json,
        headings_json,
        filepath: &ir.file_path,
        url: ir.url.as_deref(),
        layout_import: ir.layout_import.as_deref(),
        has_user_default_export: ir.has_user_default_export,
        jsx_import_source,
    };

    Ok(generate_astro_module(&options))
}
