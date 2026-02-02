//! Directive preprocessing for the mdast renderer.

use crate::transform::code_fence::{FenceState, advance_fence_state};
use crate::transform::directives::{is_directive_closer, parse_opening_directive};
use std::fmt::Write;

/// Preprocesses input markdown to convert directive syntax into internal JSX tags.
///
/// This allows markdown-rs to preserve directive structure even though it doesn't
/// natively support `::: note` syntax. Using JSX tags ensures markdown between
/// the markers is still parsed correctly and unifies directive handling with JSX.
///
/// # Examples
///
/// Input:
/// ```text
/// :::note[Title]
/// Content
/// :::
/// ```
///
/// Output:
/// ```text
/// <mf-directive name="note" title="Title">
/// Content
/// </mf-directive>
/// ```
/// Auto-closes directives on the stack when indentation decreases or a new list item starts.
fn auto_close_directives(
    stack: &mut Vec<(String, String, bool)>,
    output: &mut String,
    line_indent: usize,
    trimmed: &str,
) {
    let mut should_auto_close = {
        let (_, opener_ws, _) = stack.last().expect("checked non-empty above");
        let opener_indent = opener_ws.len();

        // Only auto-close INDENTED directives (opener_indent > 0) when:
        // 1. We encounter a line with less indentation than the directive
        // 2. We encounter a numbered list item at same or less indentation
        if opener_indent > 0 {
            (line_indent < opener_indent)
                || (is_numbered_list_item(trimmed) && line_indent <= opener_indent)
        } else {
            false
        }
    };

    // Close ALL directives whose indentation exceeds the current line's indent
    while should_auto_close {
        let (_, leading_ws, _) = stack.pop().expect("checked non-empty above");
        writeln!(output, "{}</mf-directive>", leading_ws).ok();

        // Re-evaluate for remaining directives
        should_auto_close = if let Some((_, opener_ws, _)) = stack.last() {
            let opener_indent = opener_ws.len();
            if opener_indent > 0 {
                (line_indent < opener_indent)
                    || (is_numbered_list_item(trimmed) && line_indent <= opener_indent)
            } else {
                false
            }
        } else {
            false
        };
    }
}

/// Converts a directive opening into a `<mf-directive>` JSX tag string.
fn convert_directive_opening(
    opening: &crate::transform::directives::DirectiveOpening,
    leading_ws: &str,
) -> String {
    let mut tag = format!("{}<mf-directive name=\"{}\"", leading_ws, opening.name);

    if let Some(title) = &opening.bracket_title {
        let escaped_title = title.replace('"', "&quot;");
        write!(tag, " title=\"{}\"", escaped_title).ok();
    }

    if !opening.raw_attrs.is_empty() {
        write!(
            tag,
            " attrs=\"{}\"",
            opening.raw_attrs.replace('"', "&quot;")
        )
        .ok();
    }

    // Opening tag, not self-closing
    writeln!(tag, ">").ok();
    tag
}

pub fn preprocess_directives(input: &str) -> String {
    let mut fence_state = FenceState::default();
    let mut output = String::with_capacity(input.len());
    // Track directive names, leading whitespace, and whether we've seen content
    let mut directive_stack: Vec<(String, String, bool)> = Vec::new();

    for line in input.lines() {
        let fence_outcome = advance_fence_state(line, fence_state);
        fence_state = fence_outcome.next_state;

        // Inside code fence - passthrough without processing
        if fence_outcome.skip_imports {
            writeln!(output, "{}", line).ok();
            continue;
        }

        let trimmed = line.trim();
        let line_indent = line.len() - line.trim_start().len();

        // Auto-close indented directives when indentation decreases or a new list item starts
        if !directive_stack.is_empty() && !is_directive_closer(line) && !trimmed.is_empty() {
            auto_close_directives(&mut directive_stack, &mut output, line_indent, trimmed);
        }

        // Check for directive opening
        if let Some(opening) = parse_opening_directive(line) {
            let leading_ws: String = line.chars().take_while(|c| c.is_whitespace()).collect();
            directive_stack.push((opening.name.clone(), leading_ws.clone(), false));
            output.push_str(&convert_directive_opening(&opening, &leading_ws));
            continue;
        }

        // Check for directive closer
        if is_directive_closer(line) && !directive_stack.is_empty() {
            let (_, leading_ws, _) = directive_stack.pop().expect("checked non-empty above");
            writeln!(output, "{}</mf-directive>", leading_ws).ok();
            continue;
        }

        // Mark that we've seen content in the current directive
        if let Some((_, _, has_content)) = directive_stack.last_mut()
            && !trimmed.is_empty()
        {
            *has_content = true;
        }

        // Regular line - passthrough
        writeln!(output, "{}", line).ok();
    }

    // Close any unclosed directives
    while let Some((_, leading_ws, _)) = directive_stack.pop() {
        writeln!(output, "{}</mf-directive>", leading_ws).ok();
    }

    output
}

/// Checks if a line is a numbered list item (e.g., "3. Text")
fn is_numbered_list_item(trimmed: &str) -> bool {
    let mut chars = trimmed.chars().peekable();
    // Skip digits
    while chars.peek().is_some_and(|c| c.is_ascii_digit()) {
        chars.next();
    }
    // Check for ". " after digits
    matches!((chars.next(), chars.next()), (Some('.'), Some(' ')))
}
