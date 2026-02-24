//! The stateful compiler and its configuration.

use crate::batch::{
    BatchInput, BatchOptions, BatchProcessingResult, BatchResult, BatchStats,
    ModuleBatchProcessingResult, ModuleBatchResult,
};
use crate::types::*;
use napi_derive::napi;
use rayon::prelude::*;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;
use xmdx_astro::codegen::{DirectiveMappingResult, blocks_to_jsx_string};
use xmdx_astro::{MdastOptions, code_fence, to_blocks};
use xmdx_core::MarkflowError;

const ASTRO_DEFAULT_RUNTIME: &str = "astro/runtime/server/index.js";

#[derive(Debug, Clone)]
pub(crate) struct InternalCompilerConfig {
    pub(crate) jsx_import_source: String,
    pub(crate) enable_heading_autolinks: bool,
    pub(crate) directive_config: xmdx_core::DirectiveConfig,
}

impl InternalCompilerConfig {
    pub(crate) fn new(config: Option<CompilerConfig>) -> Self {
        let cfg = config.unwrap_or_default();
        let jsx_import_source = cfg
            .jsx_import_source
            .unwrap_or_else(|| ASTRO_DEFAULT_RUNTIME.to_string());
        let enable_heading_autolinks = cfg.enable_heading_autolinks.unwrap_or(false);

        // Build directive config from custom names and component map
        let mut directive_config = xmdx_core::DirectiveConfig::default();
        if let Some(names) = cfg.custom_directive_names {
            // Merge custom names with defaults
            let mut all_names: Vec<String> = xmdx_core::DEFAULT_DIRECTIVE_NAMES
                .iter()
                .map(|s| s.to_string())
                .collect();
            for name in names {
                let name = name.to_ascii_lowercase();
                if !all_names.contains(&name) {
                    all_names.push(name);
                }
            }
            directive_config.custom_names = all_names;
        }
        if let Some(map) = cfg.directive_component_map
            && let Some(obj) = map.as_object()
        {
            for (k, v) in obj {
                if let Some(component) = v.as_str() {
                    directive_config
                        .component_map
                        .insert(k.to_ascii_lowercase(), component.to_string());
                }
            }
        }

        Self {
            jsx_import_source,
            enable_heading_autolinks,
            directive_config,
        }
    }

    /// Reconstruct a `CompilerConfig` that preserves all settings including
    /// directive configuration, for passing to `compile_ir`.
    pub(crate) fn to_compiler_config(&self) -> CompilerConfig {
        let custom_directive_names = if self.directive_config.custom_names.is_empty() {
            None
        } else {
            Some(self.directive_config.custom_names.clone())
        };
        let directive_component_map = if self.directive_config.component_map.is_empty() {
            None
        } else {
            let map: serde_json::Map<String, serde_json::Value> = self
                .directive_config
                .component_map
                .iter()
                .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
                .collect();
            Some(serde_json::Value::Object(map))
        };

        CompilerConfig {
            jsx_import_source: Some(self.jsx_import_source.clone()),
            enable_heading_autolinks: Some(self.enable_heading_autolinks),
            custom_directive_names,
            directive_component_map,
            ..CompilerConfig::default()
        }
    }
}

/// Stateful compiler exposed to Node callers.
#[napi]
pub struct XmdxCompiler {
    pub(crate) config: InternalCompilerConfig,
}

#[napi]
impl XmdxCompiler {
    #[napi(constructor)]
    /// Creates a compiler that can be reused across Vite transform hooks.
    pub fn new(config: Option<CompilerConfig>) -> Self {
        Self {
            config: InternalCompilerConfig::new(config),
        }
    }

    /// Compiles Markdown/MDX into an Astro-compatible module string.
    ///
    /// Internally this delegates to `compile_ir` for parsing/rewriting, then
    /// formats the legacy Astro module code. A future adapter hook can replace
    /// the codegen step without changing the JS-facing signature.
    #[napi(js_name = "compile")]
    pub fn compile_mdx(
        &self,
        source: String,
        filepath: String,
        options: Option<FileOptions>,
    ) -> napi::Result<CompileResult> {
        // Parse to IR first (framework-agnostic data).
        let ir = compile_ir(
            source.clone(),
            filepath.clone(),
            options.clone(),
            Some(self.config.to_compiler_config()),
        )?;

        compile_document_from_ir(ir)
    }

    /// Compiles multiple Markdown/MDX files in parallel using Rayon.
    ///
    /// This method uses the compiler's configuration for all files and processes
    /// them concurrently for faster batch compilation. Returns IR results.
    ///
    /// # Arguments
    ///
    /// * `inputs` - Array of files to compile
    /// * `options` - Optional batch processing options (thread count, error handling)
    ///
    /// # Returns
    ///
    /// Returns a `BatchProcessingResult` containing individual IR results and statistics.
    #[napi(js_name = "compileBatch")]
    pub fn compile_batch(
        &self,
        inputs: Vec<BatchInput>,
        options: Option<BatchOptions>,
    ) -> napi::Result<BatchProcessingResult> {
        let start = Instant::now();
        let opts = options.unwrap_or_default();
        let continue_on_error = opts.continue_on_error.unwrap_or(true);

        // Use compiler's config, ignoring any config in batch options
        let config = Some(self.config.to_compiler_config());

        // Configure thread pool if max_threads is specified
        let pool = if let Some(max_threads) = opts.max_threads {
            rayon::ThreadPoolBuilder::new()
                .num_threads(max_threads as usize)
                .build()
                .ok()
        } else {
            None
        };

        let total = inputs.len() as u32;
        let succeeded = AtomicU32::new(0);
        let failed = AtomicU32::new(0);

        let process_input = |input: BatchInput| -> BatchResult {
            let filepath = input.filepath.clone().unwrap_or_else(|| input.id.clone());
            match compile_ir(input.source, filepath, None, config.clone()) {
                Ok(result) => {
                    succeeded.fetch_add(1, Ordering::Relaxed);
                    BatchResult {
                        id: input.id,
                        result: Some(result),
                        error: None,
                    }
                }
                Err(e) => {
                    failed.fetch_add(1, Ordering::Relaxed);
                    BatchResult {
                        id: input.id,
                        result: None,
                        error: Some(e.to_string()),
                    }
                }
            }
        };

        let results: Vec<BatchResult> = if continue_on_error {
            // Process all files regardless of errors
            if let Some(pool) = pool {
                pool.install(|| inputs.into_par_iter().map(process_input).collect())
            } else {
                inputs.into_par_iter().map(process_input).collect()
            }
        } else {
            // Stop on first error - sequential processing required
            let mut results = Vec::with_capacity(inputs.len());
            let mut had_error = false;

            for input in inputs {
                if had_error {
                    break;
                }
                let result = process_input(input);
                if result.error.is_some() {
                    had_error = true;
                }
                results.push(result);
            }
            results
        };

        let elapsed = start.elapsed();

        Ok(BatchProcessingResult {
            results,
            stats: BatchStats {
                total,
                succeeded: succeeded.load(Ordering::Relaxed),
                failed: failed.load(Ordering::Relaxed),
                processing_time_ms: elapsed.as_secs_f64() * 1000.0,
            },
        })
    }

    /// Compiles multiple Markdown/MDX files to complete Astro modules in parallel.
    ///
    /// Unlike `compileBatch` which returns IR for further processing in TypeScript,
    /// this method returns complete Astro module code ready for esbuild transformation.
    /// This eliminates the need for TypeScript's `wrapHtmlInJsxModule` step.
    ///
    /// # Arguments
    ///
    /// * `inputs` - Array of files to compile
    /// * `options` - Optional batch processing options (thread count, error handling)
    ///
    /// # Returns
    ///
    /// Returns a `ModuleBatchProcessingResult` containing complete module code and statistics.
    #[napi(js_name = "compileBatchToModule")]
    pub fn compile_batch_to_module(
        &self,
        inputs: Vec<BatchInput>,
        options: Option<BatchOptions>,
    ) -> napi::Result<ModuleBatchProcessingResult> {
        let start = Instant::now();
        let opts = options.unwrap_or_default();
        let continue_on_error = opts.continue_on_error.unwrap_or(true);

        // Use compiler's config, ignoring any config in batch options
        let config = Some(self.config.to_compiler_config());

        // Configure thread pool if max_threads is specified
        let pool = if let Some(max_threads) = opts.max_threads {
            rayon::ThreadPoolBuilder::new()
                .num_threads(max_threads as usize)
                .build()
                .ok()
        } else {
            None
        };

        let total = inputs.len() as u32;
        let succeeded = AtomicU32::new(0);
        let failed = AtomicU32::new(0);

        let process_input = |input: BatchInput| -> ModuleBatchResult {
            let filepath = input.filepath.clone().unwrap_or_else(|| input.id.clone());
            match compile_ir(input.source, filepath, None, config.clone()) {
                Ok(ir) => {
                    // Convert IR to complete module
                    match compile_document_from_ir(ir) {
                        Ok(result) => {
                            succeeded.fetch_add(1, Ordering::Relaxed);
                            ModuleBatchResult {
                                id: input.id,
                                result: Some(result),
                                error: None,
                            }
                        }
                        Err(e) => {
                            failed.fetch_add(1, Ordering::Relaxed);
                            ModuleBatchResult {
                                id: input.id,
                                result: None,
                                error: Some(e.to_string()),
                            }
                        }
                    }
                }
                Err(e) => {
                    failed.fetch_add(1, Ordering::Relaxed);
                    ModuleBatchResult {
                        id: input.id,
                        result: None,
                        error: Some(e.to_string()),
                    }
                }
            }
        };

        let results: Vec<ModuleBatchResult> = if continue_on_error {
            // Process all files regardless of errors
            if let Some(pool) = pool {
                pool.install(|| inputs.into_par_iter().map(process_input).collect())
            } else {
                inputs.into_par_iter().map(process_input).collect()
            }
        } else {
            // Stop on first error - sequential processing required
            let mut results = Vec::with_capacity(inputs.len());
            let mut had_error = false;

            for input in inputs {
                if had_error {
                    break;
                }
                let result = process_input(input);
                if result.error.is_some() {
                    had_error = true;
                }
                results.push(result);
            }
            results
        };

        let elapsed = start.elapsed();

        Ok(ModuleBatchProcessingResult {
            results,
            stats: BatchStats {
                total,
                succeeded: succeeded.load(Ordering::Relaxed),
                failed: failed.load(Ordering::Relaxed),
                processing_time_ms: elapsed.as_secs_f64() * 1000.0,
            },
        })
    }
}

#[napi]
/// Helper factory exposed to JavaScript for ergonomic reuse.
pub fn create_compiler(config: Option<CompilerConfig>) -> XmdxCompiler {
    XmdxCompiler::new(config)
}

/// Compiles Markdown/MDX and returns a neutral IR.
#[napi(js_name = "compileIr")]
pub fn compile_ir(
    source: String,
    filepath: String,
    options: Option<FileOptions>,
    config: Option<CompilerConfig>,
) -> napi::Result<CompileIrResult> {
    let internal = InternalCompilerConfig::new(config);
    let options = options.unwrap_or_default();
    let effective_path = options.file.clone().unwrap_or_else(|| filepath.clone());

    let frontmatter_extraction = xmdx_core::extract_frontmatter(&source)
        .map_err(|err| super::convert_error(MarkflowError::parse_error(err.to_string(), 1, 1)))?;
    let frontmatter = frontmatter_extraction.value;
    let raw_body = source[frontmatter_extraction.body_start..].to_string();

    // Extract all imports/exports from the document (not just leading ones)
    // Uses code fence tracking to avoid extracting imports inside code blocks
    let (hoisted_statements, body_lines) = code_fence::collect_root_statements(&raw_body);
    let body_without_imports = body_lines.join("\n");
    let has_user_default_export = hoisted_statements
        .exports
        .iter()
        .any(|s| s.trim_start().starts_with("export default"));

    // Use mdast pipeline to generate blocks
    let mdast_options = MdastOptions {
        enable_directives: true,
        allow_raw_html: false,
        enable_heading_autolinks: internal.enable_heading_autolinks,
        ..Default::default()
    };
    let blocks_result = to_blocks(&body_without_imports, &mdast_options).map_err(|err| {
        super::convert_error(with_path(
            MarkflowError::parse_error(err, 1, 1),
            &effective_path,
        ))
    })?;

    // Convert blocks to JSX module string with directive mapping
    let directive_config = &internal.directive_config;
    let directive_mapper = |name: &str| -> Option<DirectiveMappingResult> {
        // When custom names are configured, only map those names.
        // Otherwise use the default built-in set.
        let is_known = if directive_config.custom_names.is_empty() {
            let defaults = ["note", "tip", "caution", "danger"];
            defaults.contains(&name)
        } else {
            directive_config.custom_names.iter().any(|n| n == name)
        };
        if is_known {
            let tag_name = directive_config.component_for(name).to_string();
            Some(DirectiveMappingResult {
                tag_name,
                type_prop: Some(name.to_string()),
            })
        } else {
            None
        }
    };
    let jsx_body = blocks_to_jsx_string(&blocks_result.blocks, Some(directive_mapper));

    // mdast doesn't produce diagnostics yet - return empty warnings
    let diagnostics = Diagnostics { warnings: vec![] };

    // Use headings from mdast blocks_result
    let headings: Vec<_> = blocks_result
        .headings
        .into_iter()
        .map(|h| super::HeadingEntry {
            depth: h.depth,
            slug: h.slug,
            text: h.text,
        })
        .collect();
    let layout_import: Option<String> = frontmatter
        .get("layout")
        .and_then(|value| value.as_str())
        .map(|s| s.to_string());

    let frontmatter_json = serde_json::to_string(&frontmatter).unwrap_or_else(|_| "{}".to_string());

    // Build separate import and export specs
    let hoisted_imports: Vec<ImportSpec> = hoisted_statements
        .imports
        .into_iter()
        .map(|source| ImportSpec {
            source,
            kind: ImportKind::Hoisted,
        })
        .collect();

    let hoisted_exports: Vec<ExportSpec> = hoisted_statements
        .exports
        .into_iter()
        .map(|source| {
            let is_default = source.trim_start().starts_with("export default");
            ExportSpec { source, is_default }
        })
        .collect();

    Ok(CompileIrResult {
        html: jsx_body,
        hoisted_imports,
        hoisted_exports,
        frontmatter_json,
        headings,
        file_path: effective_path,
        url: options.url.clone(),
        layout_import,
        runtime_import: internal.jsx_import_source,
        diagnostics,
        has_user_default_export,
    })
}

fn with_path(err: MarkflowError, path: &str) -> MarkflowError {
    match err {
        MarkflowError::MarkdownAdapter { message, location } => MarkflowError::MarkdownAdapter {
            message: format!("{} ({})", message, path),
            location,
        },
        other => other,
    }
}

pub(crate) fn compile_document_from_ir(ir: CompileIrResult) -> napi::Result<CompileResult> {
    let hoisted_imports = super::dedupe_imports(
        ir.hoisted_imports
            .iter()
            .map(|spec| spec.source.clone())
            .collect(),
    );
    // Include all exports (including default) - the has_user_default_export flag
    // only controls whether we generate `export default MarkflowContent`
    let hoisted_exports: Vec<String> = ir
        .hoisted_exports
        .iter()
        .map(|spec| spec.source.clone())
        .collect();
    let headings_json = serde_json::to_string(&ir.headings).unwrap_or_else(|_| "[]".to_string());
    let code = super::codegen::generate_module_code_from_ir(
        &ir,
        &hoisted_imports,
        &hoisted_exports,
        &headings_json,
    )?;
    let imports = super::build_import_list(ir.layout_import.as_deref(), Path::new(&ir.file_path));

    Ok(CompileResult {
        code,
        map: None,
        frontmatter_json: ir.frontmatter_json,
        headings: ir.headings,
        imports,
        diagnostics: ir.diagnostics,
    })
}

#[cfg(test)]
pub(crate) fn compile_document(
    config: &InternalCompilerConfig,
    source: String,
    filepath: String,
    options: Option<FileOptions>,
    hoisted_imports: Vec<String>,
) -> napi::Result<CompileResult> {
    let mut ir = compile_ir(source, filepath, options, Some(config.to_compiler_config()))?;

    if !hoisted_imports.is_empty() {
        ir.hoisted_imports
            .extend(hoisted_imports.into_iter().map(|source| ImportSpec {
                source,
                kind: ImportKind::Hoisted,
            }));
    }

    compile_document_from_ir(ir)
}
