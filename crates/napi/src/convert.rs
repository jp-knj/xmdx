use crate::types::{BlockOptions, NapiHeadingEntry, NapiRenderBlock, ParseBlocksResult};
use std::collections::HashMap;
use xmdx_astro::{BlocksResult, HeadingEntry, MdastOptions, PropValue, RenderBlock};

/// Converts `BlockOptions` to `MdastOptions`.
pub fn to_mdast_options(opts: Option<BlockOptions>) -> MdastOptions {
    match opts {
        Some(o) => MdastOptions {
            enable_directives: o.enable_directives.unwrap_or(false),
            enable_smartypants: o.enable_smartypants.unwrap_or(false),
            enable_lazy_images: o.enable_lazy_images.unwrap_or(false),
            allow_raw_html: o.allow_raw_html.unwrap_or(true),
            enable_heading_autolinks: o.enable_heading_autolinks.unwrap_or(false),
        },
        None => MdastOptions {
            enable_directives: false,
            enable_smartypants: false,
            enable_lazy_images: false,
            allow_raw_html: true,
            enable_heading_autolinks: false,
        },
    }
}

/// Converts a `RenderBlock` to a `NapiRenderBlock`.
fn convert_render_block(block: &RenderBlock) -> NapiRenderBlock {
    match block {
        RenderBlock::Html { content } => NapiRenderBlock {
            r#type: "html".to_string(),
            content: Some(content.clone()),
            name: None,
            props: None,
            slot_children: None,
            code: None,
            lang: None,
            meta: None,
        },
        RenderBlock::Component {
            name,
            props,
            slot_children,
        } => NapiRenderBlock {
            r#type: "component".to_string(),
            content: None,
            name: Some(name.clone()),
            props: Some(convert_props(props)),
            slot_children: Some(slot_children.iter().map(convert_render_block).collect()),
            code: None,
            lang: None,
            meta: None,
        },
        RenderBlock::Code { code, lang, meta } => NapiRenderBlock {
            r#type: "code".to_string(),
            content: None,
            name: None,
            props: None,
            slot_children: None,
            code: Some(code.clone()),
            lang: lang.clone(),
            meta: meta.clone(),
        },
    }
}

/// Converts props HashMap<String, PropValue> to HashMap<String, String>.
///
/// Values are JSON-encoded so the JS side can distinguish literals from expressions.
fn convert_props(props: &HashMap<String, PropValue>) -> HashMap<String, String> {
    props
        .iter()
        .map(|(k, v)| {
            let serialized = serde_json::to_string(v).unwrap_or_default();
            (k.clone(), serialized)
        })
        .collect()
}

/// Converts a `HeadingEntry` to a `NapiHeadingEntry`.
fn convert_heading(h: &HeadingEntry) -> NapiHeadingEntry {
    NapiHeadingEntry {
        depth: h.depth as u32,
        slug: h.slug.clone(),
        text: h.text.clone(),
    }
}

/// Converts a `BlocksResult` to a `ParseBlocksResult`.
pub fn convert_blocks_result(result: &BlocksResult) -> ParseBlocksResult {
    ParseBlocksResult {
        blocks: result.blocks.iter().map(convert_render_block).collect(),
        headings: result.headings.iter().map(convert_heading).collect(),
    }
}
