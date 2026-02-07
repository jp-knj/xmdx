//! MDX compilation using mdxjs-rs.
//!
//! This module provides MDX compilation capabilities using the mdxjs-rs crate,
//! which compiles MDX (Markdown with JSX) to JavaScript using markdown-rs and SWC.

use crate::{FrontmatterExtraction, extract_frontmatter, slug::Slugger};
use mdxjs::{JsxRuntime, Options, compile};

/// Output from MDX compilation.
#[derive(Debug, Clone)]
pub struct MdxOutput {
    /// The compiled JavaScript code.
    pub code: String,
    /// Frontmatter as JSON string.
    pub frontmatter_json: String,
    /// Extracted headings with depth, slug, and text.
    pub headings: Vec<MdxHeading>,
}

/// A heading extracted from the MDX document.
#[derive(Debug, Clone)]
pub struct MdxHeading {
    /// The heading level (1-6).
    pub depth: u8,
    /// The URL-safe slug for the heading.
    pub slug: String,
    /// The text content of the heading.
    pub text: String,
}

/// Error type for MDX compilation.
#[derive(Debug, thiserror::Error)]
pub enum MdxCompileError {
    /// Error from mdxjs-rs compilation.
    #[error("MDX compilation error: {0}")]
    CompileError(String),
    /// Error extracting frontmatter.
    #[error("Frontmatter error: {0}")]
    FrontmatterError(String),
    /// Error serializing frontmatter to JSON.
    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),
}

/// Configuration options for MDX compilation.
#[derive(Debug, Clone, Default)]
pub struct MdxCompileOptions {
    /// The JSX import source (e.g., "astro" for Astro projects).
    pub jsx_import_source: Option<String>,
    /// Whether to output JSX instead of function calls.
    pub jsx: bool,
}

/// Compiles MDX source to JavaScript.
///
/// This function uses mdxjs-rs to compile MDX to JavaScript with the automatic
/// JSX runtime. Frontmatter is extracted separately since mdxjs-rs doesn't
/// process frontmatter blocks.
///
/// # Arguments
///
/// * `source` - The MDX source code.
/// * `filepath` - The file path (used for error messages and source maps).
/// * `options` - Optional compilation configuration.
///
/// # Returns
///
/// Returns an `MdxOutput` containing the compiled JavaScript, frontmatter as JSON,
/// and extracted headings.
///
/// # Example
///
/// ```ignore
/// use xmdx_core::mdx_compiler::{compile_mdx, MdxCompileOptions};
///
/// let source = r#"---
/// title: Hello World
/// ---
///
/// # Welcome
///
/// This is **MDX** content.
/// "#;
///
/// let options = MdxCompileOptions {
///     jsx_import_source: Some("astro".to_string()),
///     ..Default::default()
/// };
///
/// let output = compile_mdx(source, "example.mdx", Some(options))?;
/// println!("Compiled JS: {}", output.code);
/// ```
pub fn compile_mdx(
    source: &str,
    filepath: &str,
    options: Option<MdxCompileOptions>,
) -> Result<MdxOutput, MdxCompileError> {
    let opts = options.unwrap_or_default();

    // Extract frontmatter first (mdxjs-rs doesn't handle frontmatter)
    let FrontmatterExtraction { value, body_start } = extract_frontmatter(source)
        .map_err(|e| MdxCompileError::FrontmatterError(e.to_string()))?;
    let frontmatter_json = serde_json::to_string(&value)?;
    let content = source[body_start..].to_string();

    // Extract headings from the source before compilation
    let headings = extract_headings_from_source(&content);

    // Configure mdxjs-rs options
    let mdx_options = Options {
        filepath: Some(filepath.to_string()),
        jsx_runtime: Some(JsxRuntime::Automatic),
        jsx_import_source: opts.jsx_import_source,
        jsx: opts.jsx,
        ..Default::default()
    };

    // Compile MDX to JavaScript
    let js_code = compile(&content, &mdx_options)
        .map_err(|e| MdxCompileError::CompileError(e.to_string()))?;

    Ok(MdxOutput {
        code: js_code,
        frontmatter_json,
        headings,
    })
}

/// Checks if a line is an indented code block (4+ spaces or tab at start).
/// Per CommonMark spec, such lines are code blocks, not headings.
fn is_indented_code_block(line: &str) -> bool {
    let mut chars = line.chars();
    let mut space_count = 0;

    for c in chars.by_ref() {
        match c {
            ' ' => {
                space_count += 1;
                if space_count >= 4 {
                    return true;
                }
            }
            '\t' => return true,
            _ => break,
        }
    }

    false
}

/// Extracts headings from MDX/Markdown source.
///
/// This function parses the source looking for ATX-style headings (`# Heading`)
/// and extracts their depth, text, and generates slugs.
fn extract_headings_from_source(source: &str) -> Vec<MdxHeading> {
    let mut headings = Vec::new();
    let mut fence_state: Option<(char, usize)> = None; // (marker_char, marker_len)
    let mut slugger = Slugger::new();

    for line in source.lines() {
        // Skip indented code blocks (4+ spaces or tab) before trimming
        // Per CommonMark, these are code blocks and should not be parsed as headings
        if is_indented_code_block(line) {
            continue;
        }

        let trimmed = line.trim();

        // Track fenced code blocks with proper fence length matching
        if let Some((marker, len)) = parse_fence_marker(trimmed) {
            if let Some((open_marker, open_len)) = fence_state {
                // Inside a code block - check if this closes it
                if marker == open_marker && len >= open_len {
                    fence_state = None;
                }
            } else {
                // Not in a code block - this opens one
                fence_state = Some((marker, len));
            }
            continue;
        }

        if fence_state.is_some() {
            continue;
        }

        // Match ATX headings (# to ######)
        if let Some(heading_match) = parse_atx_heading(trimmed) {
            let slug = slugger.next_slug(&heading_match.text);
            headings.push(MdxHeading {
                depth: heading_match.depth,
                slug,
                text: heading_match.text,
            });
        }
    }

    headings
}

/// Parses a fence marker, returning (char, length) if valid.
/// A valid fence marker is 3+ consecutive backticks or tildes at the start of a line.
fn parse_fence_marker(line: &str) -> Option<(char, usize)> {
    let first = line.chars().next()?;
    if first != '`' && first != '~' {
        return None;
    }

    let count = line.chars().take_while(|&c| c == first).count();
    if count >= 3 {
        Some((first, count))
    } else {
        None
    }
}

struct AtxHeading {
    depth: u8,
    text: String,
}

/// Strips inline markdown formatting from text, leaving only plain text.
///
/// Handles:
/// - Bold: `**text**` or `__text__` → `text`
/// - Italic: `*text*` or `_text_` → `text`
/// - Bold+Italic: `***text***` → `text`
/// - Inline code: `` `text` `` → `text`
/// - Links: `[text](url)` → `text`
/// - Images: `![alt](url)` → `alt`
fn strip_inline_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                // Escaped character - include the next char literally
                if let Some(next) = chars.next() {
                    result.push(next);
                }
            }
            '`' => {
                // Inline code - extract content until closing `
                while let Some(&next) = chars.peek() {
                    if next == '`' {
                        chars.next();
                        break;
                    }
                    result.push(chars.next().unwrap());
                }
            }
            '*' | '_' => {
                // Count consecutive markers
                let marker = c;
                let mut count = 1;
                while chars.peek() == Some(&marker) {
                    chars.next();
                    count += 1;
                }

                // Collect content until matching closing markers
                let mut content = String::new();

                while let Some(&next) = chars.peek() {
                    if next == marker {
                        let mut closing_count = 1;
                        chars.next();
                        while chars.peek() == Some(&marker) && closing_count < count {
                            chars.next();
                            closing_count += 1;
                        }
                        if closing_count >= count {
                            break;
                        } else {
                            // Not enough closing markers, include them as content
                            for _ in 0..closing_count {
                                content.push(marker);
                            }
                        }
                    } else {
                        content.push(chars.next().unwrap());
                    }
                }

                // Recursively strip any nested markdown
                result.push_str(&strip_inline_markdown(&content));
            }
            '!' if chars.peek() == Some(&'[') => {
                // Image: ![alt](url) - extract alt text
                chars.next(); // consume '['
                let mut alt = String::new();
                while let Some(&next) = chars.peek() {
                    if next == ']' {
                        chars.next();
                        break;
                    }
                    alt.push(chars.next().unwrap());
                }
                // Skip (url) part
                if chars.peek() == Some(&'(') {
                    chars.next();
                    let mut depth = 1;
                    for next in chars.by_ref() {
                        match next {
                            '(' => depth += 1,
                            ')' => {
                                depth -= 1;
                                if depth == 0 {
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                result.push_str(&strip_inline_markdown(&alt));
            }
            '[' => {
                // Link: [text](url) - extract text
                let mut link_text = String::new();
                while let Some(&next) = chars.peek() {
                    if next == ']' {
                        chars.next();
                        break;
                    }
                    link_text.push(chars.next().unwrap());
                }
                // Skip (url) part if present
                if chars.peek() == Some(&'(') {
                    chars.next();
                    let mut depth = 1;
                    for next in chars.by_ref() {
                        match next {
                            '(' => depth += 1,
                            ')' => {
                                depth -= 1;
                                if depth == 0 {
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                result.push_str(&strip_inline_markdown(&link_text));
            }
            _ => {
                result.push(c);
            }
        }
    }

    result
}

/// Strip trailing `#` characters from heading text per CommonMark spec.
/// Trailing #'s are only removed if preceded by at least one space.
fn strip_trailing_hashes(text: &str) -> &str {
    // Find the last non-# character
    if let Some(last_non_hash) = text.rfind(|c: char| c != '#') {
        let suffix_start = last_non_hash + 1;
        // Check if there are trailing #'s
        if suffix_start < text.len() {
            // Check if the character before the #'s is a space
            if text.as_bytes().get(last_non_hash) == Some(&b' ') {
                // Space before trailing #'s - remove them and trim
                return text[..last_non_hash].trim();
            }
        }
        // No trailing #'s, or no space before them - keep as is
        text.trim()
    } else {
        // String is all #'s or empty
        text.trim()
    }
}

fn parse_atx_heading(line: &str) -> Option<AtxHeading> {
    if !line.starts_with('#') {
        return None;
    }

    let mut depth: u8 = 0;
    let mut chars = line.chars().peekable();

    // Count leading # characters (max 6)
    while chars.peek() == Some(&'#') && depth < 6 {
        chars.next();
        depth += 1;
    }

    if depth == 0 {
        return None;
    }

    // Must be followed by a space or end of line
    match chars.peek() {
        Some(' ') | Some('\t') => {
            chars.next(); // consume the space
        }
        None => {
            // Empty heading like "##" - valid but no text
            return Some(AtxHeading {
                depth,
                text: String::new(),
            });
        }
        _ => {
            // Not a valid heading (e.g., "#hashtag")
            return None;
        }
    }

    // Collect the rest as heading text
    let text: String = chars.collect();
    let text = text.trim_end(); // Remove trailing whitespace first

    // Remove optional trailing # characters per CommonMark spec:
    // Trailing #'s are only removed if preceded by at least one space.
    // Examples:
    //   "## Heading ##" → "Heading" (space before ##, remove them)
    //   "# C#" → "C#" (no space before #, keep it)
    //   "# Heading#" → "Heading#" (no space before #, keep it)
    let text = strip_trailing_hashes(text);

    Some(AtxHeading {
        depth,
        text: strip_inline_markdown(text),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_headings() {
        let source = r#"
# Title

Some content here.

## Section One

More content.

### Subsection

```
# Not a heading
```

## Section Two
"#;
        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 4);
        assert_eq!(headings[0].depth, 1);
        assert_eq!(headings[0].text, "Title");
        assert_eq!(headings[1].depth, 2);
        assert_eq!(headings[1].text, "Section One");
        assert_eq!(headings[2].depth, 3);
        assert_eq!(headings[2].text, "Subsection");
        assert_eq!(headings[3].depth, 2);
        assert_eq!(headings[3].text, "Section Two");
    }

    #[test]
    fn test_strip_inline_markdown() {
        // Bold
        assert_eq!(strip_inline_markdown("**Bold**"), "Bold");
        assert_eq!(strip_inline_markdown("__Bold__"), "Bold");

        // Italic
        assert_eq!(strip_inline_markdown("*Italic*"), "Italic");
        assert_eq!(strip_inline_markdown("_Italic_"), "Italic");

        // Bold + Italic
        assert_eq!(strip_inline_markdown("***Bold Italic***"), "Bold Italic");

        // Inline code
        assert_eq!(strip_inline_markdown("`code`"), "code");

        // Links
        assert_eq!(
            strip_inline_markdown("[Link Text](https://example.com)"),
            "Link Text"
        );

        // Images
        assert_eq!(strip_inline_markdown("![Alt Text](image.png)"), "Alt Text");

        // Mixed
        assert_eq!(
            strip_inline_markdown("**Bold** and *italic*"),
            "Bold and italic"
        );
        assert_eq!(
            strip_inline_markdown("A **bold** [link](url)"),
            "A bold link"
        );

        // Nested
        assert_eq!(
            strip_inline_markdown("**Bold with *italic* inside**"),
            "Bold with italic inside"
        );

        // Plain text unchanged
        assert_eq!(strip_inline_markdown("Plain text"), "Plain text");

        // Escaped characters
        assert_eq!(strip_inline_markdown(r"\*not italic\*"), "*not italic*");
    }

    #[test]
    fn test_parse_atx_heading() {
        assert!(parse_atx_heading("# Hello").is_some());
        assert_eq!(parse_atx_heading("# Hello").unwrap().depth, 1);
        assert_eq!(parse_atx_heading("# Hello").unwrap().text, "Hello");

        assert_eq!(parse_atx_heading("## World").unwrap().depth, 2);
        assert_eq!(parse_atx_heading("### Nested").unwrap().depth, 3);

        // Trailing # should be stripped
        assert_eq!(parse_atx_heading("## Heading ##").unwrap().text, "Heading");

        // Inline markdown should be stripped
        assert_eq!(
            parse_atx_heading("# **Bold** Heading").unwrap().text,
            "Bold Heading"
        );
        assert_eq!(
            parse_atx_heading("## `Code` Title").unwrap().text,
            "Code Title"
        );
        assert_eq!(
            parse_atx_heading("### [Link](url) Text").unwrap().text,
            "Link Text"
        );

        // Not headings
        assert!(parse_atx_heading("#hashtag").is_none());
        assert!(parse_atx_heading("Not a heading").is_none());
    }

    #[test]
    fn test_heading_with_trailing_hash() {
        // Language names containing # should be preserved
        assert_eq!(parse_atx_heading("# C#").unwrap().text, "C#");
        assert_eq!(parse_atx_heading("## F#").unwrap().text, "F#");

        // Trailing # without preceding space should be preserved
        assert_eq!(parse_atx_heading("# Heading#").unwrap().text, "Heading#");

        // CommonMark standard: space before trailing # means they should be stripped
        assert_eq!(parse_atx_heading("## Heading ##").unwrap().text, "Heading");
        assert_eq!(parse_atx_heading("# Title #  ").unwrap().text, "Title");
        assert_eq!(parse_atx_heading("### Test ###").unwrap().text, "Test");

        // Multiple trailing # with space
        assert_eq!(parse_atx_heading("# Heading ####").unwrap().text, "Heading");

        // Mix: content has # but also trailing # with space
        assert_eq!(
            parse_atx_heading("# C# Programming #").unwrap().text,
            "C# Programming"
        );
    }

    #[test]
    fn test_compile_mdx_basic() {
        let source = r#"---
title: Test
---

# Hello World

This is **bold** text.
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(result.is_ok(), "Compilation failed: {:?}", result.err());

        let output = result.unwrap();
        assert!(output.code.contains("function")); // Should have a function
        assert!(output.code.contains("MDXContent") || output.code.contains("_createMdxContent"));
        assert_eq!(output.frontmatter_json, r#"{"title":"Test"}"#);
        assert_eq!(output.headings.len(), 1);
        assert_eq!(output.headings[0].text, "Hello World");
    }

    #[test]
    fn test_compile_mdx_with_jsx() {
        let source = r#"
# Hello

<CustomComponent prop="value">
  Content
</CustomComponent>
"#;

        let options = MdxCompileOptions {
            jsx_import_source: Some("astro".to_string()),
            ..Default::default()
        };

        let result = compile_mdx(source, "test.mdx", Some(options));
        assert!(result.is_ok(), "Compilation failed: {:?}", result.err());

        let output = result.unwrap();
        // Should reference the custom component
        assert!(output.code.contains("CustomComponent"));
    }

    #[test]
    fn test_compile_mdx_frontmatter_error() {
        // Invalid YAML frontmatter should return an error
        let source = r#"---
title: Missing closing quote
key: "unclosed
---

# Content
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(result.is_err(), "Expected frontmatter error");

        let err = result.unwrap_err();
        assert!(
            matches!(err, MdxCompileError::FrontmatterError(_)),
            "Expected FrontmatterError, got: {:?}",
            err
        );
    }

    #[test]
    fn test_heading_with_inline_markdown() {
        let source = r#"
# **Bold** Heading

## A `code` title

### [Link](https://example.com) here
"#;

        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0].text, "Bold Heading");
        assert_eq!(headings[1].text, "A code title");
        assert_eq!(headings[2].text, "Link here");
    }

    #[test]
    fn test_nested_fence_markers() {
        // Test that 4+ marker fences are handled correctly
        let source = r#"
# Before

````md
```
# Not a heading (inside outer fence)
```
````

## After
"#;

        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].text, "Before");
        assert_eq!(headings[1].text, "After");
    }

    #[test]
    fn test_fence_marker_types() {
        // Test that tilde fences work the same as backtick fences
        let source = r#"
# Title

~~~
# Not a heading
~~~

## Section

````
# Also not a heading
````

### End
"#;

        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0].text, "Title");
        assert_eq!(headings[1].text, "Section");
        assert_eq!(headings[2].text, "End");
    }

    #[test]
    fn test_mismatched_fence_markers() {
        // Tilde fence should not be closed by backtick fence
        let source = r#"
# Before

~~~
# Inside tilde fence
```
# Still inside (backticks don't close tildes)
```
~~~

## After
"#;

        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].text, "Before");
        assert_eq!(headings[1].text, "After");
    }

    #[test]
    fn test_indented_code_blocks() {
        // Lines with 4+ spaces or tab at start are indented code blocks per CommonMark
        // They should NOT be treated as headings
        let source = r#"
# Real Heading

Some text here.

    # Not a heading (4 spaces)

More text.

	# Not a heading (tab)

## Another Real Heading

- List item
    # Not a heading (inside list)

### Final Heading
"#;

        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0].text, "Real Heading");
        assert_eq!(headings[1].text, "Another Real Heading");
        assert_eq!(headings[2].text, "Final Heading");
    }

    #[test]
    fn test_is_indented_code_block() {
        // 4+ spaces = indented code block
        assert!(is_indented_code_block("    # code"));
        assert!(is_indented_code_block("     # code"));
        assert!(is_indented_code_block("        # deeply indented"));

        // Tab = indented code block
        assert!(is_indented_code_block("\t# code"));
        assert!(is_indented_code_block("\t\t# nested tabs"));

        // Less than 4 spaces = not indented code block
        assert!(!is_indented_code_block("# heading"));
        assert!(!is_indented_code_block(" # heading"));
        assert!(!is_indented_code_block("  # heading"));
        assert!(!is_indented_code_block("   # heading"));

        // Mixed (space + tab counts as code block if space + tab >= 4)
        assert!(is_indented_code_block("   \t# mixed")); // 3 spaces + tab = code block (tab at any point)
    }
}
