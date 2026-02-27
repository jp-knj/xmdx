//! MDAST-based Markdown to HTML renderer.
//!
//! This module provides a markdown renderer using the markdown-rs AST (MDAST).
//! It converts markdown input to a list of rendering blocks (HTML or Component)
//! suitable for Astro/Starlight integration.
//!
//! # Module Structure
//!
//! - `types` - Type definitions (PropValue, RenderBlock, HeadingEntry, etc.)
//! - `context` - Rendering context for tracking state during traversal
//! - `render` - AST node rendering functions
//! - `directives` - Directive syntax preprocessing

mod context;
mod directives;
pub mod render;
mod types;

pub use context::Context;
pub use types::{AsideMeta, BlocksResult, CardMeta, HeadingEntry, PropValue, RenderBlock, Scope};

use crate::transform::jsx_normalize::{
    collapse_multiline_wrapper_tags, normalize_list_jsx_components, normalize_mdx_jsx_indentation,
};
use crate::transform::smartypants::apply_smartypants;
use render::render_node;
use xmdx_core::MarkflowError;

/// Rendering options for the mdast renderer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Options {
    /// Whether directive processing is enabled.
    #[serde(default)]
    pub enable_directives: bool,
    /// Whether to apply smart punctuation transformations.
    #[serde(default)]
    pub enable_smartypants: bool,
    /// Whether to add loading="lazy" to images.
    #[serde(default)]
    pub enable_lazy_images: bool,
    /// Whether to allow raw HTML (<script>, <style>, etc.) to pass through.
    /// When enabled, markdown-rs parses these as HTML nodes instead of MDX JSX,
    /// avoiding parse errors on trusted docs content that mixes raw tags.
    #[serde(default = "default_allow_raw_html")]
    pub allow_raw_html: bool,
    /// Whether to wrap heading content in anchor links for self-linking.
    /// When enabled, each heading gets an `<a>` element linking to itself.
    #[serde(default)]
    pub enable_heading_autolinks: bool,
    /// Whether to enable math syntax ($inline$ and $$block$$).
    /// When enabled, math expressions are rendered as `<MathBlock>` and `<MathInline>` components.
    #[serde(default)]
    pub enable_math: bool,
}

impl Options {
    /// Returns whether lazy image loading is enabled.
    pub fn lazy_images(&self) -> bool {
        self.enable_lazy_images
    }

    /// Returns whether raw HTML passthrough is enabled.
    pub fn allow_raw_html(&self) -> bool {
        self.allow_raw_html
    }

    /// Returns whether heading autolinks are enabled.
    pub fn heading_autolinks(&self) -> bool {
        self.enable_heading_autolinks
    }
}

fn default_allow_raw_html() -> bool {
    false
}

impl Default for Options {
    fn default() -> Self {
        Self {
            enable_directives: false,
            enable_smartypants: false,
            enable_lazy_images: false,
            allow_raw_html: default_allow_raw_html(),
            enable_heading_autolinks: false,
            enable_math: false,
        }
    }
}

/// Converts Markdown input to rendering blocks (entry point).
///
/// # Arguments
///
/// * `input` - The markdown text to convert
/// * `options` - Rendering options (CSS injection, directives, etc.)
///
/// # Returns
///
/// * `Ok(BlocksResult)` - Rendering blocks with heading metadata
/// * `Err(String)` - Error message if parsing fails
///
/// # Examples
///
/// ```
/// use xmdx_astro::renderer::mdast::{to_blocks, Options};
///
/// let input = "Hello, [world](https://example.com)!";
/// let options = Options {
///     enable_directives: false,
///     ..Default::default()
/// };
/// let blocks = to_blocks(input, &options).unwrap();
/// ```
pub fn to_blocks(input: &str, options: &Options) -> Result<BlocksResult, MarkflowError> {
    // 1. Preprocess directives if enabled
    let preprocessed = if options.enable_directives {
        directives::preprocess_directives(input)
    } else {
        input.to_string()
    };

    // 2. Collapse multiline wrapper tags to prevent tag mismatch errors
    let collapsed = collapse_multiline_wrapper_tags(&preprocessed);

    // 3. Normalize JSX indentation to prevent content from being treated as code blocks
    let normalized = normalize_mdx_jsx_indentation(&collapsed);

    // 4. Normalize list-embedded JSX components (tab components in lists)
    let normalized = normalize_list_jsx_components(&normalized);

    // 5. Mask raw <script>/<style> blocks only when raw HTML passthrough is disabled.
    let (parsed_input, raw_masks) = if options.allow_raw_html() {
        (normalized.clone(), Vec::new())
    } else {
        mask_raw_html_blocks(&normalized)
    };

    // 6. Parse markdown to MDAST with enhanced options
    let parse_options = markdown::ParseOptions {
        constructs: markdown::Constructs {
            // Disable indented code blocks - MDX content inside JSX components
            // is often indented 4+ spaces for readability, which would otherwise
            // be parsed as code blocks instead of paragraphs
            code_indented: false,
            // MDX: JSX support for <Component>...</Component>
            mdx_jsx_flow: true,
            mdx_jsx_text: true,
            // HTML: allow raw tags when configured (trusted docs content)
            html_flow: options.allow_raw_html(),
            html_text: options.allow_raw_html(),
            // Enable frontmatter (--- ... ---)
            frontmatter: true,
            // GitHub Flavored Markdown features
            gfm_autolink_literal: true,
            gfm_footnote_definition: true,
            gfm_label_start_footnote: true,
            gfm_strikethrough: true,
            gfm_table: true,
            gfm_task_list_item: true,
            // Math: $inline$ and $$block$$
            math_flow: options.enable_math,
            math_text: options.enable_math,
            ..markdown::Constructs::default()
        },
        math_text_single_dollar: options.enable_math,
        ..markdown::ParseOptions::default()
    };

    let tree = markdown::to_mdast(&parsed_input, &parse_options)
        .map_err(|e| MarkflowError::parse_error(format!("Markdown parse error: {}", e), 1, 1))?;

    // 7. Traverse the AST and render to blocks
    let mut ctx = Context::new(options);
    render_node(&tree, &mut ctx);

    // 8. Finish and get blocks, then unmask raw HTML that was temporarily hidden
    let mut result = ctx.finish();
    unmask_raw_html_blocks(&mut result.blocks, &raw_masks);

    // 9. Apply smartypants if enabled
    if options.enable_smartypants {
        for block in &mut result.blocks {
            if let RenderBlock::Html { content } = block {
                *content = apply_smartypants(content);
            }
        }
    }

    Ok(result)
}

/// A raw HTML block (script/style) that was temporarily masked during parsing.
#[derive(Debug, Clone)]
struct RawHtmlMask {
    marker: String,
    html: String,
}

/// Replace `<script>` / `<style>` blocks with stable markers before parsing so they
/// don't get rejected by the HTML parser when `html_flow` is disabled.
fn mask_raw_html_blocks(input: &str) -> (String, Vec<RawHtmlMask>) {
    let mut output = String::with_capacity(input.len());
    let mut masks = Vec::new();
    let mut cursor = 0;

    while let Some((line_start, after_line, fence_delim)) = find_fence_start(&input[cursor..]) {
        // absolute positions
        let abs_line_start = cursor + line_start;
        let abs_after_line = cursor + after_line;

        // Mask any raw HTML that appears before the fence line
        let plain = &input[cursor..abs_line_start];
        mask_in_plain_text(plain, &mut output, &mut masks);

        // Find fence end - search starts AFTER the opening fence line
        if let Some(end_rel) = find_fence_end(&input[abs_after_line..], &fence_delim) {
            let abs_end = abs_after_line + end_rel;
            // Copy entire fence including opening line, content, and closing line
            output.push_str(&input[abs_line_start..abs_end]);
            cursor = abs_end;
        } else {
            // No closing fence; push remainder and finish
            output.push_str(&input[abs_line_start..]);
            cursor = input.len();
            break;
        }
    }

    // Mask any trailing plain text
    if cursor < input.len() {
        let plain = &input[cursor..];
        mask_in_plain_text(plain, &mut output, &mut masks);
    }

    (output, masks)
}

/// Restore masked raw HTML markers back into rendered HTML/slot strings.
fn unmask_raw_html_blocks(blocks: &mut [RenderBlock], masks: &[RawHtmlMask]) {
    if masks.is_empty() {
        return;
    }

    for block in blocks {
        match block {
            RenderBlock::Html { content } => {
                for mask in masks {
                    if content.contains(&mask.marker) {
                        *content = content.replace(&mask.marker, &mask.html);
                    }
                }
            }
            RenderBlock::Component { slot_children, .. } => {
                // Recursively unmask slot_children
                unmask_raw_html_blocks(slot_children, masks);
            }
            RenderBlock::Code { .. } => {
                // Code blocks don't contain raw HTML markers, skip
            }
        }
    }
}

/// Simple helper to locate the next <script>...</script> or <style>...</style> block.
struct TagMatch<'a> {
    start: usize,
    end: usize,
    block: &'a str,
}

fn find_next_tag(input: &str) -> Option<TagMatch<'_>> {
    let lower = input.to_ascii_lowercase();
    let script_pos = lower.find("<script");
    let style_pos = lower.find("<style");

    let (start, kind) = match (script_pos, style_pos) {
        (Some(s), Some(t)) => {
            if s < t {
                (s, "script")
            } else {
                (t, "style")
            }
        }
        (Some(s), None) => (s, "script"),
        (None, Some(t)) => (t, "style"),
        (None, None) => return None,
    };

    let closing = format!("</{}>", kind);
    let lower_tail = &lower[start..];
    let close_rel = lower_tail.find(&closing)?;
    let end = start + close_rel + closing.len();
    Some(TagMatch {
        start,
        end,
        block: &input[start..end],
    })
}

/// Mask script/style tags in a chunk of plain (non-code-fence) text.
fn mask_in_plain_text(segment: &str, out: &mut String, masks: &mut Vec<RawHtmlMask>) {
    let mut rest = segment;
    while let Some(pos) = find_next_tag(rest) {
        out.push_str(&rest[..pos.start]);
        let marker = format!("XMDXRAWBLOCK{}MARK", masks.len());
        out.push_str(&marker);
        masks.push(RawHtmlMask {
            marker,
            html: pos.block.to_string(),
        });
        rest = &rest[pos.end..];
    }
    out.push_str(rest);
}

/// Locate the next code fence start (``` or ~~~) returning line start offset, after-line offset, and delimiter.
/// Returns (line_offset, after_line_offset, delimiter) where after_line_offset is the position after the opening fence line.
fn find_fence_start(input: &str) -> Option<(usize, usize, String)> {
    let mut offset = 0;
    for line in input.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let delim: String = trimmed
                .chars()
                .take_while(|c| *c == '`' || *c == '~')
                .collect();
            // Calculate the position after this entire line (i.e., start of next line)
            let after_line = offset + line.len();
            return Some((offset, after_line, delim));
        }
        offset += line.len();
    }
    None
}

/// Locate the matching closing fence after a start; returns relative end index just after fence line.
fn find_fence_end(input: &str, delim: &str) -> Option<usize> {
    let mut offset = 0;
    for line in input.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with(delim) {
            return Some(offset + line.len());
        }
        offset += line.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_text() {
        let input = "Hello, world!";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);
        match &blocks.blocks[0] {
            RenderBlock::Html { content } => {
                assert!(content.contains("Hello, world!"));
            }
            _ => panic!("Expected HTML block"),
        }
    }

    #[test]
    fn test_paragraph() {
        let input = "This is a paragraph.";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);
        match &blocks.blocks[0] {
            RenderBlock::Html { content } => {
                assert_eq!(content, "<p>This is a paragraph.</p>");
            }
            _ => panic!("Expected HTML block"),
        }
    }

    #[test]
    fn test_link() {
        let input = "[Rust](https://www.rust-lang.org/)";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);
        match &blocks.blocks[0] {
            RenderBlock::Html { content } => {
                assert!(content.contains(r#"<a href="https://www.rust-lang.org/""#));
                assert!(content.contains("Rust</a>"));
            }
            _ => panic!("Expected HTML block"),
        }
    }

    #[test]
    fn test_directive_to_component() {
        let input = ":::note[My Title]\nThis is **important** content.\n:::";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);

        match &blocks.blocks[0] {
            RenderBlock::Component {
                name,
                props,
                slot_children,
            } => {
                assert_eq!(name, "Aside");
                assert_eq!(props.get("type"), Some(&PropValue::literal("note")));
                assert_eq!(props.get("title"), Some(&PropValue::literal("My Title")));
                // Check that slot_children contains the expected HTML
                let has_content = slot_children.iter().any(|b| match b {
                    RenderBlock::Html { content } => {
                        content.contains("<p>This is <strong>important</strong> content.</p>")
                    }
                    _ => false,
                });
                assert!(
                    has_content,
                    "Expected slot_children to contain paragraph, got: {:?}",
                    slot_children
                );
            }
            _ => panic!("Expected Component block"),
        }
    }

    #[test]
    fn test_directive_without_title() {
        let input = ":::tip\nHelpful advice here.\n:::";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);

        match &blocks.blocks[0] {
            RenderBlock::Component {
                name,
                props,
                slot_children,
            } => {
                assert_eq!(name, "Aside");
                assert_eq!(props.get("type"), Some(&PropValue::literal("tip")));
                assert!(props.get("title").is_none());
                let has_content = slot_children.iter().any(|b| match b {
                    RenderBlock::Html { content } => content.contains("Helpful advice"),
                    _ => false,
                });
                assert!(
                    has_content,
                    "Expected slot_children to contain advice, got: {:?}",
                    slot_children
                );
            }
            _ => panic!("Expected Component block"),
        }
    }

    #[test]
    fn test_directive_disabled() {
        let input = ":::note\nContent\n:::";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        match &blocks.blocks[0] {
            RenderBlock::Html { content } => {
                assert!(content.contains(":::note"));
            }
            _ => panic!("Expected HTML block when directives disabled"),
        }
    }

    #[test]
    fn test_standard_markdown_elements() {
        let input = r#"# Heading 1
## Heading 2

- List Item 1
- List Item 2

> Blockquote

```rust
fn main() {}
```

![Alt text](image.png "Title")

---
"#;
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };
        let blocks = to_blocks(input, &options).unwrap();
        // With structured code blocks, we expect multiple blocks now:
        // HTML block (headings, list, blockquote), Code block, HTML block (image, hr)
        assert!(
            blocks.blocks.len() >= 2,
            "Expected multiple blocks, got {}",
            blocks.blocks.len()
        );

        // Check HTML content is present somewhere in the blocks
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");
        assert!(all_html.contains("<h1 id=") && all_html.contains(">Heading 1</h1>"));
        assert!(all_html.contains("<h2 id=") && all_html.contains(">Heading 2</h2>"));
        assert!(all_html.contains("<ul>"));
        assert!(all_html.contains("<li>"));
        assert!(all_html.contains("<blockquote>"));
        assert!(all_html.contains(r#"<img src="image.png""#));
        assert!(all_html.contains("<hr />"));

        // Code block should be a separate RenderBlock::Code
        let code_block = blocks
            .blocks
            .iter()
            .find(|b| matches!(b, RenderBlock::Code { .. }));
        assert!(code_block.is_some(), "Expected Code block");
        if let Some(RenderBlock::Code { code, lang, .. }) = code_block {
            assert_eq!(lang.as_deref(), Some("rust"));
            assert!(code.contains("fn main() {}"));
        }
    }

    #[test]
    fn test_task_list() {
        let input = "- [ ] Unchecked task\n- [x] Checked task\n";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };
        let blocks = to_blocks(input, &options).unwrap();

        assert_eq!(blocks.blocks.len(), 1);
        if let RenderBlock::Html { content } = &blocks.blocks[0] {
            assert!(content.contains(r#"class="task-list-item""#));
            assert!(content.contains(r#"type="checkbox""#));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_ordered_list() {
        let input = "1. First\n2. Second\n3. Third\n";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };
        let blocks = to_blocks(input, &options).unwrap();

        assert_eq!(blocks.blocks.len(), 1);
        if let RenderBlock::Html { content } = &blocks.blocks[0] {
            assert!(content.contains("<ol>"));
            assert!(content.contains("<li>"));
            assert!(content.contains("</ol>"));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_xss_text_escaping() {
        let input = "Text with <script>alert('xss')</script> and & symbols.";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        assert_eq!(result.blocks.len(), 1);

        match &result.blocks[0] {
            RenderBlock::Html { content } => {
                assert!(content.contains("<script>alert('xss')</script>"));
                assert!(content.contains("&amp; symbols."));
                assert!(content.starts_with("<p>Text with "));
            }
            other => panic!("Expected HTML block, got {:?}", other),
        }
    }

    #[test]
    fn test_xss_attribute_escaping() {
        let input = r#"[Link](http://example.com "Title with <script> and & and ' quotes")"#;
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);

        if let RenderBlock::Html { content } = &blocks.blocks[0] {
            assert!(content.contains("&lt;script&gt;"));
            assert!(content.contains("&amp;"));
            assert!(content.contains("&#39;"));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_xss_image_attributes() {
        let input = r#"![Alt with ' and "](image.png "Title with &")"#;
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);

        if let RenderBlock::Html { content } = &blocks.blocks[0] {
            assert!(content.contains("&#39;"));
            assert!(content.contains("&quot;"));
            assert!(content.contains("&amp;"));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn debug_directive_ast() {
        let input = ":::note[My Title]\nContent\n:::";

        let parse_options = markdown::ParseOptions {
            constructs: markdown::Constructs {
                frontmatter: true,
                gfm_autolink_literal: true,
                gfm_strikethrough: true,
                gfm_table: true,
                gfm_task_list_item: true,
                ..markdown::Constructs::default()
            },
            ..markdown::ParseOptions::default()
        };

        let tree = markdown::to_mdast(input, &parse_options).unwrap();
        assert!(tree.children().is_some());
    }

    #[test]
    fn test_strikethrough() {
        let input = "This is ~~deleted~~ text.";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);

        if let RenderBlock::Html { content } = &blocks.blocks[0] {
            assert!(content.contains("<del>deleted</del>"));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_table() {
        let input = r#"| Name | Age | City |
| :--- | :---: | ---: |
| Alice | 30 | Tokyo |
| Bob | 25 | NYC |"#;
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);

        if let RenderBlock::Html { content } = &blocks.blocks[0] {
            assert!(content.contains("<table>"));
            assert!(content.contains("<thead>"));
            assert!(content.contains("<tbody>"));
            assert!(content.contains("align=\"left\""));
            assert!(content.contains("align=\"center\""));
            assert!(content.contains("align=\"right\""));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_table_with_formatting() {
        let input = r#"| Feature | Status |
| --- | --- |
| **Bold** | ✓ |
| [Link](https://example.com) | ✓ |
| `code` | ✓ |"#;
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);

        if let RenderBlock::Html { content } = &blocks.blocks[0] {
            assert!(content.contains("<strong>Bold</strong>"));
            assert!(content.contains(r#"<a href="https://example.com">"#));
            assert!(content.contains("<code>code</code>"));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_code_block_preserves_newlines() {
        let input = r#"```ts
line1
line2
line3
```"#;
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        assert_eq!(result.blocks.len(), 1);

        if let RenderBlock::Code { code, lang, .. } = &result.blocks[0] {
            assert_eq!(lang.as_deref(), Some("ts"));
            assert!(code.contains("line1\nline2\nline3"));
        } else {
            panic!("Expected Code block, got {:?}", result.blocks[0]);
        }
    }

    #[test]
    fn test_code_block_inside_jsx_preserves_newlines() {
        let input = r#"<Steps>
```ts
line1
line2
line3
```
</Steps>"#;
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();

        let component = result
            .blocks
            .iter()
            .find(|b| matches!(b, RenderBlock::Component { name, .. } if name == "Steps"));
        assert!(component.is_some());

        if let RenderBlock::Component { slot_children, .. } = component.unwrap() {
            // Code block inside component should be a RenderBlock::Code in slot_children
            let code_block = slot_children
                .iter()
                .find(|b| matches!(b, RenderBlock::Code { .. }));
            assert!(
                code_block.is_some(),
                "Expected Code block in slot_children, got: {:?}",
                slot_children
            );
            if let Some(RenderBlock::Code { code, .. }) = code_block {
                assert!(code.contains("line1\nline2\nline3"));
            }
        }
    }

    #[test]
    fn test_indented_directive_inside_steps() {
        let input = r#"<Steps>

1. First step

2. Second step

    <PackageManagerTabs>
    content
    </PackageManagerTabs>

    :::tip
    Some tip content
    :::

3. Third step

</Steps>"#;

        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        let steps_component = result
            .blocks
            .iter()
            .find(|b| matches!(b, RenderBlock::Component { name, .. } if name == "Steps"));
        assert!(steps_component.is_some());

        if let RenderBlock::Component { slot_children, .. } = steps_component.unwrap() {
            // Inside a list context, nested components are rendered inline as HTML
            // So check the HTML content for the Aside component rendered inline
            let all_html: String = slot_children
                .iter()
                .filter_map(|b| match b {
                    RenderBlock::Html { content } => Some(content.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("");

            assert!(
                !all_html.contains("<tip>"),
                "Should not contain raw <tip> tag"
            );
            assert!(
                all_html.contains("<Aside"),
                "Should contain <Aside component tag"
            );
            assert!(
                all_html.contains("type={\"tip\"}"),
                "Should contain type prop: {}",
                all_html
            );
            assert!(
                all_html.contains("Some tip content"),
                "Should contain tip content: {}",
                all_html
            );
        }
    }

    #[test]
    fn test_jsx_component_inside_table_cell() {
        let input = r#"| Header |
| --- |
| <Box>content</Box> |"#;

        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        assert_eq!(result.blocks.len(), 1);

        if let RenderBlock::Html { content } = &result.blocks[0] {
            assert!(content.contains("<td><Box>content</Box></td>"));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_mixed_text_and_component_inside_table_cell() {
        let input = r#"| Col |
| --- |
| before <Aside type="note">tip</Aside> after |"#;

        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        assert_eq!(result.blocks.len(), 1);

        if let RenderBlock::Html { content } = &result.blocks[0] {
            assert!(content.contains("<td>before <Aside type={\"note\"}>tip</Aside> after</td>"));
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_raw_html_passthrough() {
        let input = r#"
# Title

<script is:inline>
  const value = "hello {world}";
  console.log(value);
</script>

<style>
  body { color: red; }
</style>
"#;

        let options = Options {
            allow_raw_html: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        assert_eq!(result.blocks.len(), 1);

        if let RenderBlock::Html { content } = &result.blocks[0] {
            assert!(content.contains("<script is:inline>"));
            assert!(content.contains("console.log(value);"));
            assert!(content.contains("</script>"));
            assert!(content.contains("<style>"));
            assert!(content.contains("body { color: red; }"));
            assert!(content.contains("</style>"));
            assert!(!content.contains("&lt;script")); // ensure not escaped
        } else {
            panic!("Expected HTML block");
        }
    }

    #[test]
    fn test_fragment_slot_escapes_braces_in_code_block() {
        let input = r#"<UIFrameworkTabs>
<Fragment slot="react">
```ts title="src/lib/auth-client.ts"
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();
```
</Fragment>
</UIFrameworkTabs>"#;

        let options = Options {
            enable_directives: true,
            allow_raw_html: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        let jsx =
            crate::codegen::blocks_to_jsx_string(&result.blocks, None::<fn(&str) -> Option<_>>);
        assert!(jsx.contains("createAuthClient"));
        // With set:html, braces are preserved as-is in the JSON string (escaped by JSON.stringify)
        // The important thing is they're inside a JSON string, not interpreted as JSX expressions
        assert!(jsx.contains("set:html="));
    }

    #[test]
    fn test_inline_code_with_jsx_like_text_is_escaped() {
        let input = "`<PreactBanner client:load />` and `<SvelteCounter client:visible />`";
        let options = Options {
            enable_directives: true,
            allow_raw_html: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        let jsx =
            crate::codegen::blocks_to_jsx_string(&result.blocks, None::<fn(&str) -> Option<_>>);

        assert!(jsx.contains("&lt;PreactBanner client:load /&gt;"));
        assert!(jsx.contains("&lt;SvelteCounter client:visible /&gt;"));
        assert!(!jsx.contains("<PreactBanner"));
        assert!(!jsx.contains("SvelteCounter client:visible />"));
    }

    #[test]
    fn test_spoiler_with_inline_code_does_not_emit_jsx_components() {
        let input = "<Spoiler>`<PreactBanner client:load />` und `<SvelteCounter client:visible />`</Spoiler>";
        let options = Options {
            enable_directives: true,
            allow_raw_html: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        let jsx =
            crate::codegen::blocks_to_jsx_string(&result.blocks, None::<fn(&str) -> Option<_>>);

        assert!(jsx.contains("&lt;PreactBanner client:load /&gt;"));
        assert!(jsx.contains("&lt;SvelteCounter client:visible /&gt;"));
        assert!(!jsx.contains("<PreactBanner"));
        assert!(!jsx.contains("<SvelteCounter"));
    }

    #[test]
    fn test_spoiler_wrapped_in_raw_p_still_escapes_children() {
        let input = "<p><Spoiler>`<PreactBanner client:load />`</Spoiler></p>";
        let options = Options {
            enable_directives: true,
            allow_raw_html: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();
        let jsx =
            crate::codegen::blocks_to_jsx_string(&result.blocks, None::<fn(&str) -> Option<_>>);
        // With set:html, HTML is inside a JSON string - the important thing is
        // that the raw component tag is not interpreted as JSX
        assert!(jsx.contains("set:html="));
        assert!(jsx.contains("PreactBanner"));
    }

    #[test]
    fn test_card_indented_content_not_code_block() {
        // Regression test: Indented content inside JSX components should be
        // parsed as markdown paragraphs, not code blocks.
        // See: https://github.com/anthropics/markflow/issues/XXX
        let input = r#"<Card title="Test" icon="laptop">
    Explore [Astro starter themes](https://astro.build/themes/) for blogs.
</Card>"#;
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();

        // Find the Card component block
        let card = result
            .blocks
            .iter()
            .find(|b| matches!(b, RenderBlock::Component { name, .. } if name == "Card"));

        assert!(card.is_some(), "Expected Card component block");

        if let RenderBlock::Component { slot_children, .. } = card.unwrap() {
            // Should contain paragraph with link, NOT code block
            let has_code_block = slot_children
                .iter()
                .any(|b| matches!(b, RenderBlock::Code { .. }));
            assert!(
                !has_code_block,
                "slot_children should NOT contain Code block: {:?}",
                slot_children
            );

            let has_link = slot_children.iter().any(|b| match b {
                RenderBlock::Html { content } => content.contains("<a href="),
                _ => false,
            });
            assert!(
                has_link,
                "slot_children SHOULD contain rendered link: {:?}",
                slot_children
            );
        }
    }

    #[test]
    fn test_card_mdast_structure_via_to_blocks() {
        // Test that to_blocks correctly processes Card component
        // This verifies the full preprocessing + parsing pipeline
        let input = r#"<Card title="Test">
    Indented content with [link](url).
</Card>"#;

        let options = Options {
            enable_directives: true,
            allow_raw_html: false, // Use MDX JSX mode
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();

        // Verify we get a Component block (not HTML)
        assert_eq!(result.blocks.len(), 1);

        match &result.blocks[0] {
            RenderBlock::Component {
                name,
                slot_children,
                ..
            } => {
                assert_eq!(name, "Card", "Should be a Card component");
                // Should contain paragraph with a link, not code blocks
                let has_paragraph = slot_children.iter().any(|b| match b {
                    RenderBlock::Html { content } => content.contains("<p>"),
                    _ => false,
                });
                assert!(has_paragraph, "Should have paragraph: {:?}", slot_children);

                let has_link = slot_children.iter().any(|b| match b {
                    RenderBlock::Html { content } => content.contains("<a href="),
                    _ => false,
                });
                assert!(has_link, "Should have link: {:?}", slot_children);

                let has_code_block = slot_children
                    .iter()
                    .any(|b| matches!(b, RenderBlock::Code { .. }));
                assert!(
                    !has_code_block,
                    "Should NOT have Code block: {:?}",
                    slot_children
                );
            }
            other => panic!("Expected Component block, got: {:?}", other),
        }
    }

    #[test]
    fn test_islands_mdx_fragment_slots_pattern() {
        // Regression test for: "Unexpected closing slash `/` in tag"
        // This pattern from islands.mdx was causing parse errors when
        // normalize_list_jsx_components incorrectly handled inline Fragment tags.
        let input = r#"<IslandsDiagram>
  <Fragment slot="headerApp">Header (interactive island)</Fragment>
  <Fragment slot="sidebarApp">Sidebar (static HTML)</Fragment>
  <Fragment slot="main">
    Static content like text, images, etc.
  </Fragment>
  <Fragment slot="carouselApp">Image carousel (interactive island)</Fragment>
  <Fragment slot="footer">Footer (static HTML)</Fragment>
</IslandsDiagram>"#;

        let options = Options {
            enable_directives: true,
            allow_raw_html: false,
            ..Default::default()
        };

        // This should NOT fail with "Unexpected closing slash `/` in tag"
        let result = to_blocks(input, &options);
        assert!(
            result.is_ok(),
            "Should parse without error. Got: {:?}",
            result.err()
        );

        // Verify we get the component
        let blocks = result.unwrap();
        let islands_diagram = blocks
            .blocks
            .iter()
            .find(|b| matches!(b, RenderBlock::Component { name, .. } if name == "IslandsDiagram"));
        assert!(
            islands_diagram.is_some(),
            "Should have IslandsDiagram component"
        );
    }

    #[test]
    fn test_code_block_inside_list_renders_inline() {
        let input = "- item\n\n  ```js\n  let x = 1;\n  ```\n\n- next";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        // Should be a single Html block containing the full list
        assert_eq!(
            blocks.blocks.len(),
            1,
            "Expected 1 block, got: {:?}",
            blocks.blocks
        );
        match &blocks.blocks[0] {
            RenderBlock::Html { content } => {
                assert!(content.contains("<ul>"), "Should contain <ul>");
                assert!(content.contains("</ul>"), "Should contain </ul>");
                assert!(
                    content.contains(r#"<pre class="astro-code" tabindex="0">"#),
                    "Should contain inline pre"
                );
                assert!(
                    content.contains(r#"<code class="language-js">"#),
                    "Should contain code with lang"
                );
                assert!(content.contains("let x = 1;"), "Should contain code text");
            }
            _ => panic!("Expected HTML block, got: {:?}", blocks.blocks[0]),
        }
    }

    #[test]
    fn test_code_block_no_lang_inside_list() {
        let input = "- item\n\n  ```\n  plain code\n  ```\n";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(
            blocks.blocks.len(),
            1,
            "Expected 1 block, got: {:?}",
            blocks.blocks
        );
        match &blocks.blocks[0] {
            RenderBlock::Html { content } => {
                assert!(content.contains("<ul>"), "Should contain <ul>");
                assert!(
                    content.contains(r#"<pre class="astro-code" tabindex="0"><code>"#),
                    "Should have code without lang class"
                );
                assert!(content.contains("plain code"), "Should contain code text");
            }
            _ => panic!("Expected HTML block"),
        }
    }

    #[test]
    fn test_top_level_code_block_emits_render_block_code() {
        let input = "```js\nlet z = 3;\n```";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        assert_eq!(blocks.blocks.len(), 1);
        match &blocks.blocks[0] {
            RenderBlock::Code { code, lang, .. } => {
                assert_eq!(code, "let z = 3;");
                assert_eq!(lang.as_deref(), Some("js"));
            }
            _ => panic!(
                "Expected Code block for top-level code, got: {:?}",
                blocks.blocks[0]
            ),
        }
    }

    #[test]
    fn test_inline_jsx_in_paragraph_renders_inline() {
        // Regression test: Inline JSX elements inside paragraphs should NOT
        // create separate blocks. They should be rendered inline to keep
        // the paragraph HTML structure intact.
        // See: https://github.com/anthropics/markflow/issues/XXX
        let input = "Click on the <kbd>+ New blok</kbd> button and create the following Bloks:";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();

        // Should be a SINGLE HTML block containing the entire paragraph
        assert_eq!(
            result.blocks.len(),
            1,
            "Expected 1 block (inline JSX in paragraph), got {}: {:?}",
            result.blocks.len(),
            result.blocks
        );

        match &result.blocks[0] {
            RenderBlock::Html { content } => {
                // Should contain the complete paragraph with inline <kbd>
                assert!(
                    content.contains("<p>Click on the <kbd"),
                    "Should start with <p>Click on the <kbd, got: {}",
                    content
                );
                assert!(
                    content.contains("</kbd> button and create the following Bloks:</p>"),
                    "Should end with </kbd> button...</p>, got: {}",
                    content
                );
                // Verify the kbd tag is properly rendered inline
                assert!(
                    content.contains("<kbd>+ New blok</kbd>"),
                    "Should contain <kbd>+ New blok</kbd>, got: {}",
                    content
                );
            }
            other => panic!("Expected HTML block, got: {:?}", other),
        }
    }

    #[test]
    fn test_inline_jsx_in_paragraph_followed_by_list() {
        // Test case from storyblok.mdx: inline <kbd> followed by list
        let input = r#"Click on the <kbd>+ New blok</kbd> button and create the following Bloks:

1. First item
2. Second item"#;
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();

        // Should be a SINGLE HTML block containing both paragraph and list
        assert_eq!(
            result.blocks.len(),
            1,
            "Expected 1 block (paragraph + list), got {}: {:?}",
            result.blocks.len(),
            result.blocks
        );

        match &result.blocks[0] {
            RenderBlock::Html { content } => {
                // Should contain the paragraph with inline kbd
                assert!(
                    content.contains("<kbd>+ New blok</kbd>"),
                    "Should contain inline kbd, got: {}",
                    content
                );
                // Should contain the list
                assert!(
                    content.contains("<ol>"),
                    "Should contain <ol>, got: {}",
                    content
                );
                assert!(
                    content.contains("<li>First item</li>"),
                    "Should contain first item, got: {}",
                    content
                );
                // The text after </kbd> should be properly part of the paragraph
                assert!(
                    content.contains("</kbd> button and create the following Bloks:</p>"),
                    "Text after </kbd> should be in paragraph, got: {}",
                    content
                );
            }
            other => panic!("Expected HTML block, got: {:?}", other),
        }
    }

    #[test]
    fn test_multiple_inline_jsx_in_paragraph() {
        let input = "Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy.";
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();

        // Should be a single HTML block
        assert_eq!(
            result.blocks.len(),
            1,
            "Expected 1 block, got {}: {:?}",
            result.blocks.len(),
            result.blocks
        );

        match &result.blocks[0] {
            RenderBlock::Html { content } => {
                assert!(
                    content.contains("<kbd>Ctrl</kbd>"),
                    "Should contain first kbd, got: {}",
                    content
                );
                assert!(
                    content.contains("<kbd>C</kbd>"),
                    "Should contain second kbd, got: {}",
                    content
                );
                assert!(
                    content.contains("+"),
                    "Should contain + between kbd elements, got: {}",
                    content
                );
            }
            other => panic!("Expected HTML block, got: {:?}", other),
        }
    }

    #[test]
    fn test_custom_id_reserves_slug_for_dedup() {
        let input = "## Intro {#intro}\n\n## Intro\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };
        let blocks = to_blocks(input, &options).unwrap();

        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        assert!(
            all_html.contains(r#"id="intro""#),
            "First heading should have id=\"intro\", got: {}",
            all_html
        );
        assert!(
            all_html.contains(r#"id="intro-1""#),
            "Second heading should have id=\"intro-1\", got: {}",
            all_html
        );
    }

    #[test]
    fn test_inline_code_custom_id_not_detected() {
        // `{#bar}` inside InlineCode should NOT be treated as a custom heading ID
        let input = "## foo `{#bar}`\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };
        let blocks = to_blocks(input, &options).unwrap();

        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // Should NOT use "bar" as the heading ID
        assert!(
            !all_html.contains(r#"id="bar""#),
            "Should not detect custom ID inside InlineCode, got: {}",
            all_html
        );
        // Should auto-generate a slug from the text content
        assert!(
            all_html.contains(r#"id="foo-bar""#),
            "Should auto-generate slug, got: {}",
            all_html
        );
    }

    #[test]
    fn test_inline_code_then_custom_id_still_works() {
        // `foo` followed by {#bar} as plain text — custom ID should still be detected
        let input = "## `foo` {#bar}\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };
        let blocks = to_blocks(input, &options).unwrap();

        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        assert!(
            all_html.contains(r#"id="bar""#),
            "Custom ID after InlineCode should still work, got: {}",
            all_html
        );
        assert!(
            !all_html.contains("{#bar}"),
            "Custom ID syntax should be stripped from output, got: {}",
            all_html
        );
    }

    #[test]
    fn test_footnote_reference_and_definition() {
        // Use multiple footnotes to verify they aggregate into a single <section>
        let input = "Here is a footnote[^1] and another[^2].\n\n[^1]: First footnote content.\n\n[^2]: Second footnote content.\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();

        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // Footnote references should produce superscript links
        assert!(
            all_html.contains("<sup>"),
            "Should contain <sup> for footnote ref, got: {}",
            all_html
        );
        assert!(
            all_html.contains("href=\"#user-content-fn-1\""),
            "Should link to first footnote definition, got: {}",
            all_html
        );
        assert!(
            all_html.contains("href=\"#user-content-fn-2\""),
            "Should link to second footnote definition, got: {}",
            all_html
        );

        // Should have exactly ONE footnotes section (not one per definition)
        let section_count = all_html.matches("class=\"footnotes\"").count();
        assert_eq!(
            section_count, 1,
            "Should have exactly one footnotes section, got {}: {}",
            section_count, all_html
        );

        // Should have exactly ONE <ol> inside the section
        let footnote_section_start = all_html.find("class=\"footnotes\"").unwrap();
        let footnote_section = &all_html[footnote_section_start..];
        assert!(
            footnote_section.contains("<ol>"),
            "Section should contain <ol>, got: {}",
            footnote_section
        );
        let ol_count = footnote_section.matches("<ol>").count();
        assert_eq!(
            ol_count, 1,
            "Should have exactly one <ol>, got {}: {}",
            ol_count, footnote_section
        );

        // Should have exactly ONE id="footnote-label"
        let label_count = all_html.matches("id=\"footnote-label\"").count();
        assert_eq!(
            label_count, 1,
            "Should have exactly one footnote-label, got {}: {}",
            label_count, all_html
        );

        // Both <li> items should be present
        assert!(
            all_html.contains("id=\"user-content-fn-1\""),
            "Should have first fn ID, got: {}",
            all_html
        );
        assert!(
            all_html.contains("id=\"user-content-fn-2\""),
            "Should have second fn ID, got: {}",
            all_html
        );
        assert!(
            all_html.contains("First footnote content."),
            "Should contain first footnote content, got: {}",
            all_html
        );
        assert!(
            all_html.contains("Second footnote content."),
            "Should contain second footnote content, got: {}",
            all_html
        );

        // Both backref links should be present
        assert!(
            all_html.contains("href=\"#user-content-fnref-1\""),
            "Should have first backref link, got: {}",
            all_html
        );
        assert!(
            all_html.contains("href=\"#user-content-fnref-2\""),
            "Should have second backref link, got: {}",
            all_html
        );
    }

    #[test]
    fn test_footnote_identifier_escaping() {
        // Footnote identifiers with special characters are sanitized for safe
        // fragment IDs: quotes and other non-alphanumeric chars are stripped.
        let input = "Text[^a\"b].\n\n[^a\"b]: Footnote with special id.\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // The raw `"` must not appear in fragment IDs (neither raw nor HTML-escaped)
        assert!(
            !all_html.contains("fn-a\"b"),
            "Unescaped double-quote in footnote attribute, got: {}",
            all_html
        );
        // The sanitized id should strip the quote: a"b → ab
        assert!(
            all_html.contains("fn-ab"),
            "Expected sanitized footnote id fn-ab, got: {}",
            all_html
        );
    }

    #[test]
    fn test_footnote_identifier_sanitization_special_chars() {
        // Footnote identifiers with periods/hyphens/underscores produce
        // sanitized fragment IDs, keeping only safe characters.
        let input = "Text[^v2.1-beta_rc].\n\n[^v2.1-beta_rc]: Version note.\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // Period should be stripped, hyphens and underscores preserved
        // v2.1-beta_rc → v21-beta_rc
        assert!(
            all_html.contains("fn-v21-beta_rc"),
            "Expected sanitized footnote id fn-v21-beta_rc, got: {}",
            all_html
        );
        assert!(
            all_html.contains("fnref-v21-beta_rc"),
            "Expected sanitized fnref id fnref-v21-beta_rc, got: {}",
            all_html
        );
    }

    #[test]
    fn test_sanitize_footnote_id_unit() {
        use super::context::sanitize_footnote_id;

        assert_eq!(sanitize_footnote_id("simple"), "simple");
        assert_eq!(sanitize_footnote_id("my-note"), "my-note");
        assert_eq!(sanitize_footnote_id("my_note"), "my_note");
        assert_eq!(sanitize_footnote_id("UPPER"), "upper");
        assert_eq!(sanitize_footnote_id("a\"b"), "ab");
        assert_eq!(sanitize_footnote_id("v2.1"), "v21");
        assert_eq!(sanitize_footnote_id("a b"), "a-b");
        assert_eq!(sanitize_footnote_id("a\tb"), "a-b");
        assert_eq!(sanitize_footnote_id(""), "fn");
        assert_eq!(sanitize_footnote_id("!@#"), "fn");
        // Non-ASCII: Unicode letters/digits are preserved
        assert_eq!(sanitize_footnote_id("注"), "注");
        assert_eq!(sanitize_footnote_id("пример"), "пример");
        assert_eq!(sanitize_footnote_id("café"), "café");
        // Distinct non-ASCII identifiers produce distinct IDs
        assert_ne!(sanitize_footnote_id("注"), sanitize_footnote_id("例"));
    }

    #[test]
    fn test_footnote_id_collision_disambiguation() {
        // Distinct identifiers that sanitize to the same form must get
        // distinct safe IDs to avoid duplicate HTML id attributes.
        let options = Options::default();
        let mut ctx = Context::new(&options);

        let id1 = ctx.get_safe_footnote_id("a b");
        let id2 = ctx.get_safe_footnote_id("a-b");
        assert_ne!(id1, id2, "Colliding sanitized IDs must be disambiguated");
        // First one should get the base form
        assert_eq!(id1, "a-b");
        // Second one should get a suffixed form
        assert_eq!(id2, "a-b-2");

        // Same identifier should return the same safe ID on repeat calls
        let id1_again = ctx.get_safe_footnote_id("a b");
        assert_eq!(id1, id1_again, "Same identifier should reuse its safe ID");
    }

    #[test]
    fn test_task_list_with_nested_list() {
        // Nested sub-lists must NOT be wrapped inside <span> within <label>.
        // They should appear after </label> but still inside <li>.
        let input = "- [x] Task item\n  - Sub item\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // The nested <ul> must come after </label>, not inside <span>
        assert!(
            all_html.contains("</label><ul>"),
            "Nested <ul> should appear after </label>, got: {}",
            all_html
        );
        // The <span> should NOT contain a nested <ul>
        assert!(
            !all_html.contains("<span>") || {
                let span_start = all_html.find("<span>").unwrap();
                let span_end = all_html[span_start..].find("</span>").unwrap() + span_start;
                let span_content = &all_html[span_start..span_end];
                !span_content.contains("<ul>")
            },
            "Nested <ul> should not be inside <span>, got: {}",
            all_html
        );
    }

    #[test]
    fn test_nested_inline_custom_id_stripped() {
        let input = "## **Bold text {#bold-id}**\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };
        let blocks = to_blocks(input, &options).unwrap();

        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        assert!(
            !all_html.contains("{#bold-id}"),
            "Custom ID should be stripped from nested inline node, got: {}",
            all_html
        );
        assert!(
            all_html.contains(r#"id="bold-id""#),
            "Heading should have id attribute bold-id, got: {}",
            all_html
        );
        assert!(
            all_html.contains("<strong>Bold text</strong>"),
            "Bold text should be rendered without custom ID, got: {}",
            all_html
        );
    }

    #[test]
    fn test_repeated_footnote_references() {
        let input = "First[^1] and second[^1] and third[^1].\n\n[^1]: Footnote content.\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // First reference: no suffix
        assert!(
            all_html.contains("id=\"user-content-fnref-1\""),
            "First ref should have no suffix, got: {}",
            all_html
        );
        // Second reference: -2 suffix
        assert!(
            all_html.contains("id=\"user-content-fnref-1-2\""),
            "Second ref should have -2 suffix, got: {}",
            all_html
        );
        // Third reference: -3 suffix
        assert!(
            all_html.contains("id=\"user-content-fnref-1-3\""),
            "Third ref should have -3 suffix, got: {}",
            all_html
        );

        // Three backref links in the definition
        assert!(
            all_html.contains("href=\"#user-content-fnref-1\""),
            "Should have backref to first ref, got: {}",
            all_html
        );
        assert!(
            all_html.contains("href=\"#user-content-fnref-1-2\""),
            "Should have backref to second ref, got: {}",
            all_html
        );
        assert!(
            all_html.contains("href=\"#user-content-fnref-1-3\""),
            "Should have backref to third ref, got: {}",
            all_html
        );

        // Non-first backrefs should have <sup> numbers
        assert!(
            all_html.contains("<sup>2</sup>"),
            "Second backref should have <sup>2</sup>, got: {}",
            all_html
        );
        assert!(
            all_html.contains("<sup>3</sup>"),
            "Third backref should have <sup>3</sup>, got: {}",
            all_html
        );
    }

    #[test]
    fn test_footnote_ordinal_numbers() {
        // Footnote references should display ordinal numbers (1, 2, 3) based on
        // first-reference order, not the literal identifier text.
        let input = "First[^alpha] and second[^beta] and third[^1].\n\n[^alpha]: Alpha footnote.\n[^beta]: Beta footnote.\n[^1]: One footnote.\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // Superscripts should contain ordinal numbers, not identifiers
        assert!(
            all_html.contains(">1</a></sup>"),
            "First footnote ref should show ordinal 1, got: {}",
            all_html
        );
        assert!(
            all_html.contains(">2</a></sup>"),
            "Second footnote ref should show ordinal 2, got: {}",
            all_html
        );
        assert!(
            all_html.contains(">3</a></sup>"),
            "Third footnote ref should show ordinal 3, got: {}",
            all_html
        );
        // Should NOT contain the literal identifier text as superscript
        assert!(
            !all_html.contains(">alpha</a></sup>"),
            "Should not show 'alpha' as superscript, got: {}",
            all_html
        );
        assert!(
            !all_html.contains(">beta</a></sup>"),
            "Should not show 'beta' as superscript, got: {}",
            all_html
        );

        // Definitions in the <ol> should be ordered by first-reference order
        let section_start = all_html.find("class=\"footnotes\"").unwrap();
        let section = &all_html[section_start..];
        let alpha_pos = section.find("fn-alpha").unwrap();
        let beta_pos = section.find("fn-beta").unwrap();
        let one_pos = section.find("fn-1").unwrap();
        assert!(
            alpha_pos < beta_pos && beta_pos < one_pos,
            "Definitions should be ordered alpha, beta, 1 (by first-reference order), got section: {}",
            section
        );
    }

    #[test]
    fn test_heading_autolink_skips_when_heading_contains_link() {
        let input = "## Check the [docs](https://example.com) page\n";
        let options = Options {
            enable_heading_autolinks: true,
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // Should have the link
        assert!(
            all_html.contains("<a href=\"https://example.com\">docs</a>"),
            "Should render the inline link, got: {}",
            all_html
        );

        // Should NOT have a wrapping autolink <a> (which would nest anchors)
        // Count <a> elements — there should be exactly one (the inline link)
        let anchor_count = all_html.matches("<a ").count();
        assert_eq!(
            anchor_count, 1,
            "Should have exactly one <a> (the inline link, no autolink wrapper), got: {}",
            all_html
        );
    }

    #[test]
    fn test_heading_autolink_wraps_when_no_link() {
        let input = "## Plain heading\n";
        let options = Options {
            enable_heading_autolinks: true,
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // Should have autolink wrapper
        assert!(
            all_html.contains("<a href=\"#plain-heading\">"),
            "Should have autolink wrapper, got: {}",
            all_html
        );
    }

    #[test]
    fn test_heading_autolink_skips_when_heading_contains_footnote_ref() {
        let input = "## Title[^1]\n\n[^1]: A footnote.\n";
        let options = Options {
            enable_heading_autolinks: true,
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // The heading should contain the footnote ref anchor
        assert!(
            all_html.contains("<sup><a href=\"#user-content-fn-1\""),
            "Should render the footnote reference link, got: {}",
            all_html
        );

        // Should NOT have a wrapping autolink <a> (which would nest anchors)
        // The only <a> tags should be the footnote ref and backref, not an autolink wrapper
        assert!(
            !all_html.contains("<a href=\"#title1\">"),
            "Should not have autolink wrapper around heading with footnote ref, got: {}",
            all_html
        );
    }

    #[test]
    fn test_footnote_inside_jsx_component_children() {
        // Regression test: footnote references and definitions inside JSX component
        // children (e.g. <Aside>) must bubble up to the parent context so the
        // footnote section appears in the final output.
        let input = r#":::note[Important]
Here is a footnote inside a directive[^1].

[^1]: Footnote defined inside the directive.
:::"#;
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();

        // Convert blocks to JSX to verify the footnote section is emitted
        let jsx =
            crate::codegen::blocks_to_jsx_string(&result.blocks, None::<fn(&str) -> Option<_>>);

        // The footnote section should appear in the final JSX output
        // (inside set:html JSON strings, quotes are escaped as \")
        assert!(
            jsx.contains("footnotes"),
            "Footnote section should appear in JSX output, got: {}",
            jsx
        );

        // The footnote reference link should be present somewhere
        assert!(
            jsx.contains("user-content-fn-1"),
            "Footnote reference link should be present, got: {}",
            jsx
        );

        // The backref should be present
        assert!(
            jsx.contains("user-content-fnref-1"),
            "Footnote backref should be present in JSX, got: {}",
            jsx
        );

        // The footnote content should be present
        assert!(
            jsx.contains("Footnote defined inside the directive."),
            "Footnote content should be present, got: {}",
            jsx
        );
    }

    #[test]
    fn test_footnote_ref_count_across_child_context() {
        // Regression test: when the same footnote is referenced in the parent
        // flow AND inside a child context (e.g., directive/JSX component), the
        // ref IDs must not collide. The child must continue the parent's ref
        // counter so the second reference gets a -2 suffix.
        let input = r#"Outer ref[^1].

:::note[Important]
Inner ref[^1].
:::

[^1]: Shared footnote."#;
        let options = Options {
            enable_directives: true,
            ..Default::default()
        };

        let result = to_blocks(input, &options).unwrap();

        // Convert to JSX so we can inspect both component slots and HTML blocks
        let jsx =
            crate::codegen::blocks_to_jsx_string(&result.blocks, None::<fn(&str) -> Option<_>>);

        // First reference (outer): id="user-content-fnref-1" (no suffix)
        assert!(
            jsx.contains("fnref-1\\\"") || jsx.contains("fnref-1\""),
            "First ref should have no suffix, got: {}",
            jsx
        );
        // Second reference (inner child): id="user-content-fnref-1-2"
        assert!(
            jsx.contains("fnref-1-2"),
            "Second ref (inside directive) should have -2 suffix, got: {}",
            jsx
        );
    }

    #[test]
    fn test_single_footnote_reference_unchanged() {
        let input = "Text with footnote[^1].\n\n[^1]: Single reference content.\n";
        let options = Options {
            enable_directives: false,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        // No suffix on single reference
        assert!(
            all_html.contains("id=\"user-content-fnref-1\""),
            "Single ref should have no suffix, got: {}",
            all_html
        );
        // No -2 suffix should exist
        assert!(
            !all_html.contains("fnref-1-2"),
            "Should not have -2 suffix for single ref, got: {}",
            all_html
        );
        // No <sup> in backref for single reference
        let footnote_section_start = all_html.find("class=\"footnotes\"").unwrap();
        let footnote_section = &all_html[footnote_section_start..];
        assert!(
            !footnote_section.contains("<sup>"),
            "Single-ref backref should not have <sup>, got: {}",
            footnote_section
        );
    }

    #[test]
    fn test_inline_math() {
        let input = "Euler's formula: $E = mc^2$";
        let options = Options {
            enable_math: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        // Inline math produces a Component block (not HTML) so Astro
        // instantiates MathInline as a real component instead of inert HTML.
        let has_math_inline = blocks
            .blocks
            .iter()
            .any(|b| matches!(b, RenderBlock::Component { name, .. } if name == "MathInline"));
        assert!(
            has_math_inline,
            "Should have MathInline component block: {:?}",
            blocks.blocks
        );
    }

    #[test]
    fn test_block_math() {
        let input = "$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$";
        let options = Options {
            enable_math: true,
            ..Default::default()
        };

        let blocks = to_blocks(input, &options).unwrap();
        // Should have a MathBlock component
        let has_math_block = blocks
            .blocks
            .iter()
            .any(|b| matches!(b, RenderBlock::Component { name, .. } if name == "MathBlock"));
        assert!(
            has_math_block,
            "Should have MathBlock component: {:?}",
            blocks.blocks
        );
    }

    #[test]
    fn test_math_disabled_by_default() {
        let input = "Price is $5 and $10";
        let options = Options::default();

        let blocks = to_blocks(input, &options).unwrap();
        // With math disabled, $ signs should be treated as literal text
        let all_html: String = blocks
            .blocks
            .iter()
            .filter_map(|b| match b {
                RenderBlock::Html { content } => Some(content.as_str()),
                _ => None,
            })
            .collect();
        assert!(
            !all_html.contains("MathInline"),
            "Should not contain MathInline when math is disabled: {}",
            all_html
        );
    }
}
