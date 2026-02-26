//! Directive rewriting utilities.
//!
//! This module provides text-level directive preprocessing for MDX files.
//! It converts remark-directive syntax like `:::note[Title]` into JSX tags
//! like `<Aside type="note" title="Title">` that mdxjs-rs can parse.
//!
//! This enables mdxjs-rs to process MDX files containing directive syntax
//! without requiring a remark-directive plugin.

use std::fmt::Write as _;

use crate::code_fence::{FenceState, advance_fence_state};
use crate::mdx_compiler::is_indented_code_block;

/// Parsed representation of a directive opening line (e.g. `:::note[Title] foo="bar"`).
#[derive(Clone, Debug)]
pub struct DirectiveOpening {
    /// Lowercased directive name (note/tip/info/...).
    pub name: String,
    /// Optional title captured from bracket syntax `[...]`.
    pub bracket_title: Option<String>,
    /// Raw attribute string after normalization (type/title stripped when overridden).
    pub raw_attrs: String,
}

impl DirectiveOpening {
    /// Convert to opening JSX tag, defaulting to `<Aside>`.
    pub fn to_aside_start(&self) -> String {
        self.to_component_start("Aside")
    }

    /// Convert to opening JSX tag using the given component name.
    pub fn to_component_start(&self, component_name: &str) -> String {
        let mut tag = format!("<{} data-mf-source=\"directive\"", component_name);

        // type attribute is always injected/overwritten.
        write!(tag, " type=\"{}\"", self.name).ok();

        // Attributes from source line: keep as-is after stripping conflicting keys.
        if !self.raw_attrs.is_empty() {
            tag.push(' ');
            tag.push_str(&self.raw_attrs);
        }

        // Title resolution: bracket > attribute (attributes already stripped of title when bracket present).
        if let Some(title) = self.bracket_title.as_ref() {
            let escaped = title.replace('"', "&quot;");
            write!(tag, " title=\"{}\"", escaped).ok();
        }

        tag.push('>');
        tag
    }

    /// Convert to closing JSX tag, defaulting to `</Aside>`.
    pub fn to_aside_end(&self) -> String {
        self.to_component_end("Aside")
    }

    /// Convert to closing JSX tag using the given component name.
    pub fn to_component_end(&self, component_name: &str) -> String {
        format!("</{}>", component_name)
    }
}

/// Parse an opening directive line like `:::note[Title]`.
///
/// Returns `Some(DirectiveOpening)` if the line is a valid supported directive,
/// or `None` if it's not a directive or not a supported type.
pub fn parse_opening_directive(line: &str) -> Option<DirectiveOpening> {
    parse_opening_directive_with(line, None)
}

/// Parse an opening directive line, optionally using a custom set of supported names.
///
/// When `custom_names` is `None`, the default built-in set is used.
/// When `Some(names)` is provided, only those directive names are recognized.
pub fn parse_opening_directive_with(
    line: &str,
    custom_names: Option<&[&str]>,
) -> Option<DirectiveOpening> {
    // Skip indented code blocks (4+ spaces or tab at start)
    if is_indented_code_block(line) {
        return None;
    }

    let trimmed = line.trim();
    if !trimmed.starts_with(":::") {
        return None;
    }

    // Strip leading :::
    let after_colons = &trimmed[3..];
    let mut chars = after_colons.chars().peekable();

    // Read directive name (alphabetic + hyphen for user-defined directives)
    let mut name = String::new();
    while let Some(&ch) = chars.peek() {
        if ch.is_ascii_alphabetic() || ch == '-' {
            name.push(ch.to_ascii_lowercase());
            chars.next();
        } else {
            break;
        }
    }

    // Strip leading/trailing hyphens from directive name
    let name = name.trim_matches('-').to_string();

    if name.is_empty() || !is_supported_name_with(&name, custom_names) {
        return None;
    }

    // Optional bracket title
    let mut bracket_title = None;
    if let Some(&'[') = chars.peek() {
        chars.next(); // consume [
        let mut title = String::new();
        while let Some(&ch) = chars.peek() {
            chars.next();
            if ch == ']' {
                bracket_title = Some(title);
                break;
            } else {
                title.push(ch);
            }
        }
    }

    // Remaining slice treated as attributes (trim leading whitespace)
    let remaining: String = chars.collect();
    let raw_attrs = normalize_attrs(remaining.trim(), bracket_title.is_some());

    Some(DirectiveOpening {
        name,
        bracket_title,
        raw_attrs,
    })
}

/// Tokenize attributes respecting quoted values.
/// Splits on whitespace but keeps quoted strings intact.
fn tokenize_attrs(attrs: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let chars = attrs.char_indices().peekable();
    let mut token_start: Option<usize> = None;
    let mut in_quotes = false;
    let mut quote_char = '"';

    for (i, c) in chars {
        match c {
            '"' | '\'' if !in_quotes => {
                if token_start.is_none() {
                    token_start = Some(i);
                }
                in_quotes = true;
                quote_char = c;
            }
            c if c == quote_char && in_quotes => {
                in_quotes = false;
            }
            c if c.is_whitespace() && !in_quotes => {
                if let Some(start) = token_start {
                    let token = &attrs[start..i];
                    if !token.is_empty() {
                        tokens.push(token);
                    }
                    token_start = None;
                }
            }
            _ => {
                if token_start.is_none() {
                    token_start = Some(i);
                }
            }
        }
    }

    // Capture final token
    if let Some(start) = token_start {
        let token = &attrs[start..];
        if !token.is_empty() {
            tokens.push(token);
        }
    }

    tokens
}

fn normalize_attrs(attrs: &str, has_bracket_title: bool) -> String {
    if attrs.is_empty() {
        return String::new();
    }

    // Strip surrounding braces from remark-directive syntax {key="value"}
    let attrs = attrs.trim();
    let attrs = if attrs.starts_with('{') && attrs.ends_with('}') {
        &attrs[1..attrs.len() - 1]
    } else {
        attrs
    };

    if attrs.is_empty() {
        return String::new();
    }

    let mut cleaned = String::new();

    for tok in tokenize_attrs(attrs) {
        let key = tok
            .split('=')
            .next()
            .unwrap_or("")
            .trim_matches(|c: char| c == ' ');

        // Remove any type=... attribute; we always override with directive name.
        if key.eq_ignore_ascii_case("type") {
            continue;
        }

        // Remove title when bracket title exists.
        if has_bracket_title && key.eq_ignore_ascii_case("title") {
            continue;
        }

        if !cleaned.is_empty() {
            cleaned.push(' ');
        }
        cleaned.push_str(tok);
    }

    cleaned
}

/// Check if a line is a directive closer (`:::`).
pub fn is_directive_closer(line: &str) -> bool {
    line.trim() == ":::"
}

/// Default built-in directive names recognized when no custom list is provided.
pub const DEFAULT_DIRECTIVE_NAMES: &[&str] =
    &["note", "tip", "info", "caution", "warning", "danger"];

fn is_supported_name(name: &str) -> bool {
    DEFAULT_DIRECTIVE_NAMES.contains(&name)
}

/// Check if a directive name is supported, using a custom set of names if provided.
fn is_supported_name_with(name: &str, custom_names: Option<&[&str]>) -> bool {
    match custom_names {
        Some(names) => names.contains(&name),
        None => is_supported_name(name),
    }
}

/// Configuration for directive rewriting, supporting user-defined directives.
#[derive(Debug, Clone, Default)]
pub struct DirectiveConfig {
    /// Custom directive names to recognize. When empty, the default built-in set is used.
    pub custom_names: Vec<String>,
    /// Mapping from directive name to component name. Falls back to "Aside".
    pub component_map: std::collections::HashMap<String, String>,
}

impl DirectiveConfig {
    /// Get the component name for a directive, defaulting to "Aside".
    pub fn component_for(&self, directive: &str) -> &str {
        self.component_map
            .get(directive)
            .map(|s| s.as_str())
            .unwrap_or("Aside")
    }

    /// Get the custom names as a slice of &str, or None to use defaults.
    fn custom_names_slice(&self) -> Option<Vec<&str>> {
        if self.custom_names.is_empty() {
            None
        } else {
            Some(self.custom_names.iter().map(|s| s.as_str()).collect())
        }
    }
}

/// Rewrite directive syntax to Aside JSX tags.
///
/// Converts:
/// ```text
/// :::note[Title]
/// Content here
/// :::
/// ```
///
/// To:
/// ```text
/// <Aside data-mf-source="directive" type="note" title="Title">
/// Content here
/// </Aside>
/// ```
///
/// When a directive appears after a list item (detected by trailing blank line
/// following list content), the output is indented to preserve list structure:
/// ```text
/// 1. First step
///
///    <Aside data-mf-source="directive" type="note">
///    Warning
///    </Aside>
///
/// 2. Second step
/// ```
///
/// This allows mdxjs-rs to process the content without requiring remark-directive.
///
/// # Returns
///
/// A tuple of (rewritten_content, directive_count) where directive_count is the
/// number of directives that were rewritten.
pub fn rewrite_directives_to_asides(input: &str) -> (String, usize) {
    rewrite_directives(input, &DirectiveConfig::default())
}

/// Rewrite directive syntax to JSX component tags using the given configuration.
///
/// This is the configurable version of `rewrite_directives_to_asides`.
/// When `config.custom_names` is empty, the default built-in directive names are used.
/// Component names are looked up from `config.component_map`, defaulting to "Aside".
pub fn rewrite_directives(input: &str, config: &DirectiveConfig) -> (String, usize) {
    let custom_names = config.custom_names_slice();
    let custom_names_ref = custom_names.as_deref();

    let mut fence_state = FenceState::default();
    let mut output = String::new();
    let mut count = 0usize;

    // Stack of active directive names (to support nesting if encountered).
    // Each entry includes the opening and the indentation to use.
    let mut directive_stack: Vec<(DirectiveOpening, String)> = Vec::new();

    // Track list context for indentation
    let mut list_indent: Option<String> = None;
    let mut in_list_context = false;
    let mut prev_line_blank = false;

    for line in input.lines() {
        let fence_outcome = advance_fence_state(line, fence_state);
        fence_state = fence_outcome.next_state;

        if fence_outcome.skip_rewrite {
            // Inside code fence; passthrough without touching directive syntax.
            // Apply directive indent to keep fence lines aligned with the directive wrapper.
            if let Some((_, indent)) = directive_stack.last() {
                if !indent.is_empty() {
                    writeln!(output, "{}{}", indent, line).ok();
                } else {
                    writeln!(output, "{}", line).ok();
                }
            } else {
                // Not inside a directive - check if fence line is outside list context
                // Reset if line indent is less than the list indent requirement
                if let Some(ref list_ind) = list_indent {
                    let line_indent = line.len() - line.trim_start().len();
                    if line_indent < list_ind.len() {
                        list_indent = None;
                        in_list_context = false;
                    }
                }
                writeln!(output, "{}", line).ok();
            }
            prev_line_blank = line.trim().is_empty();
            continue;
        }

        let trimmed = line.trim();

        // Track if we're in a list context (only when not inside a directive)
        if directive_stack.is_empty() {
            if let Some(indent) = detect_list_item_start(line) {
                // Only update list_indent if we're starting a new top-level list
                // (not already in a list context, or this is an unindented list item)
                if !in_list_context || (!line.starts_with(' ') && !line.starts_with('\t')) {
                    list_indent = Some(indent);
                }
                in_list_context = true;
                prev_line_blank = false;
            } else if trimmed.is_empty() {
                prev_line_blank = true;
                // Keep list_indent and in_list_context - blank line is still in list context
            } else if !trimmed.starts_with(":::") {
                // Non-list content that's not a directive
                // Unindented content ends list context
                if !line.starts_with(' ') && !line.starts_with('\t') {
                    list_indent = None;
                    in_list_context = false;
                }
                prev_line_blank = false;
            }
        }

        let opening = parse_opening_directive_with(line, custom_names_ref).or_else(|| {
            // In list context, directive lines are often indented one extra space
            // beyond the list content indent (e.g. 4 spaces after "1. ").
            // Try parsing again after removing the list indent prefix so these
            // lines are not misclassified as indented code blocks.
            if directive_stack.is_empty()
                && in_list_context
                && let Some(indent) = list_indent.as_ref()
                && !indent.is_empty()
                && line.starts_with(indent)
            {
                return parse_opening_directive_with(&line[indent.len()..], custom_names_ref);
            }
            None
        });

        if let Some(opening) = opening {
            count += 1;

            // Apply indent if in list context (regardless of blank line)
            let indent = list_indent.clone().unwrap_or_default();

            // Insert blank line before if in list context and prev line wasn't blank
            if !indent.is_empty() && !prev_line_blank {
                writeln!(output).ok();
            }

            directive_stack.push((opening.clone(), indent.clone()));
            let component = config.component_for(&opening.name);
            let start_tag = opening.to_component_start(component);
            writeln!(output, "{}{}", indent, start_tag).ok();
            prev_line_blank = false;
            continue;
        }

        if is_directive_closer(line)
            && let Some((opened, indent)) = directive_stack.pop()
        {
            let component = config.component_for(&opened.name);
            let end_tag = opened.to_component_end(component);
            writeln!(output, "{}{}", indent, end_tag).ok();

            // Insert blank line after if in list context
            if !indent.is_empty() {
                writeln!(output).ok();
                prev_line_blank = true;
            } else {
                prev_line_blank = false;
            }
            continue;
        }

        // If we're inside a directive with indentation, indent the content too
        if let Some((_, indent)) = directive_stack.last() {
            if !indent.is_empty() && !trimmed.is_empty() {
                writeln!(output, "{}{}", indent, line).ok();
            } else {
                writeln!(output, "{}", line).ok();
            }
        } else {
            writeln!(output, "{}", line).ok();
        }
        prev_line_blank = trimmed.is_empty();
    }

    // For any unclosed directives, close them at the end to avoid broken output.
    while let Some((opened, indent)) = directive_stack.pop() {
        let component = config.component_for(&opened.name);
        writeln!(output, "{}</{}>", indent, component).ok();
    }

    (output, count)
}

/// Detect if a line starts a list item and return the indentation needed
/// for content to belong to that list item.
///
/// For numbered lists like "1. Item", returns "   " (3 spaces - aligns with content after "1. ")
/// For bullet lists like "- Item", returns "  " (2 spaces)
fn detect_list_item_start(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let leading_spaces = line.len() - trimmed.len();

    // Check for numbered list: "1. ", "2. ", "10. ", "1) ", "2) ", etc.
    // CommonMark allows both "." and ")" as list markers
    for marker in [". ", ") "] {
        if let Some(marker_pos) = trimmed.find(marker) {
            let before_marker = &trimmed[..marker_pos];
            if before_marker.chars().all(|c| c.is_ascii_digit()) && !before_marker.is_empty() {
                // Indent = leading spaces + number length + marker (2 chars)
                let indent_size = leading_spaces + marker_pos + 2;
                return Some(" ".repeat(indent_size));
            }
        }
    }

    // Check for bullet list: "- ", "* ", "+ "
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
        let indent_size = leading_spaces + 2;
        return Some(" ".repeat(indent_size));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_note() {
        let opening = parse_opening_directive(":::note").unwrap();
        assert_eq!(opening.name, "note");
        assert!(opening.bracket_title.is_none());
    }

    #[test]
    fn parse_note_with_bracket_title() {
        let opening = parse_opening_directive(":::note[My Title]").unwrap();
        assert_eq!(opening.name, "note");
        assert_eq!(opening.bracket_title, Some("My Title".to_string()));
    }

    #[test]
    fn parse_note_with_attrs() {
        let opening = parse_opening_directive(":::warning data-test=\"yes\"").unwrap();
        assert_eq!(opening.name, "warning");
        assert_eq!(opening.raw_attrs, "data-test=\"yes\"");
    }

    #[test]
    fn type_attr_is_stripped() {
        let opening = parse_opening_directive(":::warning type=\"old\"").unwrap();
        assert_eq!(opening.name, "warning");
        assert!(!opening.raw_attrs.contains("type="));
    }

    #[test]
    fn title_attr_stripped_when_bracket_present() {
        let opening = parse_opening_directive(":::note[Hi] title=\"Ignored\"").unwrap();
        assert_eq!(opening.bracket_title, Some("Hi".to_string()));
        assert!(!opening.raw_attrs.contains("title="));
    }

    #[test]
    fn unsupported_directive_returns_none() {
        assert!(parse_opening_directive(":::unknown").is_none());
    }

    #[test]
    fn custom_directive_name_recognized() {
        let custom = &["note", "custom-box"][..];
        let opening = parse_opening_directive_with(":::custom-box[Title]", Some(custom));
        assert!(opening.is_some());
        let opening = opening.unwrap();
        assert_eq!(opening.name, "custom-box");
        assert_eq!(opening.bracket_title, Some("Title".to_string()));
    }

    #[test]
    fn custom_directive_rejects_unlisted() {
        let custom = &["note"][..];
        assert!(parse_opening_directive_with(":::tip", Some(custom)).is_none());
    }

    #[test]
    fn rewrite_directives_with_custom_component() {
        let mut config = DirectiveConfig::default();
        config
            .custom_names
            .extend(["note", "custom-box"].iter().map(|s| s.to_string()));
        config
            .component_map
            .insert("custom-box".to_string(), "MyBox".to_string());

        let input = ":::custom-box[Hello]\nContent\n:::";
        let (out, count) = rewrite_directives(input, &config);
        assert_eq!(count, 1);
        assert!(out.contains("<MyBox"), "Expected <MyBox>, got:\n{}", out);
        assert!(out.contains("type=\"custom-box\""));
        assert!(out.contains("title=\"Hello\""));
        assert!(out.contains("</MyBox>"), "Expected </MyBox>, got:\n{}", out);
    }

    #[test]
    fn rewrite_directives_default_component_for_unknown_mapping() {
        let mut config = DirectiveConfig::default();
        config
            .custom_names
            .extend(["note", "custom-box"].iter().map(|s| s.to_string()));
        // No component mapping for custom-box, should fall back to Aside

        let input = ":::custom-box\nContent\n:::";
        let (out, count) = rewrite_directives(input, &config);
        assert_eq!(count, 1);
        assert!(
            out.contains("<Aside"),
            "Expected <Aside> fallback, got:\n{}",
            out
        );
    }

    #[test]
    fn directive_closer_detected() {
        assert!(is_directive_closer(":::"));
        assert!(is_directive_closer("  :::  "));
        assert!(!is_directive_closer(":::note"));
    }

    #[test]
    fn rewrite_directives_simple() {
        let input = ":::note\nhello\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);
        assert!(out.contains("<Aside"));
        assert!(out.contains("type=\"note\""));
        assert!(out.contains("</Aside>"));
    }

    #[test]
    fn rewrite_preserves_code_fence() {
        let input = "```\n:::note\n```";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 0);
        assert!(out.contains(":::note"));
    }

    #[test]
    fn rewrite_handles_bracket_title() {
        let input = ":::caution[Important!]\nDanger\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);
        assert!(out.contains("type=\"caution\""));
        assert!(out.contains("title=\"Important!\""));
    }

    #[test]
    fn rewrite_multiple_directives() {
        let input = ":::note\nA\n:::\n\n:::tip\nB\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 2);
        assert!(out.contains("type=\"note\""));
        assert!(out.contains("type=\"tip\""));
    }

    #[test]
    fn rewrite_nested_directives() {
        let input = ":::note\nOuter\n:::tip\nInner\n:::\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 2);
        // Should have two closing tags
        assert_eq!(out.matches("</Aside>").count(), 2);
    }

    #[test]
    fn rewrite_unclosed_directive() {
        let input = ":::note\nNo closing";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);
        // Should auto-close at end
        assert!(out.contains("</Aside>"));
    }

    #[test]
    fn bracket_title_escapes_quotes() {
        let opening = parse_opening_directive(":::note[He said \"hi\"]").unwrap();
        assert_eq!(opening.bracket_title, Some("He said \"hi\"".to_string()));
        let tag = opening.to_aside_start();
        // Quotes should be escaped as &quot; in the output
        assert!(tag.contains("title=\"He said &quot;hi&quot;\""));
    }

    #[test]
    fn indented_code_block_not_parsed_as_directive() {
        // 4 spaces = indented code block, not a directive
        assert!(parse_opening_directive("    :::note").is_none());
        // Tab at start = indented code block
        assert!(parse_opening_directive("\t:::note").is_none());
        // 5 spaces = also indented code block
        assert!(parse_opening_directive("     :::tip").is_none());
    }

    #[test]
    fn rewrite_preserves_indented_directive_as_code() {
        let input = "    :::note\n    content\n    :::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 0);
        // Should preserve the original text unchanged
        assert!(out.contains("    :::note"));
    }

    #[test]
    fn rewrite_directive_in_list_context() {
        // Directive after a list item should be indented to preserve list structure
        let input = "1. First step\n\n:::note\nWarning\n:::\n\n2. Second step";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);
        // Should have indented Aside tags (3 spaces for "1. ")
        assert!(
            out.contains("   <Aside"),
            "Expected indented opening tag, got:\n{}",
            out
        );
        assert!(
            out.contains("   </Aside>"),
            "Expected indented closing tag, got:\n{}",
            out
        );
        // Content inside should also be indented
        assert!(
            out.contains("   Warning"),
            "Expected indented content, got:\n{}",
            out
        );
    }

    #[test]
    fn rewrite_directive_after_bullet_list() {
        // Bullet list uses 2-space indentation
        let input = "- First item\n\n:::tip\nHint\n:::\n\n- Second item";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);
        // Should have 2-space indented Aside tags
        assert!(
            out.contains("  <Aside"),
            "Expected 2-space indented opening tag, got:\n{}",
            out
        );
    }

    #[test]
    fn rewrite_directive_not_in_list_context() {
        // Directive at top level should not be indented
        let input = "# Heading\n\n:::note\nContent\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);
        // Opening tag should be at column 0
        assert!(
            out.contains("\n<Aside") || out.starts_with("<Aside"),
            "Expected non-indented opening tag, got:\n{}",
            out
        );
    }

    #[test]
    fn detect_list_item_patterns() {
        // Numbered lists with dot marker
        assert_eq!(detect_list_item_start("1. First"), Some("   ".to_string()));
        assert_eq!(
            detect_list_item_start("10. Tenth"),
            Some("    ".to_string())
        );
        assert_eq!(
            detect_list_item_start("100. Hundredth"),
            Some("     ".to_string())
        );

        // Bullet lists
        assert_eq!(detect_list_item_start("- Item"), Some("  ".to_string()));
        assert_eq!(detect_list_item_start("* Item"), Some("  ".to_string()));
        assert_eq!(detect_list_item_start("+ Item"), Some("  ".to_string()));

        // Indented lists
        assert_eq!(
            detect_list_item_start("  1. Nested"),
            Some("     ".to_string())
        );
        assert_eq!(
            detect_list_item_start("  - Nested"),
            Some("    ".to_string())
        );

        // Not lists
        assert_eq!(detect_list_item_start("Regular text"), None);
        assert_eq!(detect_list_item_start("# Heading"), None);
        assert_eq!(detect_list_item_start(":::note"), None);
    }

    #[test]
    fn detect_paren_list_item_patterns() {
        // Paren-style ordered lists (CommonMark allows both "." and ")" markers)
        assert_eq!(detect_list_item_start("1) First"), Some("   ".to_string()));
        assert_eq!(
            detect_list_item_start("10) Tenth"),
            Some("    ".to_string())
        );
        assert_eq!(
            detect_list_item_start("100) Hundredth"),
            Some("     ".to_string())
        );

        // Indented paren lists
        assert_eq!(
            detect_list_item_start("  1) Nested"),
            Some("     ".to_string())
        );
    }

    #[test]
    fn rewrite_multiple_consecutive_directives_in_list() {
        // Multiple directives after a list item should all be indented
        let input = "1. Step\n\n:::note\nNote\n:::\n\n:::tip\nTip\n:::\n\n2. Next";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 2);

        // Both should be indented
        let aside_lines: Vec<_> = out
            .lines()
            .filter(|l| l.contains("<Aside") || l.contains("</Aside>"))
            .collect();
        assert_eq!(aside_lines.len(), 4); // 2 opens + 2 closes

        for line in &aside_lines {
            assert!(
                line.starts_with("   "),
                "Expected indentation, got: '{}'",
                line
            );
        }
    }

    #[test]
    fn rewrite_directive_before_list() {
        // Directive before any list should NOT be indented
        let input = ":::note\nIntro\n:::\n\n1. First\n2. Second";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // Should not be indented
        assert!(
            out.starts_with("<Aside") || out.lines().next().unwrap().starts_with("<Aside"),
            "Directive before list should not be indented. Output:\n{}",
            out
        );
    }

    #[test]
    fn rewrite_directive_between_separate_lists() {
        // Directive between two separate lists should be part of the first
        let input = "1. List A\n\n:::note\nNote\n:::\n\n- List B";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // Should be indented (belongs to numbered list)
        assert!(
            out.contains("   <Aside"),
            "Expected indented Aside, got:\n{}",
            out
        );
    }

    #[test]
    fn parse_note_with_braced_attrs() {
        // remark-directive syntax uses braces: :::note{id="my-note"}
        let opening = parse_opening_directive(":::note{id=\"my-note\"}").unwrap();
        assert_eq!(opening.name, "note");
        assert_eq!(opening.raw_attrs, "id=\"my-note\"");
    }

    #[test]
    fn parse_note_with_braced_multiple_attrs() {
        let opening =
            parse_opening_directive(":::warning{id=\"warn-1\" class=\"important\"}").unwrap();
        assert_eq!(opening.name, "warning");
        assert_eq!(opening.raw_attrs, "id=\"warn-1\" class=\"important\"");
    }

    #[test]
    fn parse_note_with_bracket_title_and_braced_attrs() {
        // Bracket title + braced attributes
        let opening = parse_opening_directive(":::caution[Be Careful]{id=\"caution-1\"}").unwrap();
        assert_eq!(opening.name, "caution");
        assert_eq!(opening.bracket_title, Some("Be Careful".to_string()));
        assert_eq!(opening.raw_attrs, "id=\"caution-1\"");
    }

    #[test]
    fn rewrite_directive_with_braced_attrs() {
        let input = ":::note{id=\"my-note\"}\nContent\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);
        // Should output valid JSX without braces
        assert!(
            out.contains("id=\"my-note\""),
            "Expected unbraced id attribute, got:\n{}",
            out
        );
        assert!(
            !out.contains("{id="),
            "Should not contain braced attribute, got:\n{}",
            out
        );
    }

    #[test]
    fn braced_attrs_type_is_stripped() {
        // type attribute should still be stripped even with braces
        let opening = parse_opening_directive(":::warning{type=\"old\" id=\"test\"}").unwrap();
        assert_eq!(opening.name, "warning");
        assert!(!opening.raw_attrs.contains("type="));
        assert!(opening.raw_attrs.contains("id=\"test\""));
    }

    #[test]
    fn empty_braces_result_in_empty_attrs() {
        let opening = parse_opening_directive(":::note{}").unwrap();
        assert_eq!(opening.name, "note");
        assert!(opening.raw_attrs.is_empty());
    }

    #[test]
    fn rewrite_directive_immediately_after_list_item() {
        // No blank line between list item and directive
        let input = "1. First step\n:::note\nWarning\n:::\n\n2. Second step";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // Should have indented Aside tags
        assert!(
            out.contains("   <Aside"),
            "Expected 3-space indent, got:\n{}",
            out
        );

        // Should have blank lines around Aside for loose list
        assert!(
            out.contains("\n\n   <Aside"),
            "Expected blank before Aside, got:\n{}",
            out
        );
        assert!(
            out.contains("</Aside>\n\n"),
            "Expected blank after Aside, got:\n{}",
            out
        );
    }

    #[test]
    fn rewrite_directive_after_nested_list_item() {
        // Directive should use parent list indent, not sub-item indent
        let input = "1. Parent\n   - Sub-item\n\n   :::note\n   Content\n   :::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // Should use parent indent (3 spaces for "1. "), not sub-item (5 spaces)
        assert!(
            out.contains("   <Aside"),
            "Expected 3-space parent indent, got:\n{}",
            out
        );
        // Make sure it's not using 5-space indent
        assert!(
            !out.contains("     <Aside"),
            "Should NOT use 5-space sub-item indent, got:\n{}",
            out
        );
    }

    #[test]
    fn rewrite_directive_with_four_space_indent_in_numbered_list() {
        // In real-world Steps content, directives are often indented with 4 spaces.
        // This should still be treated as list content, not an indented code block.
        let input = "1. First step\n\n    :::tip[Keyboard shortcut]\n    Press Cmd+J.\n    :::\n\n2. Second step";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // Should be rewritten and aligned to the list content indent (3 spaces for "1. ")
        assert!(
            out.contains(
                "   <Aside data-mf-source=\"directive\" type=\"tip\" title=\"Keyboard shortcut\">"
            ),
            "Expected rewritten indented Aside, got:\n{}",
            out
        );
        assert!(
            !out.contains(":::tip[Keyboard shortcut]"),
            "Directive marker should be rewritten, got:\n{}",
            out
        );
        assert!(
            !out.contains("\n    <Aside"),
            "Aside should align to list indent, not keep 4-space indent, got:\n{}",
            out
        );
    }

    #[test]
    fn tokenize_attrs_simple() {
        let tokens = tokenize_attrs("foo=\"bar\" baz=\"qux\"");
        assert_eq!(tokens, vec!["foo=\"bar\"", "baz=\"qux\""]);
    }

    #[test]
    fn tokenize_attrs_with_spaces_in_quotes() {
        // Quoted values with spaces should stay intact
        let tokens = tokenize_attrs("title=\"foo bar\" id=\"test\"");
        assert_eq!(tokens, vec!["title=\"foo bar\"", "id=\"test\""]);
    }

    #[test]
    fn tokenize_attrs_single_quotes() {
        let tokens = tokenize_attrs("title='foo bar' id='test'");
        assert_eq!(tokens, vec!["title='foo bar'", "id='test'"]);
    }

    #[test]
    fn tokenize_attrs_mixed_quotes() {
        let tokens = tokenize_attrs("title=\"foo bar\" data='baz qux'");
        assert_eq!(tokens, vec!["title=\"foo bar\"", "data='baz qux'"]);
    }

    #[test]
    fn parse_directive_with_quoted_title_attr() {
        // This is the regression case: title="foo bar" was being split incorrectly
        let opening = parse_opening_directive(":::note{title=\"foo bar\"}").unwrap();
        assert_eq!(opening.name, "note");
        // title should be preserved as a single attribute
        assert_eq!(opening.raw_attrs, "title=\"foo bar\"");
    }

    #[test]
    fn parse_directive_with_multiple_spaced_attrs() {
        let opening =
            parse_opening_directive(":::warning{title=\"Be careful here\" class=\"my class\"}")
                .unwrap();
        assert_eq!(opening.name, "warning");
        assert_eq!(
            opening.raw_attrs,
            "title=\"Be careful here\" class=\"my class\""
        );
    }

    #[test]
    fn rewrite_directive_with_spaced_title() {
        let input = ":::note{title=\"foo bar\"}\nContent\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);
        // Should contain the full title attribute intact
        assert!(
            out.contains("title=\"foo bar\""),
            "Expected intact title attribute, got:\n{}",
            out
        );
        // Should NOT have malformed trailing content (orphaned bar" not inside an attribute)
        // Check that bar" only appears as part of title="foo bar"
        let bar_count = out.matches("bar\"").count();
        let title_bar_count = out.matches("title=\"foo bar\"").count();
        assert_eq!(
            bar_count, title_bar_count,
            "Found orphaned bar\" fragment outside title attribute. Output:\n{}",
            out
        );
    }

    #[test]
    fn rewrite_directive_after_code_fence_in_list() {
        // Directive after code fence within list item should preserve list indentation
        let input = "1. First step\n\n   ```js\n   code\n   ```\n\n   :::note\n   Warning\n   :::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // Should have 3-space indented Aside (belongs to numbered list)
        assert!(
            out.contains("   <Aside"),
            "Expected 3-space indent after code fence, got:\n{}",
            out
        );
    }

    #[test]
    fn rewrite_directive_with_code_fence_inside_list() {
        // Code fence inside directive inside list should preserve indentation
        let input = "1. First step\n\n:::note\nSome text\n```js\ncode\n```\n:::\n\n2. Second";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // All lines between <Aside> and </Aside> should be indented
        let lines: Vec<&str> = out.lines().collect();
        let aside_start = lines.iter().position(|l| l.contains("<Aside")).unwrap();
        let aside_end = lines.iter().position(|l| l.contains("</Aside>")).unwrap();

        // Check fence opener and closer are indented
        for line in lines.iter().take(aside_end).skip(aside_start + 1) {
            if !line.trim().is_empty() {
                assert!(
                    line.starts_with("   "),
                    "Line inside directive should be indented: '{}'",
                    line
                );
            }
        }
    }

    #[test]
    fn rewrite_directive_after_toplevel_fence_not_in_list() {
        // Top-level fence should reset list context
        let input = "1. List item\n\n```js\ncode\n```\n\n:::note\nContent\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // Directive should NOT be indented (fence at column 0 ends list context)
        assert!(
            out.contains("\n<Aside")
                || out
                    .lines()
                    .any(|l| l == "<Aside data-mf-source=\"directive\" type=\"note\">"),
            "Directive after top-level fence should not be indented. Output:\n{}",
            out
        );
    }

    #[test]
    fn rewrite_directive_after_slightly_indented_toplevel_fence() {
        // Fence at 1 space is still top-level (list "1. " requires 3 spaces)
        let input = "1. List item\n\n ```js\n code\n ```\n\n:::note\nContent\n:::";
        let (out, count) = rewrite_directives_to_asides(input);
        assert_eq!(count, 1);

        // Directive should NOT be indented (fence at 1 space < 3 required for list)
        assert!(
            out.contains("\n<Aside")
                || out
                    .lines()
                    .any(|l| l == "<Aside data-mf-source=\"directive\" type=\"note\">"),
            "Directive after 1-space fence should not be indented. Output:\n{}",
            out
        );
    }
}
