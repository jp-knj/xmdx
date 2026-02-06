//! Batch processing types and utilities for parallel compilation.

use crate::types::{CompileIrResult, CompilerConfig, MdxCompileResult};
use napi_derive::napi;

/// Input for batch processing - represents a single file to compile.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct BatchInput {
    /// File identifier (typically the file path).
    pub id: String,
    /// Markdown/MDX source content.
    pub source: String,
    /// Optional filepath override for error messages and file type detection.
    pub filepath: Option<String>,
}

/// Result for a single file in a batch.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct BatchResult {
    /// File identifier matching the input.
    pub id: String,
    /// Compilation result (present on success).
    pub result: Option<CompileIrResult>,
    /// Error message (present on failure).
    pub error: Option<String>,
}

/// Statistics for batch processing.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct BatchStats {
    /// Total number of files processed.
    pub total: u32,
    /// Number of successfully compiled files.
    pub succeeded: u32,
    /// Number of failed compilations.
    pub failed: u32,
    /// Total processing time in milliseconds.
    pub processing_time_ms: f64,
}

/// Options for batch processing.
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct BatchOptions {
    /// Maximum number of threads to use. Defaults to number of CPU cores.
    pub max_threads: Option<u32>,
    /// Whether to continue processing after an error. Defaults to true.
    pub continue_on_error: Option<bool>,
    /// Compiler configuration to use for all files.
    pub config: Option<CompilerConfig>,
}

/// Result of batch processing containing all results and statistics.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct BatchProcessingResult {
    /// Individual results for each input file.
    pub results: Vec<BatchResult>,
    /// Processing statistics.
    pub stats: BatchStats,
}

/// Result for a single MDX file in a batch.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct MdxBatchResult {
    /// File identifier matching the input.
    pub id: String,
    /// Compilation result (present on success).
    pub result: Option<MdxCompileResult>,
    /// Error message (present on failure).
    pub error: Option<String>,
}

/// Result of MDX batch processing containing all results and statistics.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct MdxBatchProcessingResult {
    /// Individual results for each input file.
    pub results: Vec<MdxBatchResult>,
    /// Processing statistics.
    pub stats: BatchStats,
}

/// Result for a single file in a module batch.
/// Unlike BatchResult which returns IR, this returns complete module code.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ModuleBatchResult {
    /// File identifier matching the input.
    pub id: String,
    /// Compilation result with complete module code (present on success).
    pub result: Option<crate::types::CompileResult>,
    /// Error message (present on failure).
    pub error: Option<String>,
}

/// Result of module batch processing containing all results and statistics.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ModuleBatchProcessingResult {
    /// Individual results for each input file.
    pub results: Vec<ModuleBatchResult>,
    /// Processing statistics.
    pub stats: BatchStats,
}
