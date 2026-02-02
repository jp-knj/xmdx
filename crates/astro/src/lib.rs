#![deny(missing_docs)]
//! xmdx Astro engine: mdast rendering, component registry, and codegen.

/// Code generation utilities for Astro/MDX output.
pub mod codegen;
/// Component registry for directive/component mappings.
pub mod registry;
/// Rendering layer (MDAST-based block renderer).
pub mod renderer;
/// Transform utilities (directives, JSX normalization, smartypants).
pub mod transform;

pub use registry::{
    ComponentDefinition, DirectiveMapping, PropSource, RegistryConfig, SlotNormalization,
};
pub use renderer::mdast::{
    BlocksResult, HeadingEntry, Options as MdastOptions, PropValue, RenderBlock, to_blocks,
};
pub use transform::{code_fence, directives};
