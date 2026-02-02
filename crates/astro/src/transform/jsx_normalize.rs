//! JSX indentation normalization utilities.

/// Tracks code fence state for line-by-line processing.
///
/// Used to skip JSX normalization logic inside fenced code blocks.
#[derive(Default)]
struct FenceTracker {
    in_fence: bool,
    marker: Option<char>,
    len: usize,
    indent: usize,
}

impl FenceTracker {
    /// Advance the fence state for a single line. Returns `true` if the line
    /// is a fence delimiter (opening or closing).
    fn advance(&mut self, trimmed: &str, line_indent: usize) -> bool {
        let is_fence_line = (trimmed.starts_with("```") || trimmed.starts_with("~~~"))
            && if self.in_fence {
                line_indent <= self.indent + 3
            } else {
                true
            };
        if !is_fence_line {
            return false;
        }

        let marker = trimmed.as_bytes()[0] as char;
        let count = trimmed.chars().take_while(|&c| c == marker).count();
        if self.in_fence {
            if Some(marker) == self.marker && count >= self.len {
                self.in_fence = false;
                self.marker = None;
                self.len = 0;
            }
        } else {
            self.in_fence = true;
            self.marker = Some(marker);
            self.len = count;
            self.indent = line_indent;
        }
        true
    }

    /// Returns whether we are currently inside a fenced code block.
    fn is_in_fence(&self) -> bool {
        self.in_fence
    }
}

/// Information about a parsed JSX tag.
#[derive(Debug, Clone)]
struct JsxTagInfo {
    /// The tag name (e.g., "MyComponent", "div", "Fragment")
    name: String,
    /// Whether this is a self-closing tag (ends with `/>`)
    self_closing: bool,
    /// Whether this tag has a `slot=` attribute
    has_slot_attr: bool,
}

/// Parses a JSX tag from a trimmed line.
/// Returns None for non-JSX content, closing tags, or comments.
fn parse_jsx_tag(trimmed: &str) -> Option<JsxTagInfo> {
    // Must start with '<' but not '</' (closing) or '<!' (comment)
    if !trimmed.starts_with('<') || trimmed.starts_with("</") || trimmed.starts_with("<!") {
        return None;
    }

    let rest = &trimmed[1..];
    let name_end = rest
        .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
        .unwrap_or(rest.len());
    let name = &rest[..name_end];

    if name.is_empty() {
        return None;
    }

    let self_closing = trimmed.trim_end().ends_with("/>");
    let has_slot_attr = trimmed.contains("slot=");

    Some(JsxTagInfo {
        name: name.to_string(),
        self_closing,
        has_slot_attr,
    })
}

/// Normalizes JSX indentation and spacing.
///
/// 1. Inserts a blank line before any block-level JSX component (Capitalized tag)
///    that follows non-blank content. This prevents "Tag mismatch" errors where
///    components get trapped inside Markdown paragraphs.
///    e.g. "Text\n<Component>" -> "Text\n\n<Component>"
///
/// 2. Preserves indentation inside JSX blocks/fences as much as possible.
pub fn normalize_mdx_jsx_indentation(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut fence = FenceTracker::default();

    // Simple bracket counting to skip logic inside nested structures if needed,
    // but for now strictly generic line-based processing.
    let mut last_line_was_blank = true;

    for line in input.split_inclusive('\n') {
        let (raw_body, line_ending) = if let Some(stripped) = line.strip_suffix('\n') {
            let stripped = stripped.strip_suffix('\r').unwrap_or(stripped);
            (stripped, &line[stripped.len()..])
        } else {
            (line, "")
        };

        let line_body = raw_body;
        let trimmed = line_body.trim_start();

        // 1. Code Fence Tracking
        let line_indent = line_body.len() - trimmed.len();
        if fence.advance(trimmed, line_indent) {
            // Pass through fencing lines exactly as is
            output.push_str(line_body);
            output.push_str(line_ending);
            last_line_was_blank = trimmed.is_empty();
            continue;
        }

        // 2. Normalization Logic (Only outside fences)
        if !fence.is_in_fence() {
            // Check for JSX opening tags
            if let Some(tag) = parse_jsx_tag(trimmed) {
                // Heuristic: Capitalized tag = Component. Lowercase = HTML.
                // If it's a Component and previous line wasn't blank, insert blank line.
                let is_component = tag.name.chars().next().is_some_and(|c| c.is_uppercase());

                // Only insert if not already blank
                if is_component && !last_line_was_blank {
                    output.push('\n');
                }

                // We are not tracking specific component names anymore.
                // Just pass the line through.
                output.push_str(line_body);
                output.push_str(line_ending);

                // The line we just added is obviously not blank
                last_line_was_blank = false;
                continue;
            }
        }

        // Pass through regular lines
        output.push_str(line_body);
        output.push_str(line_ending);

        last_line_was_blank = trimmed.is_empty();
    }

    output
}

/// Collapses multiline wrapper tags (like `<p>`) that contain only JSX components.
///
/// This fixes a parsing issue in markdown-rs where multiline JSX elements inside
/// list items cause tag mismatch errors. The pattern:
///
/// ```text
///     <p>
///       <Spoiler>content</Spoiler>
///     </p>
/// ```
///
/// Gets transformed to:
///
/// ```text
///     <p><Spoiler>content</Spoiler></p>
/// ```
///
/// This function uses generic rules without hardcoding specific component names:
/// - Lowercase tags like `<p>`, `<div>` are detected as HTML wrappers
/// - Uppercase tags like `<Spoiler>`, `<Option>` are detected as components
pub fn collapse_multiline_wrapper_tags(input: &str) -> String {
    let lines: Vec<&str> = input.lines().collect();
    let mut output = String::with_capacity(input.len());
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();

        // Detect lowercase HTML wrapper tags: <p>, <div>, <span>, etc.
        // These often wrap JSX components and cause tag mismatch issues
        if let Some(tag_name) = detect_simple_html_wrapper(trimmed) {
            // Look for pattern: <tag>\n  <Component>...</Component>\n  </tag>
            if i + 2 < lines.len() {
                let next_line = lines[i + 1].trim();
                let close_line = lines[i + 2].trim();
                let expected_close = format!("</{}>", tag_name);

                // Check if next line is a component (uppercase) and has matching closer
                let is_component_content = next_line.starts_with('<')
                    && next_line.chars().nth(1).is_some_and(|c| c.is_uppercase());
                let has_closing = close_line == expected_close;

                if is_component_content && has_closing {
                    let indent = &line[..line.len() - trimmed.len()];
                    output.push_str(indent);
                    output.push('<');
                    output.push_str(tag_name);
                    output.push('>');
                    output.push_str(next_line);
                    output.push_str(&expected_close);
                    output.push('\n');
                    i += 3;
                    continue;
                }
            }
        }

        output.push_str(line);
        output.push('\n');
        i += 1;
    }

    // Handle case where input doesn't end with newline
    if !input.ends_with('\n') && !output.is_empty() && output.ends_with('\n') {
        output.pop();
    }

    output
}

/// Normalizes list-embedded JSX components (tab components) to prevent tag mismatch errors.
///
/// Tab components inside lists cause markdown-rs to misinterpret list boundaries.
/// This function inserts blank lines around indented tab components to force proper parsing.
///
/// Target components:
/// - `PackageManagerTabs`, `StaticSsrTabs`, `UIFrameworkTabs`, `TabItem`
/// - `Fragment` (when `slot=` attribute is present)
///
/// IMPORTANT: This function processes entire components as units using depth-tracking.
/// Nested components (like `<Fragment slot="...">` inside `<StaticSsrTabs>`) are passed
/// through as-is without blank line insertion, which would break the parent component.
/// Collects and outputs nested JSX lines from `start+1` through the matching closing tag.
///
/// Returns the index after the last line processed (i.e., one past the closing tag).
/// If no matching closing tag is found, returns `start + 1`.
fn collect_nested_jsx_lines(
    lines: &[&str],
    start: usize,
    tag_name: &str,
    needs_reindent: bool,
    base_cols: usize,
    target_indent: usize,
    output: &mut String,
) -> usize {
    let open_prefix = format!("<{}", tag_name);
    let close_tag = format!("</{}>", tag_name);
    let mut j = start + 1;
    let mut depth = 1;

    while j < lines.len() && depth > 0 {
        let inner_trimmed = lines[j].trim_start();

        // Track nested same-name components (opening tags increase depth)
        if inner_trimmed.starts_with(&open_prefix) {
            let after_name = inner_trimmed.get(open_prefix.len()..);
            let is_same_component = after_name.is_none_or(|s| {
                s.is_empty() || s.starts_with('>') || s.starts_with(' ') || s.starts_with('/')
            });
            if is_same_component && !inner_trimmed.trim_end().ends_with("/>") {
                depth += 1;
            }
        }

        // Track closing tags (decrease depth)
        if inner_trimmed.starts_with(&close_tag) {
            depth -= 1;
        }

        if depth > 0 {
            // Check for nested list JSX component with tab indentation
            if !needs_reindent
                && has_leading_tabs(lines[j])
                && let Some(nested_tag) = parse_jsx_tag(inner_trimmed).filter(is_list_jsx_component)
                && !nested_tag.self_closing
                && !lines[j].contains(&format!("</{}>", nested_tag.name))
            {
                j = reindent_nested_jsx_block(lines, j, &nested_tag.name, output);
                continue;
            }
            // Output inner lines, re-indenting if needed
            if needs_reindent {
                output.push_str(&reindent_line(lines[j], base_cols, target_indent));
            } else {
                output.push_str(lines[j]);
            }
            output.push('\n');
        }
        j += 1;
    }

    // Output closing tag
    if j > start + 1 && depth == 0 {
        if needs_reindent {
            output.push_str(&reindent_line(lines[j - 1], base_cols, target_indent));
        } else {
            output.push_str(lines[j - 1]);
        }
        output.push('\n');
        return j;
    }

    start + 1
}

/// Normalizes list-embedded JSX components to prevent tag mismatch errors.
///
/// Inserts blank lines around indented tab components to force proper parsing
/// and re-indents tab-indented components to spaces.
pub fn normalize_list_jsx_components(input: &str) -> String {
    let lines: Vec<&str> = input.lines().collect();
    let mut output = String::with_capacity(input.len() + 100);
    let mut i = 0;
    let mut fence = FenceTracker::default();

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();

        // Code fence tracking: skip all lines inside fenced code blocks
        let line_indent = line.len() - trimmed.len();
        let is_fence_line = fence.advance(trimmed, line_indent);
        if fence.is_in_fence() || is_fence_line {
            output.push_str(line);
            output.push('\n');
            i += 1;
            continue;
        }

        // Check if this is a list JSX component (opening tag)
        if let Some(tag_info) = parse_jsx_tag(trimmed).filter(is_list_jsx_component) {
            // Detect tab indentation and compute re-indent parameters
            let needs_reindent = has_leading_tabs(line);
            let (base_cols, target_indent) = if needs_reindent {
                let base = leading_column_width(line);
                let target = find_list_continuation_indent(&lines, i).unwrap_or(base);
                (base, target)
            } else {
                (0, 0)
            };

            // Check if we need a blank line before
            if i > 0 && needs_blank_line_before(&lines, i) {
                output.push('\n');
            }

            if needs_reindent {
                output.push_str(&reindent_line(line, base_cols, target_indent));
            } else {
                output.push_str(line);
            }
            output.push('\n');

            // For self-closing tags, check if we need blank line after
            if tag_info.self_closing {
                if i + 1 < lines.len() && needs_blank_line_after(&lines, i) {
                    output.push('\n');
                }
                i += 1;
                continue;
            }

            // Check if the component is inline (opens and closes on the same line)
            // e.g., <Fragment slot="foo">content</Fragment>
            let close_tag = format!("</{}>", tag_info.name);
            if line.contains(&close_tag) {
                // Inline component - already output the line, just continue
                if i + 1 < lines.len() && needs_blank_line_after(&lines, i) {
                    output.push('\n');
                }
                i += 1;
                continue;
            }

            // For non-self-closing, non-inline tags, collect nested lines and output closing tag
            let j = collect_nested_jsx_lines(
                &lines,
                i,
                &tag_info.name,
                needs_reindent,
                base_cols,
                target_indent,
                &mut output,
            );

            if j > i + 1 {
                // Blank line after closing if needed
                if j < lines.len() && needs_blank_line_after(&lines, j - 1) {
                    output.push('\n');
                }
                i = j;
                continue;
            }

            // If we couldn't find matching closing tag, just continue normally
            i += 1;
            continue;
        }

        output.push_str(line);
        output.push('\n');
        i += 1;
    }

    // Handle case where input doesn't end with newline
    if !input.ends_with('\n') && !output.is_empty() && output.ends_with('\n') {
        output.pop();
    }

    output
}

/// List of tab component names that need special handling in list context.
const LIST_JSX_COMPONENTS: &[&str] = &[
    // Tab components
    "PackageManagerTabs",
    "StaticSsrTabs",
    "UIFrameworkTabs",
    "Tabs",
    "TabItem",
    // Tutorial/content components
    "Steps",
    "Box",
    "FileTree",
];

/// Checks if a tag is a list-embedded JSX component that needs special handling.
fn is_list_jsx_component(tag: &JsxTagInfo) -> bool {
    LIST_JSX_COMPONENTS.contains(&tag.name.as_str())
        || (tag.name == "Fragment" && tag.has_slot_attr)
        // Handle custom elements (lowercase with dash, like mf-directive)
        || tag.name.contains('-')
}

/// Checks if a blank line should be inserted before the component at index i.
fn needs_blank_line_before(lines: &[&str], i: usize) -> bool {
    // If the line immediately before is blank, don't insert another blank line
    if i > 0 && lines[i - 1].trim().is_empty() {
        return false;
    }

    // Look backwards for the previous non-blank line
    let mut prev_idx = i.saturating_sub(1);
    while prev_idx > 0 && lines[prev_idx].trim().is_empty() {
        prev_idx -= 1;
    }

    let prev_trimmed = lines[prev_idx].trim();

    // Don't insert if the first line is this component (nothing before it)
    if prev_trimmed.is_empty() {
        return false;
    }

    // If previous line is a closing tag like </Fragment>, </TabItem>, etc., don't add blank
    if prev_trimmed.starts_with("</") {
        return false;
    }

    // If previous line is an inline component (contains both opening and closing tag),
    // don't add blank line - they should flow together
    if let Some(prev_tag) = parse_jsx_tag(prev_trimmed).filter(|t| !t.self_closing) {
        let close_tag = format!("</{}>", prev_tag.name);
        if prev_trimmed.contains(&close_tag) {
            return false;
        }
    }

    true
}

/// Checks if a blank line should be inserted after the component at index i.
fn needs_blank_line_after(lines: &[&str], i: usize) -> bool {
    if i + 1 >= lines.len() {
        return false;
    }

    let next_trimmed = lines[i + 1].trim();

    // Don't insert if next line is already blank
    if next_trimmed.is_empty() {
        return false;
    }

    // Don't insert if next line is an opening component tag (they flow together)
    if parse_jsx_tag(next_trimmed)
        .filter(is_list_jsx_component)
        .is_some()
    {
        return false;
    }

    // Don't insert if next line is a closing tag
    if next_trimmed.starts_with("</") {
        return false;
    }

    true
}

/// Compute the column width of leading whitespace (tabs = 4 columns each).
fn leading_column_width(line: &str) -> usize {
    let mut cols = 0;
    for ch in line.chars() {
        match ch {
            '\t' => cols += 4,
            ' ' => cols += 1,
            _ => break,
        }
    }
    cols
}

/// Find the continuation indent for the list item containing line `i`.
/// Returns the number of spaces needed for continuation content.
fn find_list_continuation_indent(lines: &[&str], i: usize) -> Option<usize> {
    let mut idx = i.saturating_sub(1);
    loop {
        let line = lines[idx];
        let trimmed = line.trim_start();
        let leading = leading_column_width(line);
        // Ordered list: digits followed by ". " or ") "
        let rest = trimmed.trim_start_matches(|c: char| c.is_ascii_digit());
        if rest.len() < trimmed.len() && (rest.starts_with(". ") || rest.starts_with(") ")) {
            let digits = trimmed.len() - rest.len();
            // 1 for delimiter char ('.' or ')'), then count actual spaces
            let after_delim = &rest[1..]; // skip '.' or ')'
            let spaces = after_delim.len() - after_delim.trim_start().len();
            let spaces = spaces.max(1); // at least 1 space
            return Some(leading + digits + 1 + spaces);
        }
        // Unordered list: "- ", "* ", "+ "
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
            let after_marker = &trimmed[1..]; // skip marker char
            let spaces = after_marker.len() - after_marker.trim_start().len();
            let spaces = spaces.max(1);
            return Some(leading + 1 + spaces);
        }
        if idx == 0 {
            break;
        }
        idx -= 1;
    }
    None
}

/// Re-indent a line: strip its leading whitespace and prepend `indent` spaces.
/// Preserves relative indentation based on column width difference from `base_cols`.
fn reindent_line(line: &str, base_cols: usize, target_indent: usize) -> String {
    let line_cols = leading_column_width(line);
    let extra = line_cols.saturating_sub(base_cols);
    let content = line.trim_start();
    let total = target_indent + extra;
    format!("{}{}", " ".repeat(total), content)
}

/// Check if a line's leading whitespace contains any tabs.
fn has_leading_tabs(line: &str) -> bool {
    line.chars()
        .take_while(|c| c.is_whitespace())
        .any(|c| c == '\t')
}

/// Re-indent a nested JSX component block that has tab indentation.
/// Processes from the opener at `start` through the matching closer.
/// Returns the index after the last line processed.
fn reindent_nested_jsx_block(
    lines: &[&str],
    start: usize,
    tag_name: &str,
    output: &mut String,
) -> usize {
    let base_cols = leading_column_width(lines[start]);
    let target = find_list_continuation_indent(lines, start).unwrap_or(base_cols);

    // Output opener
    output.push_str(&reindent_line(lines[start], base_cols, target));
    output.push('\n');

    let close_tag = format!("</{}>", tag_name);
    let open_prefix = format!("<{}", tag_name);
    let mut j = start + 1;
    let mut nested_depth = 1;

    while j < lines.len() && nested_depth > 0 {
        let t = lines[j].trim_start();

        if t.starts_with(&open_prefix) {
            let after = t.get(open_prefix.len()..);
            let is_same = after.is_none_or(|s| {
                s.is_empty() || s.starts_with('>') || s.starts_with(' ') || s.starts_with('/')
            });
            if is_same && !t.trim_end().ends_with("/>") {
                nested_depth += 1;
            }
        }
        if t.starts_with(&close_tag) {
            nested_depth -= 1;
        }

        output.push_str(&reindent_line(lines[j], base_cols, target));
        output.push('\n');
        j += 1;
    }
    j
}

/// Detects simple HTML wrapper tags like <p>, <div>, <span>
/// Returns the tag name if it's a simple lowercase tag
fn detect_simple_html_wrapper(trimmed: &str) -> Option<&str> {
    // Simple patterns: "<p>", "<div>", etc.
    let simple_tags = ["p", "div", "span", "li", "td", "th"];
    for tag in &simple_tags {
        let open = format!("<{}>", tag);
        if trimmed == open {
            return Some(tag);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inserts_blank_line_before_component() {
        let input = "Some text\n<MyComponent>\ncontent\n</MyComponent>\n";
        let result = normalize_mdx_jsx_indentation(input);
        assert!(result.contains("Some text\n\n<MyComponent>"));
    }

    #[test]
    fn test_no_blank_line_before_html_tag() {
        let input = "Some text\n<div>\ncontent\n</div>\n";
        let result = normalize_mdx_jsx_indentation(input);
        assert!(result.contains("Some text\n<div>"));
    }

    #[test]
    fn test_preserves_existing_blank_line() {
        let input = "Some text\n\n<Box>\ncontent\n</Box>\n";
        let result = normalize_mdx_jsx_indentation(input);
        assert!(!result.contains("\n\n\n"));
    }

    #[test]
    fn test_no_blank_line_inside_fence() {
        let input = "```\n<Box>\n```\n";
        let result = normalize_mdx_jsx_indentation(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_collapse_multiline_p_with_component() {
        let input = "    <p>\n      <Spoiler>Content</Spoiler>\n    </p>\n";
        let result = collapse_multiline_wrapper_tags(input);
        assert_eq!(result, "    <p><Spoiler>Content</Spoiler></p>\n");
    }

    #[test]
    fn test_collapse_preserves_non_matching_content() {
        let input = "<p>\nSome text\n</p>\n";
        let result = collapse_multiline_wrapper_tags(input);
        // This should NOT be collapsed because content is plain text, not a component
        assert_eq!(result, input);
    }

    #[test]
    fn test_normalize_list_jsx_inserts_blank_before_tabs() {
        let input =
            "1. List item\n    <PackageManagerTabs>\n    content\n    </PackageManagerTabs>\n";
        let result = normalize_list_jsx_components(input);
        assert!(
            result.contains("1. List item\n\n    <PackageManagerTabs>"),
            "Should insert blank line before indented PackageManagerTabs. Got: {}",
            result
        );
    }

    #[test]
    fn test_normalize_list_jsx_preserves_blank_after_closing() {
        let input = "    </PackageManagerTabs>\n\n3. Next item\n";
        let result = normalize_list_jsx_components(input);
        // No change needed - it's a closing tag, not an opening
        assert_eq!(result, input);
    }

    #[test]
    fn test_normalize_list_jsx_fragment_with_slot() {
        let input = "1. Item\n    <Fragment slot=\"npm\">\n    code\n    </Fragment>\n";
        let result = normalize_list_jsx_components(input);
        assert!(
            result.contains("1. Item\n\n    <Fragment slot="),
            "Should insert blank line before Fragment with slot. Got: {}",
            result
        );
    }

    #[test]
    fn test_normalize_list_jsx_no_change_non_list_context() {
        let input = "<PackageManagerTabs>\ncontent\n</PackageManagerTabs>\n";
        let result = normalize_list_jsx_components(input);
        // No indentation = not in list context, should not change
        assert_eq!(result, input);
    }

    #[test]
    fn test_normalize_list_jsx_nested_components_preserved() {
        // Nested Fragment inside StaticSsrTabs should NOT get blank lines inserted
        // This was the bug that caused "Unexpected closing tag </StaticSsrTabs>, expected </Fragment>"
        let input = r#"1. Item

    <StaticSsrTabs>
    <Fragment slot="static">
    Static content
    </Fragment>
    <Fragment slot="ssr">
    SSR content
    </Fragment>
    </StaticSsrTabs>

2. Next item
"#;
        let result = normalize_list_jsx_components(input);

        // Should NOT have blank lines around nested Fragment tags
        assert!(
            !result.contains("</Fragment>\n\n    <Fragment"),
            "Should NOT insert blank line between nested Fragment tags. Got:\n{}",
            result
        );

        // The overall structure should be preserved - blank line before StaticSsrTabs
        // and blank line after (which already exists)
        assert!(
            result.contains("1. Item\n\n    <StaticSsrTabs>"),
            "Should preserve blank line before StaticSsrTabs. Got:\n{}",
            result
        );
    }

    #[test]
    fn test_normalize_list_jsx_deeply_nested_same_component() {
        // Test depth tracking with same-named nested components
        let input = r#"1. Item

    <Box>
    <Box>
    Inner box
    </Box>
    </Box>

2. Next
"#;
        let result = normalize_list_jsx_components(input);

        // Inner Box should NOT get blank lines
        assert!(
            !result.contains("</Box>\n\n    </Box>"),
            "Should NOT insert blank line between nested closing Box tags. Got:\n{}",
            result
        );
    }

    #[test]
    fn test_normalize_list_jsx_skips_code_fences() {
        // Tags inside code fences should NOT be processed
        let input = "1. Install:\n\n    ```astro\n    <builder-component model=\"page\" />\n    </builder-component>\n    ```\n\n2. Next step\n";
        let result = normalize_list_jsx_components(input);
        assert_eq!(
            result, input,
            "Code fence content should be passed through unchanged"
        );
    }

    #[test]
    fn test_list_fence_indented_4_spaces_not_treated_as_close() {
        // Inside a top-level fence, a 4-space-indented backtick line is content, not a closer
        let input = "```\n    ```\nstill in fence\n```\n";
        let result = normalize_list_jsx_components(input);
        assert_eq!(
            result, input,
            "Indented backtick line should not close the fence"
        );
    }

    #[test]
    fn test_normalize_list_jsx_code_fence_no_duplication() {
        // Regression: <custom-element> inside a code fence caused content duplication
        let input = "Text before\n\n```astro\n<mux-video\n  data-testid=\"video\"\n></mux-video>\n```\n\nText after\n";
        let result = normalize_list_jsx_components(input);
        assert_eq!(
            result, input,
            "Content inside code fences must not be duplicated"
        );
    }

    #[test]
    fn test_normalize_list_jsx_filetree_inside_numbered_list() {
        let input = "1. Create the following files:\n\t\t<FileTree>\n\t\t- src/\n\t\t  - content/\n\t\t</FileTree>\n";
        let result = normalize_list_jsx_components(input);
        assert!(
            result.contains("Create the following files:\n\n"),
            "Should insert blank line before FileTree in numbered list. Got:\n{}",
            result
        );
        assert!(
            result.contains("</FileTree>\n"),
            "Should preserve FileTree closing tag. Got:\n{}",
            result
        );
    }

    #[test]
    fn test_fence_indented_4_spaces_not_treated_as_close() {
        // A line with 4+ spaces of indent containing backticks is content, not a fence closer
        let input = "```\n    ```\nstill in fence\n```\n";
        let result = normalize_mdx_jsx_indentation(input);
        assert_eq!(
            result, input,
            "Indented backtick line should not close the fence"
        );
    }

    #[test]
    fn test_fence_length_tracking_no_premature_close() {
        // A 4-backtick fence should not be closed by a 3-backtick line inside it
        let input =
            "1. Example:\n\n    ````md\n    ```\n    nested\n    ```\n    ````\n\n2. Next\n";
        let result = normalize_list_jsx_components(input);
        assert_eq!(
            result, input,
            "4-tick fence containing 3-tick lines should not be prematurely closed"
        );
    }

    #[test]
    fn test_normalize_list_jsx_single_line_fragment_slots() {
        // This pattern from islands.mdx was causing "Unexpected closing slash `/` in tag" errors
        // The issue: <Fragment slot="...">content</Fragment> on a single line
        // should NOT trigger depth tracking across lines
        let input = r#"<IslandsDiagram>
  <Fragment slot="headerApp">Header (interactive island)</Fragment>
  <Fragment slot="sidebarApp">Sidebar (static HTML)</Fragment>
  <Fragment slot="main">
    Static content like text, images, etc.
  </Fragment>
  <Fragment slot="carouselApp">Image carousel (interactive island)</Fragment>
  <Fragment slot="footer">Footer (static HTML)</Fragment>
</IslandsDiagram>
"#;
        let result = normalize_list_jsx_components(input);

        // The output should be essentially unchanged - the single-line Fragment tags
        // should NOT cause blank line insertions that break the structure
        assert!(
            result.contains("<Fragment slot=\"headerApp\">"),
            "Fragment tags should be preserved. Got:\n{}",
            result
        );

        // Make sure we don't break the closing tag
        assert!(
            result.contains("</IslandsDiagram>"),
            "IslandsDiagram closing tag should be preserved. Got:\n{}",
            result
        );

        // Most importantly: the output should parse correctly
        // (we'll verify this via integration test)
    }

    #[test]
    fn test_normalize_list_jsx_tab_indent_reindented() {
        // Tab-indented FileTree inside numbered list should be re-indented to spaces
        let input =
            "4. Description:\n\t\t<FileTree>\n\t\t- src/\n\t\t  - content/\n\t\t</FileTree>\n";
        let result = normalize_list_jsx_components(input);
        assert!(
            !result.contains('\t'),
            "Tabs should be converted to spaces. Got:\n{}",
            result
        );
        assert!(
            result.contains("<FileTree>"),
            "FileTree tag should be preserved"
        );
        assert!(
            result.contains("</FileTree>"),
            "Closing tag should be preserved"
        );
    }

    #[test]
    fn test_normalize_list_jsx_tab_indent_nested_in_steps() {
        // FileTree with tab indentation nested inside <Steps> (which has no tabs)
        let input = "<Steps>\n1. First\n\n2. Second\n\n4. Description:\n\t\t<FileTree>\n\t\t- src/\n\t\t  - content/\n\t\t</FileTree>\n\n5. Next\n</Steps>\n";
        let result = normalize_list_jsx_components(input);
        assert!(
            !result.contains('\t'),
            "Tabs should be converted to spaces. Got:\n{}",
            result
        );
        assert!(
            result.contains("<FileTree>"),
            "FileTree tag should be preserved"
        );
        assert!(
            result.contains("</FileTree>"),
            "Closing tag should be preserved"
        );
        assert!(
            result.contains("<Steps>"),
            "Steps opener should be preserved"
        );
        assert!(
            result.contains("</Steps>"),
            "Steps closer should be preserved"
        );
    }

    #[test]
    fn test_normalize_list_jsx_multi_space_marker() {
        // "1.  Item" has two spaces after the dot; continuation indent = 1 digit + '.' + 2 spaces = 4
        let input = "1.  Item\n\t<FileTree>\n\t- src/\n\t</FileTree>\n";
        let result = normalize_list_jsx_components(input);
        // The FileTree should be indented to 4 spaces (1 digit + '.' + 2 spaces)
        assert!(
            result.contains("    <FileTree>"),
            "FileTree should be indented to 4 spaces for '1.  ' marker. Got:\n{}",
            result
        );
        assert!(
            !result.contains('\t'),
            "Tabs should be converted to spaces. Got:\n{}",
            result
        );
    }

    #[test]
    fn test_normalize_list_jsx_tab_indent_with_attributes() {
        // Tab-indented FileTree with attributes
        let input =
            "4. Description:\n\t\t<FileTree title=\"Structure\">\n\t\t- src/\n\t\t</FileTree>\n";
        let result = normalize_list_jsx_components(input);
        assert!(
            !result.contains('\t'),
            "Tabs should be converted to spaces. Got:\n{}",
            result
        );
    }
}
