#![deny(missing_docs)]
//! Markflow core: markdown parsing utilities, frontmatter extraction, and slugs.

/// Core error and diagnostic types.
pub mod error;
/// YAML frontmatter extraction helpers.
pub mod frontmatter;
/// MDX compilation using mdxjs-rs.
pub mod mdx_compiler;
/// Markdown parsing utilities and extension hooks.
pub mod parse;
/// Slug generation utilities.
pub mod slug;

pub use error::{
    ErrorSeverity, MarkflowError, ParseDiagnostics, ParseWarning, RecoverableError, SourceLocation,
};
pub use frontmatter::{FrontmatterError, FrontmatterExtraction, extract_frontmatter};
pub use mdx_compiler::{MdxCompileError, MdxCompileOptions, MdxHeading, MdxOutput, compile_mdx};
pub use parse::{
    AstTransform, ParseOptions, ParserPipeline, TextTransform, parse_mdast,
    parse_mdast_with_options,
};
pub use slug::{Slugger, slugify};
