//! MDX compilation using mdxjs-rs.
//!
//! This module provides MDX compilation capabilities using the mdxjs-rs crate,
//! which compiles MDX (Markdown with JSX) to JavaScript using markdown-rs and SWC.

use crate::directives::rewrite_directives_to_asides;
use crate::slug::extract_custom_id;
use crate::{FrontmatterExtraction, extract_frontmatter, slug::Slugger};
use mdxjs::{JsxRuntime, MdxParseOptions, Options, compile};

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
    /// Whether to rewrite JSX code blocks to HTML format for ExpressiveCode.
    /// Only set to true when ExpressiveCode is enabled.
    pub rewrite_code_blocks: bool,
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

    // Preprocess directives (:::note, :::caution, etc.) into JSX Aside tags
    // This allows mdxjs-rs to parse the content without requiring remark-directive
    let (content, _directive_count) = rewrite_directives_to_asides(&content);

    // Extract headings from the source before compilation
    let headings = extract_headings_from_source(&content);

    // Strip {#custom-id} from headings before passing to mdxjs-rs
    // (MDX treats {…} as JSX expressions, so they must be removed)
    let content = strip_custom_ids_from_headings(&content);

    // Configure mdxjs-rs options
    let mdx_options = Options {
        filepath: Some(filepath.to_string()),
        jsx_runtime: Some(JsxRuntime::Automatic),
        jsx_import_source: opts.jsx_import_source,
        jsx: opts.jsx,
        parse: MdxParseOptions::gfm(),
        ..Default::default()
    };

    // Compile MDX to JavaScript
    let js_code = compile(&content, &mdx_options)
        .map_err(|e| MdxCompileError::CompileError(e.to_string()))?;

    // Post-process: wrap task list checkbox inputs in <label><span> for Checklist component CSS
    let js_code = rewrite_task_list_items(&js_code);

    // Post-process: convert JSX code blocks to HTML format for ExpressiveCode compatibility
    // Only rewrite when ExpressiveCode is enabled, otherwise code blocks become escaped text
    let js_code = if opts.rewrite_code_blocks {
        rewrite_jsx_code_blocks(&js_code)
    } else {
        js_code
    };

    Ok(MdxOutput {
        code: js_code,
        frontmatter_json,
        headings,
    })
}

/// Rewrites task list items to wrap checkbox inputs in `<label>` and text in `<span>`.
///
/// mdxjs-rs produces task list items like:
/// ```text
/// _jsxs(_components.li, { className: "task-list-item", children: [
///     _jsx(_components.input, { type: "checkbox", disabled: true }), " ", "Text"
/// ]})
/// ```
///
/// This rewrites them to:
/// ```text
/// _jsx(_components.li, { className: "task-list-item", children:
///     _jsx("label", { children: [
///         _jsx(_components.input, { type: "checkbox", disabled: true }),
///         _jsx("span", { children: [" ", "Text"] })
///     ]})
/// })
/// ```
///
/// For loose lists (where items are wrapped in `<p>`), it replaces the `<p>` wrapper
/// with the `<label>` wrapper and adds `<span>` around the text content.
fn rewrite_task_list_items(code: &str) -> String {
    // Marker that identifies task list item children arrays
    let marker = "\"task-list-item\"";
    if !code.contains(marker) {
        return code.to_string();
    }

    let mut result = String::with_capacity(code.len() + 256);
    let mut remaining = code;

    while let Some(marker_pos) = remaining.find(marker) {
        // Output everything up to and including the marker
        let end_of_marker = marker_pos + marker.len();
        result.push_str(&remaining[..end_of_marker]);
        remaining = &remaining[end_of_marker..];

        // Now find the `children:` key that follows within the same props object.
        // Scope the search: track brace depth and abort if we leave the props object.
        let children_needle = b"children:";
        let mut scoped_offset = None;
        {
            let bytes = remaining.as_bytes();
            let mut depth = 0i32;
            let mut i = 0;
            while i < bytes.len() {
                match bytes[i] {
                    b'{' => depth += 1,
                    b'}' => {
                        if depth == 0 {
                            break; // left the props object without finding children
                        }
                        depth -= 1;
                    }
                    b'"' | b'\'' | b'`' => skip_js_string_literal(bytes, &mut i),
                    _ if depth >= 0
                        && i + children_needle.len() <= bytes.len()
                        && &bytes[i..i + children_needle.len()] == children_needle =>
                    {
                        scoped_offset = Some(i);
                        break;
                    }
                    _ => {}
                }
                i += 1;
            }
        }
        if let Some(children_offset) = scoped_offset {
            // Output everything up to "children:"
            result.push_str(&remaining[..children_offset]);
            remaining = &remaining[children_offset + "children:".len()..];

            // Skip whitespace after "children:"
            let trimmed = remaining.trim_start();
            let ws_len = remaining.len() - trimmed.len();
            result.push_str("children:");
            result.push_str(&remaining[..ws_len]);
            remaining = trimmed;

            if remaining.starts_with('[') {
                // Parse the children array to find its contents
                if let Some((array_content, after_array)) = extract_bracket_content(remaining) {
                    // Check if this is a loose list (contains _jsxs(_components.p or _jsxs("p"))
                    if array_content.contains("_jsxs(_components.p,")
                        || array_content.contains("_jsxs(\"p\",")
                    {
                        // Loose list: replace the <p> wrapper with <label> + <span>
                        result.push_str(&rewrite_loose_task_list_children(array_content));
                    } else {
                        // Tight list: wrap directly with <label> + <span>
                        result.push_str(&rewrite_tight_task_list_children(array_content));
                    }
                    remaining = after_array;
                } else {
                    // Couldn't parse, output as-is
                    result.push_str(remaining);
                    remaining = "";
                }
            }
            // else: children is not an array (single element), skip rewriting
        }
    }

    result.push_str(remaining);
    result
}

/// Advances `i` past a JS string literal (double-quoted, single-quoted, or template).
/// `i` must point at the opening quote character. On return `i` points at the closing quote.
#[inline]
fn skip_js_string_literal(bytes: &[u8], i: &mut usize) {
    let quote = bytes[*i];
    *i += 1;
    while *i < bytes.len() {
        if bytes[*i] == b'\\' {
            *i += 1; // skip escaped char
        } else if bytes[*i] == quote {
            return;
        }
        *i += 1;
    }
}

/// Extracts the content of a bracket-delimited section `[...]`.
/// Returns (inner_content, rest_after_closing_bracket).
fn extract_bracket_content(input: &str) -> Option<(&str, &str)> {
    if !input.starts_with('[') {
        return None;
    }

    let bytes = input.as_bytes();
    let mut depth = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&input[1..i], &input[i + 1..]));
                }
            }
            b'"' | b'\'' | b'`' => skip_js_string_literal(bytes, &mut i),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Finds the end of a balanced `_jsx(...)` or `_jsxs(...)` call starting at the given position.
/// `input` should start with `_jsx` or `_jsxs`. Returns the index past the closing `)`.
fn find_jsx_call_end(input: &str) -> Option<usize> {
    let paren_start = input.find('(')?;
    let bytes = input.as_bytes();
    let mut depth = 0;
    let mut i = paren_start;
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            b'"' | b'\'' | b'`' => skip_js_string_literal(bytes, &mut i),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Rewrites children of a tight task list item.
///
/// Input: the content inside `[...]` of the children array, e.g.:
/// ```text
/// _jsx(_components.input, { type: "checkbox", disabled: true }), " ", "Text"
/// ```
///
/// Output: a new expression wrapping in label + span:
/// ```text
/// _jsx("label", { children: [_jsx(_components.input, ...), _jsx("span", { children: [" ", "Text"] })] })
/// ```
fn rewrite_tight_task_list_children(content: &str) -> String {
    // Find the _jsx(_components.input, ...) call
    let input_patterns = ["_jsx(_components.input,", "_jsx(\"input\","];
    let mut input_call = None;
    let mut input_end = 0;

    for pattern in &input_patterns {
        if let Some(pos) = content.find(pattern) {
            // Find the end of this _jsx(...) call
            if let Some(end) = find_jsx_call_end(&content[pos..]) {
                input_call = Some(&content[pos..pos + end]);
                input_end = pos + end;
                break;
            }
        }
    }

    let Some(input_jsx) = input_call else {
        // No input found, return original bracketed
        return format!("[{}]", content);
    };

    // Everything after the input call is the text content (skip leading comma/whitespace)
    let after_input = content[input_end..].trim_start();
    let after_input = after_input.strip_prefix(',').unwrap_or(after_input);

    // Build the span children from remaining content
    let span_children = after_input.trim();

    format!(
        "_jsx(\"label\", {{ children: [{}, _jsx(\"span\", {{ children: [{}] }})] }})",
        input_jsx, span_children
    )
}

/// Rewrites children of a loose task list item (where items are wrapped in `<p>`).
///
/// Input: content inside `[...]`, e.g.:
/// ```text
/// "\n", _jsxs(_components.p, { children: [_jsx(_components.input, ...), " ", "Text"] }), "\n"
/// ```
///
/// Replaces the `_jsxs(_components.p, ...)` with `_jsx("label", ...)` containing span-wrapped text.
fn rewrite_loose_task_list_children(content: &str) -> String {
    // Find the _jsxs(_components.p, ...) or _jsxs("p", ...) call
    let p_patterns = ["_jsxs(_components.p,", "_jsxs(\"p\","];
    let mut p_start = None;
    let mut p_end = 0;

    for pattern in &p_patterns {
        if let Some(pos) = content.find(pattern)
            && let Some(end) = find_jsx_call_end(&content[pos..])
        {
            p_start = Some(pos);
            p_end = pos + end;
            break;
        }
    }

    let Some(p_pos) = p_start else {
        return format!("[{}]", content);
    };

    // Extract the p call content
    let p_call = &content[p_pos..p_end];

    // Find the children array inside the p call
    let children_key = "children:";
    let Some(children_offset) = p_call.find(children_key) else {
        return format!("[{}]", content);
    };

    let after_children = p_call[children_offset + children_key.len()..].trim_start();
    if !after_children.starts_with('[') {
        return format!("[{}]", content);
    }

    let Some((p_children_content, _)) = extract_bracket_content(after_children) else {
        return format!("[{}]", content);
    };

    // Now rewrite the p children the same way as tight list
    let label_call = rewrite_tight_task_list_children(p_children_content);

    // Replace the _jsxs(p, ...) with the label call in the original content
    let mut result = String::with_capacity(content.len() + 128);
    result.push('[');
    result.push_str(&content[..p_pos]);
    result.push_str(&label_call);
    result.push_str(&content[p_end..]);
    result.push(']');
    result
}

/// Rewrites JSX code block calls to HTML format for ExpressiveCode compatibility.
///
/// mdxjs-rs generates code blocks as:
/// ```text
/// _jsx(_components.pre, { children: _jsx(_components.code, { className: "language-sh", children: "..." }) })
/// ```
///
/// This function converts them to HTML format:
/// ```text
/// "<pre class=\"astro-code\" tabindex=\"0\"><code class=\"language-sh\">...</code></pre>"
/// ```
///
/// This allows the downstream ExpressiveCode transform to detect and process them.
fn rewrite_jsx_code_blocks(code: &str) -> String {
    let mut result = String::with_capacity(code.len());
    let mut chars = code.chars().peekable();
    // Match both _jsx(_components.pre and _jsx("pre" patterns
    let patterns = ["_jsx(_components.pre", "_jsx(\"pre\""];

    while let Some(c) = chars.next() {
        // Check for _jsx( pattern start
        if c == '_' {
            let mut potential_match = String::from(c);
            let mut temp_chars = chars.clone();

            // Collect characters to match against patterns
            let max_pattern_len = patterns.iter().map(|p| p.len()).max().unwrap_or(0);
            for _ in 1..max_pattern_len {
                if temp_chars.peek().is_some() {
                    potential_match.push(temp_chars.next().unwrap());
                } else {
                    break;
                }
            }

            // Check if we match any pattern
            let matched_pattern = patterns.iter().find(|&&p| potential_match.starts_with(p));

            if let Some(&pattern) = matched_pattern {
                // Save position before parse attempt so we can restore on failure
                let saved_chars = chars.clone();

                // Advance the main iterator to after the pattern
                for _ in 0..(pattern.len() - 1) {
                    chars.next();
                }

                // Try to parse the pre JSX call
                if let Some(html) = parse_pre_jsx_call(&mut chars) {
                    // Output as a quoted string for ExpressiveCode to process
                    result.push_str(&format!("\"{}\"", escape_html_for_js(&html)));
                } else {
                    // Failed to parse, restore position and output just the first char
                    // This preserves custom <pre> usage that doesn't match our pattern
                    chars = saved_chars;
                    result.push(c);
                }
            } else {
                result.push(c);
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Parses a _jsx("pre", ...) call and extracts the HTML representation.
/// The iterator should be positioned right after `_jsx("pre"`.
/// Returns the HTML string if successful.
fn parse_pre_jsx_call(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<String> {
    // Skip whitespace
    skip_whitespace(chars);

    // Expect comma
    if chars.next() != Some(',') {
        return None;
    }

    skip_whitespace(chars);

    // Expect opening brace for props object
    if chars.next() != Some('{') {
        return None;
    }

    // Parse props object, looking for children: _jsx("code", ...)
    let props_content = extract_balanced_braces(chars)?;

    // Skip whitespace after props
    skip_whitespace(chars);

    // Consume the closing ) of _jsx("pre", ...)
    if chars.peek() == Some(&')') {
        chars.next();
    }

    // Find children property with _jsx(_components.code, ...) or _jsx("code", ...)
    if let Some(code_call_start) = props_content.find("children:") {
        let after_children = &props_content[code_call_start + "children:".len()..];
        let trimmed = after_children.trim_start();

        // Try both patterns: _jsx(_components.code and _jsx("code"
        let code_patterns = ["_jsx(_components.code", "_jsx(\"code\""];
        for pattern in code_patterns {
            if let Some(code_jsx) = trimmed.strip_prefix(pattern) {
                // Parse the code JSX call
                let (lang, content) = parse_code_jsx_props(code_jsx)?;

                // Build plain HTML (will be escaped by caller)
                let lang_class = lang
                    .map(|l| format!(" class=\"language-{}\"", l))
                    .unwrap_or_default();
                return Some(format!(
                    "<pre class=\"astro-code\" tabindex=\"0\"><code{}>{}</code></pre>",
                    lang_class, content
                ));
            }
        }
    }

    None
}

/// Parses the props of a _jsx("code", ...) call.
/// Input should be positioned after `_jsx("code"`.
/// Returns (language, content) if successful.
fn parse_code_jsx_props(input: &str) -> Option<(Option<String>, String)> {
    let trimmed = input.trim_start();

    // Expect comma
    if !trimmed.starts_with(',') {
        return None;
    }
    let after_comma = trimmed[1..].trim_start();

    // Expect opening brace
    if !after_comma.starts_with('{') {
        return None;
    }

    // Find the props content between { and }
    let props = extract_balanced_braces_from_str(&after_comma[1..])?;

    let mut lang = None;

    // Parse className and children from props
    // This is simplified - handles common patterns

    // Look for className: "language-xxx"
    if let Some(class_idx) = props.find("className:") {
        let after_class = props[class_idx + "className:".len()..].trim_start();
        if after_class.starts_with('"')
            && let Some(class_value) = extract_js_string(after_class)
            && let Some(lang_part) = class_value.strip_prefix("language-")
        {
            lang = Some(lang_part.to_string());
        }
    }

    // Look for children: "..." or children: `...` or children: '...'
    if let Some(children_idx) = props.find("children:") {
        let after_children = props[children_idx + "children:".len()..].trim_start();

        // Handle double-quoted string literal
        if after_children.starts_with('"') {
            if let Some(value) = extract_js_string(after_children) {
                return Some((lang, value));
            }
        }
        // Handle template literal
        else if after_children.starts_with('`') {
            if let Some(value) = extract_template_literal(after_children) {
                return Some((lang, value));
            }
        }
        // Handle single-quoted string literal (common in mdxjs-rs output)
        else if after_children.starts_with('\'')
            && let Some(value) = extract_single_quoted_string(after_children)
        {
            return Some((lang, value));
        }
        // Children exists but not a string literal (dynamic) - abort rewrite
        return None;
    }

    // No children key found - safe to return empty (plain <code></code>)
    Some((lang, String::new()))
}

/// Extracts content between balanced braces from an iterator.
fn extract_balanced_braces(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<String> {
    let mut result = String::new();
    let mut depth = 1;

    while let Some(c) = chars.next() {
        match c {
            '{' => {
                depth += 1;
                result.push(c);
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(result);
                }
                result.push(c);
            }
            '"' => {
                result.push(c);
                // Handle string literal
                while let Some(sc) = chars.next() {
                    result.push(sc);
                    if sc == '\\' {
                        if let Some(esc) = chars.next() {
                            result.push(esc);
                        }
                    } else if sc == '"' {
                        break;
                    }
                }
            }
            '`' => {
                result.push(c);
                // Handle template literal
                while let Some(tc) = chars.next() {
                    result.push(tc);
                    if tc == '\\' {
                        if let Some(esc) = chars.next() {
                            result.push(esc);
                        }
                    } else if tc == '`' {
                        break;
                    }
                }
            }
            '\'' => {
                result.push(c);
                // Handle single-quoted string
                while let Some(sc) = chars.next() {
                    result.push(sc);
                    if sc == '\\' {
                        if let Some(esc) = chars.next() {
                            result.push(esc);
                        }
                    } else if sc == '\'' {
                        break;
                    }
                }
            }
            _ => result.push(c),
        }
    }

    None // Unbalanced
}

/// Extracts content between balanced braces from a string slice.
fn extract_balanced_braces_from_str(input: &str) -> Option<String> {
    let mut result = String::new();
    let mut chars = input.chars().peekable();
    let mut depth = 1;

    while let Some(c) = chars.next() {
        match c {
            '{' => {
                depth += 1;
                result.push(c);
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(result);
                }
                result.push(c);
            }
            '"' => {
                result.push(c);
                while let Some(sc) = chars.next() {
                    result.push(sc);
                    if sc == '\\' {
                        if let Some(esc) = chars.next() {
                            result.push(esc);
                        }
                    } else if sc == '"' {
                        break;
                    }
                }
            }
            '`' => {
                result.push(c);
                while let Some(tc) = chars.next() {
                    result.push(tc);
                    if tc == '\\' {
                        if let Some(esc) = chars.next() {
                            result.push(esc);
                        }
                    } else if tc == '`' {
                        break;
                    }
                }
            }
            '\'' => {
                result.push(c);
                while let Some(sc) = chars.next() {
                    result.push(sc);
                    if sc == '\\' {
                        if let Some(esc) = chars.next() {
                            result.push(esc);
                        }
                    } else if sc == '\'' {
                        break;
                    }
                }
            }
            _ => result.push(c),
        }
    }

    None
}

/// Extracts a JavaScript string literal value (double-quoted).
fn extract_js_string(input: &str) -> Option<String> {
    if !input.starts_with('"') {
        return None;
    }

    let mut result = String::new();
    let mut chars = input[1..].chars();

    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(esc) = chars.next() {
                match esc {
                    'n' => result.push('\n'),
                    't' => result.push('\t'),
                    'r' => result.push('\r'),
                    '\\' => result.push('\\'),
                    '"' => result.push('"'),
                    '\'' => result.push('\''),
                    _ => {
                        result.push('\\');
                        result.push(esc);
                    }
                }
            }
        } else if c == '"' {
            return Some(result);
        } else {
            result.push(c);
        }
    }

    None
}

/// Extracts a template literal value.
fn extract_template_literal(input: &str) -> Option<String> {
    if !input.starts_with('`') {
        return None;
    }

    let mut result = String::new();
    let mut chars = input[1..].chars();

    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(esc) = chars.next() {
                match esc {
                    'n' => result.push('\n'),
                    't' => result.push('\t'),
                    'r' => result.push('\r'),
                    '\\' => result.push('\\'),
                    '`' => result.push('`'),
                    _ => {
                        result.push('\\');
                        result.push(esc);
                    }
                }
            }
        } else if c == '`' {
            return Some(result);
        } else {
            result.push(c);
        }
    }

    None
}

/// Extracts a single-quoted JavaScript string literal value.
fn extract_single_quoted_string(input: &str) -> Option<String> {
    if !input.starts_with('\'') {
        return None;
    }

    let mut result = String::new();
    let mut chars = input[1..].chars();

    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(esc) = chars.next() {
                match esc {
                    'n' => result.push('\n'),
                    't' => result.push('\t'),
                    'r' => result.push('\r'),
                    '\\' => result.push('\\'),
                    '\'' => result.push('\''),
                    '"' => result.push('"'),
                    _ => {
                        result.push('\\');
                        result.push(esc);
                    }
                }
            }
        } else if c == '\'' {
            return Some(result);
        } else {
            result.push(c);
        }
    }

    None
}

/// Skips whitespace characters in the iterator.
fn skip_whitespace(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else {
            break;
        }
    }
}

/// Escapes a string for use inside a JavaScript string literal.
fn escape_html_for_js(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

/// Strips `{#custom-id}` suffixes from heading lines in the source.
///
/// MDX treats `{...}` as JSX expressions, so we need to remove `{#id}` from
/// heading lines before passing to mdxjs-rs. The IDs have already been extracted
/// by `extract_headings_from_source`.
fn strip_custom_ids_from_headings(source: &str) -> String {
    let mut result = String::with_capacity(source.len());
    let mut fence_state: Option<(char, usize)> = None;

    for line in source.lines() {
        // Track fenced code blocks
        let trimmed = line.trim();
        if let Some((marker, len)) = parse_fence_marker(trimmed) {
            if let Some((open_marker, open_len)) = fence_state {
                if marker == open_marker && len >= open_len {
                    fence_state = None;
                }
            } else {
                fence_state = Some((marker, len));
            }
            result.push_str(line);
            result.push('\n');
            continue;
        }

        if fence_state.is_some() || is_indented_code_block(line) || !trimmed.starts_with('#') {
            result.push_str(line);
            result.push('\n');
            continue;
        }

        // Check if this is a heading line with a custom id
        // Use parse_atx_heading which strips trailing ATX hashes before checking,
        // so `## Title {#my-id} ##` is correctly detected.
        let has_custom_id = parse_atx_heading(trimmed).is_some_and(|h| h.custom_id.is_some());
        if has_custom_id {
            // Remove the {#id} suffix from the line
            // Find the {# in the original line (preserving leading whitespace)
            if let Some(pos) = line.rfind("{#") {
                let before = line[..pos].trim_end();
                result.push_str(before);
            } else {
                result.push_str(line);
            }
        } else {
            result.push_str(line);
        }
        result.push('\n');
    }

    // Remove the trailing newline if the original source didn't end with one
    if !source.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

/// Checks if a line is an indented code block (4+ spaces or tab at start).
/// Per CommonMark spec, such lines are code blocks, not headings.
pub fn is_indented_code_block(line: &str) -> bool {
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
        let trimmed = line.trim();

        // Check for fence markers FIRST, even on indented lines.
        // Fenced code blocks can be indented (e.g., inside JSX/HTML elements like <TabItem>),
        // and we need to track them correctly to avoid misinterpreting headings.
        if let Some((marker, len)) = parse_fence_marker(trimmed) {
            if let Some((open_marker, open_len)) = fence_state {
                // Inside a code block - check if this closes it
                if marker == open_marker && len >= open_len {
                    fence_state = None;
                }
                // Note: if markers don't match, we stay inside the code block
            } else {
                // Not in a code block - this opens one
                fence_state = Some((marker, len));
            }
            continue;
        }

        // Inside a fenced code block - skip all lines (headings inside code blocks don't count)
        if fence_state.is_some() {
            continue;
        }

        // Skip indented code blocks (4+ spaces or tab) before parsing
        // Per CommonMark, these are code blocks and should not be parsed as headings
        // Note: This only applies to lines that are NOT fence markers (already handled above)
        if is_indented_code_block(line) {
            continue;
        }

        // Match ATX headings (# to ######)
        if let Some(heading_match) = parse_atx_heading(trimmed) {
            let slug = if let Some(ref custom_id) = heading_match.custom_id {
                slugger.reserve(custom_id);
                custom_id.clone()
            } else {
                slugger.next_slug(&heading_match.text)
            };
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
    custom_id: Option<String>,
}

/// Strips inline markdown formatting from text, leaving only plain text.
///
/// Handles:
/// - Bold: `**text**` or `__text__` → `text`
/// - Italic: `*text*` or `_text_` → `text`
///
/// - Decode common HTML entities in heading text.
///
/// Markdown sources may contain HTML entities like `&shy;`, `&amp;`, etc.
/// These need to be decoded before slugifying so that:
/// - `&shy;` (soft hyphen) is decoded to U+00AD, which slugify drops (non-alphanumeric)
/// - `&amp;` is decoded to `&`, matching github-slugger behavior
fn decode_html_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }

    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '&' {
            // Collect entity name until ';' or non-entity character
            let mut entity = String::new();
            let mut found_semicolon = false;
            let mut already_emitted = false;

            for next in chars.by_ref() {
                if next == ';' {
                    found_semicolon = true;
                    break;
                }
                if next.is_ascii_alphanumeric() || next == '#' {
                    entity.push(next);
                } else {
                    // Not a valid entity, emit the collected chars
                    result.push('&');
                    result.push_str(&entity);
                    result.push(next);
                    already_emitted = true;
                    break;
                }
                // Reasonable length limit for entity names
                if entity.len() > 10 {
                    result.push('&');
                    result.push_str(&entity);
                    already_emitted = true;
                    break;
                }
            }

            if already_emitted {
                continue;
            } else if found_semicolon {
                match entity.as_str() {
                    "shy" => result.push('\u{00AD}'), // soft hyphen (dropped by slugify)
                    "nbsp" => result.push(' '),       // non-breaking space → space
                    "amp" => result.push('&'),
                    "lt" => result.push('<'),
                    "gt" => result.push('>'),
                    "quot" => result.push('"'),
                    "apos" => result.push('\''),
                    "mdash" => result.push('\u{2014}'),
                    "ndash" => result.push('\u{2013}'),
                    "laquo" => result.push('\u{00AB}'),
                    "raquo" => result.push('\u{00BB}'),
                    "zwj" => result.push('\u{200D}'), // zero-width joiner
                    "zwnj" => result.push('\u{200C}'), // zero-width non-joiner
                    s if s.starts_with('#') => {
                        // Numeric character reference: &#123; or &#x1F;
                        let num_str = &s[1..];
                        let code_point = if num_str.starts_with('x') || num_str.starts_with('X') {
                            u32::from_str_radix(&num_str[1..], 16).ok()
                        } else {
                            num_str.parse::<u32>().ok()
                        };
                        if let Some(cp) = code_point {
                            if let Some(c) = char::from_u32(cp) {
                                result.push(c);
                            }
                        } else {
                            // Invalid numeric ref, keep as-is
                            result.push('&');
                            result.push_str(&entity);
                            result.push(';');
                        }
                    }
                    _ => {
                        // Unknown entity, keep as-is
                        result.push('&');
                        result.push_str(&entity);
                        result.push(';');
                    }
                }
            } else {
                // No semicolon found before end of string — emit as-is
                result.push('&');
                result.push_str(&entity);
            }
        } else {
            result.push(ch);
        }
    }

    result
}

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
                custom_id: None,
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

    // Extract {#custom-id} before stripping inline markdown
    let (text, custom_id) = extract_custom_id(text);

    Some(AtxHeading {
        depth,
        text: decode_html_entities(&strip_inline_markdown(text)),
        custom_id: custom_id.map(|s| s.to_string()),
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

    #[test]
    fn test_rewrite_jsx_code_blocks_simple() {
        // Simple code block with language
        let input = r#"_jsx("pre", { children: _jsx("code", { className: "language-sh", children: "npm install" }) })"#;
        let output = rewrite_jsx_code_blocks(input);
        // The output should be a JS string literal with escaped quotes
        assert!(
            output.contains(r#"<pre class=\"astro-code\""#),
            "Expected HTML pre tag, got: {}",
            output
        );
        assert!(
            output.contains(r#"class=\"language-sh\""#),
            "Expected language class, got: {}",
            output
        );
        assert!(
            output.contains("npm install"),
            "Expected code content, got: {}",
            output
        );
    }

    #[test]
    fn test_rewrite_jsx_code_blocks_no_language() {
        // Code block without language class
        let input = r#"_jsx("pre", { children: _jsx("code", { children: "plain code" }) })"#;
        let output = rewrite_jsx_code_blocks(input);
        assert!(
            output.contains(r#"<pre class=\"astro-code\""#),
            "Expected HTML pre tag, got: {}",
            output
        );
        assert!(
            output.contains("<code>plain code</code>"),
            "Expected code without language, got: {}",
            output
        );
    }

    #[test]
    fn test_rewrite_jsx_code_blocks_with_escapes() {
        // Code with escaped characters - input has escaped quotes
        let input = r#"_jsx("pre", { children: _jsx("code", { className: "language-js", children: "const x = \"hello\";" }) })"#;
        let output = rewrite_jsx_code_blocks(input);
        // The code content should preserve the quotes (escaped in the JS string output)
        assert!(
            output.contains(r#"const x = \"hello\";"#),
            "Expected escaped quotes in output, got: {}",
            output
        );
    }

    #[test]
    fn test_rewrite_jsx_code_blocks_preserves_other_content() {
        // Mixed content - should only transform code blocks
        let input = r#"_jsx("p", { children: "Hello" }); _jsx("pre", { children: _jsx("code", { children: "test" }) }); _jsx("div", {})"#;
        let output = rewrite_jsx_code_blocks(input);
        assert!(
            output.contains(r#"_jsx("p", { children: "Hello" })"#),
            "Should preserve other JSX, got: {}",
            output
        );
        assert!(
            output.contains(r#"<pre class=\"astro-code\""#),
            "Should transform pre/code, got: {}",
            output
        );
        assert!(
            output.contains(r#"_jsx("div", {})"#),
            "Should preserve other JSX, got: {}",
            output
        );
    }

    #[test]
    fn test_rewrite_jsx_code_blocks_nested_braces() {
        // Code content containing braces
        let input = r#"_jsx("pre", { children: _jsx("code", { className: "language-js", children: "function foo() { return {}; }" }) })"#;
        let output = rewrite_jsx_code_blocks(input);
        assert!(
            output.contains("function foo() { return {}; }"),
            "Expected code with braces, got: {}",
            output
        );
    }

    #[test]
    fn test_extract_js_string() {
        assert_eq!(extract_js_string(r#""hello""#), Some("hello".to_string()));
        assert_eq!(
            extract_js_string(r#""hello \"world\"""#),
            Some("hello \"world\"".to_string())
        );
        assert_eq!(
            extract_js_string(r#""line1\nline2""#),
            Some("line1\nline2".to_string())
        );
        assert_eq!(extract_js_string("not a string"), None);
    }

    #[test]
    fn test_extract_template_literal() {
        assert_eq!(
            extract_template_literal("`hello`"),
            Some("hello".to_string())
        );
        assert_eq!(
            extract_template_literal("`multi\nline`"),
            Some("multi\nline".to_string())
        );
        assert_eq!(extract_template_literal("not a template"), None);
    }

    #[test]
    fn test_compile_mdx_with_code_block() {
        // Test that code blocks in MDX are rewritten for ExpressiveCode
        // when rewrite_code_blocks is enabled
        let source = r#"---
title: Test
---

# Hello

```sh
npm install astro
```
"#;

        let options = MdxCompileOptions {
            rewrite_code_blocks: true,
            ..Default::default()
        };

        let result = compile_mdx(source, "test.mdx", Some(options));
        assert!(result.is_ok(), "Compilation failed: {:?}", result.err());

        let output = result.unwrap();
        // The compiled output should contain HTML-format code blocks
        // that ExpressiveCode can detect
        assert!(
            output.code.contains(r#"<pre class=\"astro-code\""#),
            "Expected HTML pre tag for ExpressiveCode, got: {}",
            output.code
        );
        assert!(
            output.code.contains(r#"class=\"language-sh\""#),
            "Expected language class, got: {}",
            output.code
        );
        assert!(
            output.code.contains("npm install astro"),
            "Expected code content, got: {}",
            output.code
        );
    }

    #[test]
    fn test_compile_mdx_with_directives() {
        // Test that directive syntax is rewritten to Aside tags before mdxjs-rs
        let source = r#"---
title: Test
---

# Hello

:::note[Important]
This is a note.
:::

:::caution
Be careful!
:::
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(result.is_ok(), "Compilation failed: {:?}", result.err());

        let output = result.unwrap();
        // The compiled output should contain Aside JSX components
        assert!(
            output.code.contains("Aside"),
            "Expected Aside component in output, got: {}",
            output.code
        );
        // Should have the directive marker attribute
        assert!(
            output.code.contains("data-mf-source"),
            "Expected data-mf-source attribute, got: {}",
            output.code
        );
    }

    #[test]
    fn test_compile_mdx_directive_in_code_block() {
        // Directives inside code blocks should NOT be rewritten
        let source = r#"---
title: Test
---

# Hello

```md
:::note
This should NOT be converted to an Aside.
:::
```
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(result.is_ok(), "Compilation failed: {:?}", result.err());

        let output = result.unwrap();
        // The compiled output should NOT contain Aside since the directive is in a code block
        assert!(
            !output.code.contains("data-mf-source"),
            "Should NOT convert directive inside code block, got: {}",
            output.code
        );
    }

    #[test]
    fn test_compile_mdx_task_list() {
        // Task lists (GFM extension) should produce checkbox inputs, not raw "[ ]" text
        let source = r#"
- [ ] Unchecked item
- [x] Checked item
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(result.is_ok(), "Compilation failed: {:?}", result.err());

        let output = result.unwrap();

        // Should NOT contain raw bracket text
        assert!(
            !output.code.contains("[ ] Unchecked"),
            "Should not contain raw '[ ]' text, got: {}",
            output.code
        );
        assert!(
            !output.code.contains("[x] Checked"),
            "Should not contain raw '[x]' text, got: {}",
            output.code
        );

        // Should contain task list class and checkbox input
        assert!(
            output.code.contains("task-list-item"),
            "Expected 'task-list-item' class in output, got: {}",
            output.code
        );
        assert!(
            output.code.contains("checkbox"),
            "Expected checkbox input in output, got: {}",
            output.code
        );

        // Should wrap checkbox in <label> and text in <span>
        assert!(
            output.code.contains("\"label\""),
            "Expected label wrapper in output, got: {}",
            output.code
        );
        assert!(
            output.code.contains("\"span\""),
            "Expected span wrapper in output, got: {}",
            output.code
        );
    }

    #[test]
    fn test_compile_mdx_task_list_loose() {
        // Loose task lists (blank lines between items) should also get label/span wrapping
        let source = r#"
- [ ] Unchecked item

- [x] Checked item
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(result.is_ok(), "Compilation failed: {:?}", result.err());

        let output = result.unwrap();

        assert!(
            output.code.contains("task-list-item"),
            "Expected 'task-list-item' class in output, got: {}",
            output.code
        );
        assert!(
            output.code.contains("\"label\""),
            "Expected label wrapper in loose list output, got: {}",
            output.code
        );
        assert!(
            output.code.contains("\"span\""),
            "Expected span wrapper in loose list output, got: {}",
            output.code
        );
        // The <p> wrapper should be replaced by <label>
        assert!(
            !output.code.contains("_jsxs(_components.p,"),
            "Should not contain <p> wrapper in task list items, got: {}",
            output.code
        );
    }

    #[test]
    fn test_custom_element_in_list_structure() {
        // Test if custom elements like <mf-aside> preserve list structure
        // compared to standard HTML elements like <aside> which break lists
        let source_custom = r#"
1. First

<mf-aside>test</mf-aside>

2. Second
"#;

        let source_standard = r#"
1. First

<aside>test</aside>

2. Second
"#;

        let result_custom = compile_mdx(source_custom, "test.mdx", None);
        let result_standard = compile_mdx(source_standard, "test.mdx", None);

        assert!(result_custom.is_ok(), "Custom element compilation failed");
        assert!(
            result_standard.is_ok(),
            "Standard element compilation failed"
        );

        let output_custom = result_custom.unwrap();
        let output_standard = result_standard.unwrap();

        // Log both outputs for analysis
        println!("Custom element output:\n{}", output_custom.code);
        println!("\nStandard element output:\n{}", output_standard.code);

        // Custom elements should NOT produce fragmented lists (start="2")
        // Standard HTML block elements like <aside> WILL produce fragmented lists
        let custom_has_start_2 = output_custom.code.contains(r#"start: "2""#)
            || output_custom.code.contains(r#"start: 2"#)
            || output_custom.code.contains("start={2}");
        let standard_has_start_2 = output_standard.code.contains(r#"start: "2""#)
            || output_standard.code.contains(r#"start: 2"#)
            || output_standard.code.contains("start={2}");

        println!("\nCustom has start=2: {}", custom_has_start_2);
        println!("Standard has start=2: {}", standard_has_start_2);
    }

    #[test]
    fn test_jsx_comment_in_list_structure() {
        // Test if JSX comments preserve list structure
        let source = r#"
1. First

{/* mf:directive:note|title=Important */}
Warning content here
{/* mf:/directive */}

2. Second
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(
            result.is_ok(),
            "JSX comment compilation failed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        println!("JSX comment output:\n{}", output.code);

        // Check if list is fragmented
        let has_start_2 = output.code.contains(r#"start: "2""#)
            || output.code.contains(r#"start: 2"#)
            || output.code.contains("start={2}");
        println!("\nJSX comment has start=2: {}", has_start_2);
    }

    #[test]
    fn test_jsx_wrapper_in_list() {
        // Test if putting JSX wrapper inline within the list preserves structure
        // by using the "loose list" markdown pattern where content belongs to list items
        let source = r#"
1. First step

   <Aside type="note">Warning content here</Aside>

2. Second step
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(
            result.is_ok(),
            "Inline JSX compilation failed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        println!("Inline JSX in list output:\n{}", output.code);

        // Check if list is fragmented
        let has_start_2 = output.code.contains(r#"start: "2""#)
            || output.code.contains(r#"start: 2"#)
            || output.code.contains("start={2}");
        println!("\nInline JSX has start=2: {}", has_start_2);
    }

    #[test]
    fn test_directive_in_list_preserves_structure() {
        // This is the key test case from the plan:
        // Directives inside numbered lists should NOT fragment the list
        let source = r#"
1. First step

:::caution
Warning text
:::

2. Second step
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(
            result.is_ok(),
            "Directive in list compilation failed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        println!("Directive in list output:\n{}", output.code);

        // The list should NOT be fragmented (no start="2")
        let has_fragmented_list = output.code.contains(r#"start: "2""#)
            || output.code.contains(r#"start: 2"#)
            || output.code.contains("start={2}");

        assert!(
            !has_fragmented_list,
            "List should NOT be fragmented. Output:\n{}",
            output.code
        );

        // Should have Aside component
        assert!(
            output.code.contains("Aside"),
            "Should contain Aside component. Output:\n{}",
            output.code
        );
    }

    #[test]
    fn test_steps_component_with_directive() {
        // Simulate the <Steps> component use case from the plan
        let source = r#"
<Steps>
1. First step

:::caution
Warning
:::

2. Second step
</Steps>
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(
            result.is_ok(),
            "Steps compilation failed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        println!("Steps with directive output:\n{}", output.code);

        // Should contain Steps component
        assert!(
            output.code.contains("Steps"),
            "Should contain Steps component"
        );

        // Should NOT have fragmented list with start="2"
        let has_fragmented_list = output.code.contains(r#"start: "2""#)
            || output.code.contains(r#"start: 2"#)
            || output.code.contains("start={2}");

        assert!(
            !has_fragmented_list,
            "List inside Steps should NOT be fragmented. Output:\n{}",
            output.code
        );
    }

    #[test]
    fn test_steps_component_with_indented_note_and_tip_directives() {
        // Real Starlight tutorial content often indents directives with 4 spaces
        // inside list items under <Steps>.
        let source = r#"
<Steps>
1. First step

    :::note
    A new Astro project can only be created in an empty folder.
    :::

2. Second step

    :::tip[Keyboard shortcut]
    Use Cmd+J to toggle the terminal.
    :::
</Steps>
"#;

        let result = compile_mdx(source, "test.mdx", None);
        assert!(
            result.is_ok(),
            "Steps with indented directives compilation failed: {:?}",
            result.err()
        );

        let output = result.unwrap();

        // Should convert directives to Aside components (not keep ::: markers)
        assert!(
            output.code.contains("Aside"),
            "Should contain Aside component. Output:\n{}",
            output.code
        );
        assert!(
            !output.code.contains(":::note"),
            "Raw note directive should not remain. Output:\n{}",
            output.code
        );
        assert!(
            !output.code.contains(":::tip"),
            "Raw tip directive should not remain. Output:\n{}",
            output.code
        );

        // List should stay intact (no split list start=2)
        let has_fragmented_list = output.code.contains(r#"start: "2""#)
            || output.code.contains(r#"start: 2"#)
            || output.code.contains("start={2}");
        assert!(
            !has_fragmented_list,
            "List inside Steps should NOT be fragmented. Output:\n{}",
            output.code
        );
    }

    #[test]
    fn test_custom_id_reserves_slug_for_dedup() {
        let source = "# Intro {#intro}\n\n## Intro\n";
        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].slug, "intro");
        assert_eq!(headings[1].slug, "intro-1");
    }

    #[test]
    fn test_custom_id_heading_extraction() {
        let source = r#"
# Title

## 共通データ型バリデーター {#common-data-type-validators}

### Another Section
"#;
        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0].text, "Title");
        assert_eq!(headings[0].slug, "title");
        assert_eq!(headings[1].text, "共通データ型バリデーター");
        assert_eq!(headings[1].slug, "common-data-type-validators");
        assert_eq!(headings[2].text, "Another Section");
        assert_eq!(headings[2].slug, "another-section");
    }

    #[test]
    fn test_custom_id_not_in_code_block() {
        let source = r#"
# Title

```
## Heading {#not-extracted}
```

## Real {#real-id}
"#;
        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].slug, "title");
        assert_eq!(headings[1].slug, "real-id");
        assert_eq!(headings[1].text, "Real");
    }

    #[test]
    fn test_parse_atx_heading_custom_id() {
        let heading = parse_atx_heading("## My Heading {#my-heading}").unwrap();
        assert_eq!(heading.depth, 2);
        assert_eq!(heading.text, "My Heading");
        assert_eq!(heading.custom_id.as_deref(), Some("my-heading"));
    }

    #[test]
    fn test_parse_atx_heading_no_custom_id() {
        let heading = parse_atx_heading("## My Heading").unwrap();
        assert_eq!(heading.text, "My Heading");
        assert_eq!(heading.custom_id, None);
    }

    #[test]
    fn test_strip_custom_ids_from_headings() {
        let source = "# Title\n\n## Section {#my-section}\n\nContent\n";
        let stripped = strip_custom_ids_from_headings(source);
        assert_eq!(stripped, "# Title\n\n## Section\n\nContent\n");
    }

    #[test]
    fn test_strip_custom_ids_preserves_code_blocks() {
        let source = "# Title\n\n```\n## Heading {#not-stripped}\n```\n\n## Real {#real-id}\n";
        let stripped = strip_custom_ids_from_headings(source);
        assert!(stripped.contains("## Heading {#not-stripped}"));
        assert!(!stripped.contains("{#real-id}"));
        assert!(stripped.contains("## Real"));
    }

    #[test]
    fn test_strip_custom_ids_preserves_indented_code_blocks() {
        let source = "# Title\n\n    # Heading {#foo}\n\nContent\n";
        let stripped = strip_custom_ids_from_headings(source);
        assert!(
            stripped.contains("    # Heading {#foo}"),
            "Indented code block line should not be stripped, got: {}",
            stripped
        );
    }

    #[test]
    fn test_strip_custom_ids_trailing_atx_hashes() {
        // `## Title {#my-id} ##` — trailing ATX hashes after the custom ID
        let source = "## Title {#my-id} ##\n";
        let stripped = strip_custom_ids_from_headings(source);
        assert!(
            !stripped.contains("{#my-id}"),
            "Custom ID should be stripped even with trailing ATX hashes, got: {}",
            stripped
        );
        assert!(
            stripped.contains("## Title"),
            "Heading prefix and title should remain, got: {}",
            stripped
        );
    }

    #[test]
    fn test_compile_mdx_with_custom_id_trailing_hashes() {
        // Integration test: trailing ATX hashes with custom ID should compile successfully
        let source = "---\ntitle: Test\n---\n\n## Title {#my-id} ##\n\nContent here.\n";
        let result = compile_mdx(source, "test.mdx", None);
        assert!(
            result.is_ok(),
            "Compilation should succeed with trailing ATX hashes and custom ID: {:?}",
            result.err()
        );

        let output = result.unwrap();
        assert_eq!(output.headings.len(), 1);
        assert_eq!(output.headings[0].slug, "my-id");
        assert_eq!(output.headings[0].text, "Title");
        assert!(
            !output.code.contains("{#my-id}"),
            "Custom ID syntax should be stripped from compiled output"
        );
    }

    #[test]
    fn test_compile_mdx_with_custom_id() {
        let source = r#"---
title: Test
---

# Hello

## 共通データ型 {#common-data-type-validators}

Content here.
"#;
        let result = compile_mdx(source, "test.mdx", None);
        assert!(result.is_ok(), "Compilation failed: {:?}", result.err());

        let output = result.unwrap();
        assert_eq!(output.headings.len(), 2);
        assert_eq!(output.headings[0].slug, "hello");
        assert_eq!(output.headings[1].slug, "common-data-type-validators");
        assert_eq!(output.headings[1].text, "共通データ型");
        // The {#...} should not appear in the compiled JS (would cause JSX parse error)
        assert!(
            !output.code.contains("{#common-data-type-validators}"),
            "Custom ID syntax should be stripped from compiled output"
        );
    }

    #[test]
    fn test_heading_after_indented_code_block_in_jsx() {
        // Regression test: fenced code blocks indented inside JSX (e.g. <TabItem>)
        // must be tracked correctly so headings after them are still extracted.
        let source = r#"
    ```ts title="src/middleware.ts"
    import { defineMiddleware } from 'astro:middleware';
    export const onRequest = defineMiddleware(async (context, next) => {
      return next();
    });
  ```
  </TabItem>
</Tabs>

### `locals`

Some text.

### `preferredLocale`
"#;
        let headings = extract_headings_from_source(source);

        assert_eq!(
            headings.len(),
            2,
            "Expected 2 headings, got {}",
            headings.len()
        );
        assert_eq!(headings[0].text, "locals");
        assert_eq!(headings[1].text, "preferredLocale");
    }

    #[test]
    fn test_html_entity_decoding_in_headings() {
        // HTML entities like &shy; should be decoded in heading text
        // so that slugify produces correct results
        let source = r#"
## Erweitern der Entwicklungs&shy;werkzeugleiste

Some text.

## Aktualisierungs&shy;anleitungen
"#;
        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 2);
        // &shy; decoded to U+00AD soft hyphen in text
        assert_eq!(
            headings[0].text,
            "Erweitern der Entwicklungs\u{00AD}werkzeugleiste"
        );
        assert_eq!(headings[1].text, "Aktualisierungs\u{00AD}anleitungen");
        // Slug should NOT contain "shy" — soft hyphen is stripped by slugify
        assert_eq!(headings[0].slug, "erweitern-der-entwicklungswerkzeugleiste");
        assert_eq!(headings[1].slug, "aktualisierungsanleitungen");
    }

    #[test]
    fn test_hindi_heading_slugs() {
        let source = r#"
## स्लॉट्स

Some text.

## सर्वर-प्रथम
"#;
        let headings = extract_headings_from_source(source);

        assert_eq!(headings.len(), 2);
        // Combining marks (halant, nukta) must be preserved in slugs
        assert_eq!(headings[0].slug, "स्लॉट्स");
        assert_eq!(headings[1].slug, "सर्वर-प्रथम");
    }

    #[test]
    fn test_decode_html_entities() {
        assert_eq!(decode_html_entities("no entities"), "no entities");
        assert_eq!(decode_html_entities("a&shy;b"), "a\u{00AD}b");
        assert_eq!(decode_html_entities("a&amp;b"), "a&b");
        assert_eq!(decode_html_entities("a&nbsp;b"), "a b");
        assert_eq!(decode_html_entities("a&#60;b"), "a<b");
        assert_eq!(decode_html_entities("a&#x3E;b"), "a>b");
        // Unknown entity kept as-is
        assert_eq!(decode_html_entities("a&unknown;b"), "a&unknown;b");
        // Lone ampersand
        assert_eq!(decode_html_entities("a & b"), "a & b");
    }
}
