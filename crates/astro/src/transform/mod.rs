//! Transform utilities for markdown processing.
//!
//! - `code_fence`: tracks fenced blocks to avoid hoisting/rewrites inside them.
//! - `directives`: directive mapping traits and default implementations.
//! - `jsx_normalize`: JSX indentation normalization for MDAST rendering.
//! - `smartypants`: smart punctuation transformations (quotes, dashes, ellipsis).

/// Code fence state tracking utilities.
pub mod code_fence;
/// Astro docs component rewrite helpers.
pub mod components;
/// Directive mapping traits and default implementations.
pub mod directives;
/// JSX indentation normalization for MDAST rendering.
pub mod jsx_normalize;
/// Smart punctuation transformations (quotes, dashes, ellipsis).
pub mod smartypants;
