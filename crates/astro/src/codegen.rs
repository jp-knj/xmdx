//! Code generation utilities for WASM and NAPI bindings.
//!
//! This module provides shared functionality for generating JavaScript/JSX code
//! from parsed markdown content, eliminating duplication between binding layers.

use crate::registry::defaults::default_starlight_registry;
use crate::renderer::mdast::RenderBlock;
use crate::{PropValue, RegistryConfig};
use std::fmt::Write as FmtWrite;

/// Converts a Rust string to a JavaScript string literal.
///
/// Uses JSON serialization to properly escape special characters.
///
/// # Examples
///
/// ```
/// use xmdx_astro::codegen::js_string_literal;
///
/// assert_eq!(js_string_literal("hello"), "\"hello\"");
/// assert_eq!(js_string_literal("say \"hi\""), "\"say \\\"hi\\\"\"");
/// ```
pub fn js_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Escapes a string for use inside a JavaScript string literal (without surrounding quotes).
///
/// Uses JSON serialization to properly escape special characters, then strips the quotes.
///
/// # Examples
///
/// ```
/// use xmdx_astro::codegen::escape_js_string_value;
///
/// assert_eq!(escape_js_string_value("hello"), "hello");
/// assert_eq!(escape_js_string_value("say \"hi\""), "say \\\"hi\\\"");
/// assert_eq!(escape_js_string_value("line1\nline2"), "line1\\nline2");
/// assert_eq!(escape_js_string_value("back\\slash"), "back\\\\slash");
/// ```
pub fn escape_js_string_value(value: &str) -> String {
    // Use serde_json for proper escaping, then strip the surrounding quotes
    let json = serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string());
    // Remove leading and trailing quotes added by serde_json
    json[1..json.len() - 1].to_string()
}

/// Checks if a string contains a PascalCase JSX tag (e.g., `<Card`, `<Aside`).
///
/// This is used to detect nested JSX components in slot content. When components
/// are present, the slot content must be embedded directly (not via `set:html`)
/// so that Astro processes them as components rather than raw HTML.
///
/// # Examples
///
/// ```
/// use xmdx_astro::codegen::has_pascal_case_tag;
///
/// assert!(has_pascal_case_tag("<Card>content</Card>"));
/// assert!(has_pascal_case_tag("<p><Aside>nested</Aside></p>"));
/// assert!(!has_pascal_case_tag("<p>plain html</p>"));
/// assert!(!has_pascal_case_tag("<div class=\"card\">no component</div>"));
/// // Uppercase HTML tags are NOT PascalCase components
/// assert!(!has_pascal_case_tag("<DIV>content</DIV>"));
/// assert!(!has_pascal_case_tag("<SVG viewBox=\"0 0 100 100\"></SVG>"));
/// ```
pub fn has_pascal_case_tag(s: &str) -> bool {
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len.saturating_sub(1) {
        // Look for < followed by uppercase letter
        if bytes[i] == b'<' && bytes[i + 1].is_ascii_uppercase() {
            // Scan the tag name to check if it contains any lowercase letter
            // PascalCase: has mixed case (e.g., <Card>, <MDXProvider>)
            // All-uppercase HTML: no lowercase (e.g., <DIV>, <SVG>)
            let mut j = i + 2;
            while j < len {
                let b = bytes[j];
                if b.is_ascii_lowercase() {
                    return true; // Found lowercase → PascalCase component
                }
                if !b.is_ascii_alphanumeric() && b != b'_' && b != b'-' {
                    break; // End of tag name (space, >, /, etc.)
                }
                j += 1;
            }
            // No lowercase found in this tag, continue searching
        }
        i += 1;
    }
    false
}

/// Converts HTML entities and literal ampersands to JSX expressions for safe embedding.
///
/// Converts HTML entities for safe JSX embedding with context-awareness.
///
/// When slot content with nested components is embedded directly in JSX,
/// HTML entities must be handled appropriately based on context:
///
/// 1. Text content: entities → JSX expressions (e.g., `&amp;` → `{"&"}`)
/// 2. Attribute values: entities stay as-is (browser interprets them)
/// 3. JSX expression attributes: curly braces decoded (e.g., `=&#123;` → `={`)
///
/// This context-aware approach prevents creating invalid JSX like:
///   `<a href="...?a=1{"&"}b=2">` (INVALID)
/// Instead keeping attribute values intact:
///   `<a href="...?a=1&amp;b=2">` (VALID)
///
/// # Examples
///
/// ```
/// use xmdx_astro::codegen::html_entities_to_jsx;
///
/// // Text content - entities are converted
/// assert_eq!(html_entities_to_jsx("&amp;"), "{\"&\"}");
/// assert_eq!(html_entities_to_jsx("&lt;button&gt;"), "{\"<\"}button{\">\"}");
/// assert_eq!(html_entities_to_jsx("A & B"), "A {\"&\"} B");
///
/// // Raw curly braces in text content - converted to JSX expressions
/// assert_eq!(html_entities_to_jsx("h1 { color: red }"), "h1 {\"{\"} color: red {\"}\"}" );
///
/// // Context-aware: entities in attribute values stay as-is
/// assert_eq!(
///     html_entities_to_jsx("<a href=\"?a=1&amp;b=2\">link</a>"),
///     "<a href=\"?a=1&amp;b=2\">link</a>"
/// );
/// ```
pub fn html_entities_to_jsx(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    let mut i = 0;
    let mut pre_depth: usize = 0;

    // First pass: Handle curly braces in JSX expression attribute contexts
    // =&#123; → ={ and &#125;> → }> etc.
    let preprocessed = preprocess_jsx_expression_braces(s);
    let bytes = preprocessed.as_bytes();
    let len = bytes.len();

    // Second pass: Context-aware entity conversion
    while i < len {
        // Check if we're entering a tag
        if bytes[i] == b'<' {
            // Find the end of the tag
            if let Some(tag_end) = find_tag_end(&bytes[i..]) {
                let tag_slice = &preprocessed[i..i + tag_end + 1];

                // Track <pre> depth
                let tag_lower = tag_slice.to_ascii_lowercase();
                if tag_lower.starts_with("<pre")
                    && (tag_slice.len() == 5 || !tag_slice.as_bytes()[4].is_ascii_alphanumeric())
                {
                    pre_depth += 1;
                } else if tag_lower.starts_with("</pre")
                    && (tag_slice.len() == 6 || !tag_slice.as_bytes()[5].is_ascii_alphanumeric())
                {
                    pre_depth = pre_depth.saturating_sub(1);
                }

                // Copy tag as-is (don't convert entities in attributes)
                result.push_str(tag_slice);
                i += tag_end + 1;
                continue;
            } else {
                // No closing >, append rest and break
                result.push_str(&preprocessed[i..]);
                break;
            }
        }

        // We're in text content - convert entities and special chars
        // Find the next tag start
        let text_end = bytes[i..]
            .iter()
            .position(|&b| b == b'<')
            .unwrap_or(len - i);
        let text_slice = &preprocessed[i..i + text_end];
        if pre_depth > 0 {
            // Inside <pre>, preserve entities as-is for correct browser rendering
            result.push_str(text_slice);
        } else {
            result.push_str(&convert_entities_in_text(text_slice));
        }
        i += text_end;
    }

    result
}

/// Preprocesses JSX expression curly braces in attribute contexts.
/// Converts `=&#123;` → `={` and `&#125;>` → `}>` etc.
fn preprocess_jsx_expression_braces(s: &str) -> String {
    s.replace("=&#123;", "={")
        // Replace longer pattern first to avoid partial matches
        .replace("&#125;/>", "}/>")
        .replace("&#125;>", "}>")
        .replace("&#125; ", "} ")
}

/// Finds the position of `>` that closes a tag, handling quoted attributes and JSX expressions.
fn find_tag_end(bytes: &[u8]) -> Option<usize> {
    let mut i = 1; // Skip the opening <
    let mut in_quote = false;
    let mut quote_char = b'"';
    let mut brace_depth = 0;

    while i < bytes.len() {
        let b = bytes[i];
        if in_quote {
            if brace_depth > 0 && b == b'\\' {
                // Skip escaped character in JSX string context
                i += 2;
                continue;
            } else if b == quote_char {
                in_quote = false;
            }
        } else if brace_depth > 0 {
            // Inside JSX expression - track nested braces and strings
            if b == b'{' {
                brace_depth += 1;
            } else if b == b'}' {
                brace_depth -= 1;
            } else if b == b'"' || b == b'\'' {
                in_quote = true;
                quote_char = b;
            }
        } else if b == b'"' || b == b'\'' {
            in_quote = true;
            quote_char = b;
        } else if b == b'{' {
            brace_depth = 1;
        } else if b == b'>' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Converts HTML entities and JSX-special characters in text content.
fn convert_entities_in_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len() * 2);
    let mut chars = text.char_indices().peekable();

    while let Some((i, c)) = chars.next() {
        match c {
            '&' => {
                let bytes = &text.as_bytes()[i..];
                // Try to match known entities first
                if let Some(entity_match) = try_match_entity_text(bytes) {
                    result.push_str(entity_match.replacement);
                    // Skip the remaining entity characters
                    for _ in 1..entity_match.len {
                        chars.next();
                    }
                    continue;
                }
                // Check if this looks like an unknown HTML entity
                if is_unknown_entity(bytes) {
                    // Unknown entity like &nbsp; - leave as-is
                    result.push('&');
                } else {
                    // Literal & not part of entity - convert to JSX expression
                    result.push_str("{\"&\"}");
                }
            }
            '{' => {
                // Raw { in text content - convert to JSX expression
                result.push_str("{\"{\"}");
            }
            '}' => {
                // Raw } in text content - convert to JSX expression
                result.push_str("{\"}\"}");
            }
            _ => {
                // Correctly handles multi-byte UTF-8 characters
                result.push(c);
            }
        }
    }

    result
}

/// Entity matching for text content context.
/// Converts curly brace entities to JSX expressions (not raw braces).
fn try_match_entity_text(bytes: &[u8]) -> Option<EntityMatch> {
    if bytes.is_empty() || bytes[0] != b'&' {
        return None;
    }

    // Named entities
    let named_entities: &[(&[u8], &str)] = &[
        (b"&amp;", "{\"&\"}"),
        (b"&AMP;", "{\"&\"}"),
        (b"&lt;", "{\"<\"}"),
        (b"&LT;", "{\"<\"}"),
        (b"&gt;", "{\">\"}"),
        (b"&GT;", "{\">\"}"),
        (b"&quot;", "{\"\\\"\"}"),
        (b"&QUOT;", "{\"\\\"\"}"),
        (b"&#39;", "{\"'\"}"),
        (b"&apos;", "{\"'\"}"),
        (b"&APOS;", "{\"'\"}"),
    ];

    for (pattern, replacement) in named_entities {
        if bytes.len() >= pattern.len() && bytes[..pattern.len()].eq_ignore_ascii_case(pattern) {
            return Some(EntityMatch {
                replacement,
                len: pattern.len(),
            });
        }
    }

    // Numeric entities - curly braces become JSX expressions in text content
    let numeric_entities: &[(&[u8], &str)] = &[
        (b"&#123;", "{\"{\"}"),   // { - JSX expression for text content
        (b"&#125;", "{\"}\"}"),   // } - JSX expression for text content
        (b"&#60;", "{\"<\"}"),    // <
        (b"&#62;", "{\">\"}"),    // >
        (b"&#38;", "{\"&\"}"),    // &
        (b"&#34;", "{\"\\\"\"}"), // "
        (b"&#10;", "\n"),         // newline
        (b"&#13;", ""),           // carriage return - remove
    ];

    for (pattern, replacement) in numeric_entities {
        if bytes.len() >= pattern.len() && bytes[..pattern.len()] == **pattern {
            return Some(EntityMatch {
                replacement,
                len: pattern.len(),
            });
        }
    }

    None
}

/// Checks if bytes starting at position 0 look like an unknown HTML entity.
/// Pattern: &[a-zA-Z#][a-zA-Z0-9]*;
fn is_unknown_entity(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes[0] != b'&' {
        return false;
    }
    if bytes.len() < 3 {
        return false; // Need at least &x;
    }

    let mut i = 1;
    // First char after & must be letter or #
    if !bytes[i].is_ascii_alphabetic() && bytes[i] != b'#' {
        return false;
    }
    i += 1;

    // Continue with alphanumeric chars until we hit ;
    while i < bytes.len() {
        if bytes[i] == b';' {
            return true; // Found valid entity pattern
        }
        if !bytes[i].is_ascii_alphanumeric() {
            return false; // Invalid char in entity name
        }
        i += 1;
    }

    false // No semicolon found
}

struct EntityMatch {
    replacement: &'static str,
    len: usize,
}

/// Result of directive mapping.
pub struct DirectiveMappingResult {
    /// The component tag name to use (e.g., "Aside" instead of "note").
    pub tag_name: String,
    /// Optional additional prop to add (e.g., `type="note"`).
    pub type_prop: Option<String>,
}

/// Escapes `{` and `}` so JSX text does not become expressions.
pub(crate) fn escape_jsx_braces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '{' => out.push_str("&#123;"),
            '}' => out.push_str("&#125;"),
            _ => out.push(c),
        }
    }
    out
}

/// Escapes code text for HTML output (including JSX braces and newlines).
fn escape_code_text_for_html(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '&' => result.push_str("&amp;"),
            '`' => result.push_str("&#96;"),
            '{' => result.push_str("&#123;"),
            '}' => result.push_str("&#125;"),
            '\n' => result.push_str("&#10;"),
            _ => result.push(c),
        }
    }
    result
}

/// Escapes HTML attribute values for safe output.
fn escape_attr_value_for_html(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&#39;"),
            _ => result.push(c),
        }
    }
    result
}

/// Converts slot children (Vec<RenderBlock>) to an HTML string.
///
/// This recursively converts structured blocks back to HTML for use
/// in slot content where HTML string is expected.
fn slot_children_to_html(blocks: &[RenderBlock]) -> String {
    let mut result = String::new();
    for block in blocks {
        match block {
            RenderBlock::Html { content } => {
                // Escape braces so JSX text does not become expressions
                result.push_str(&escape_jsx_braces(content));
            }
            RenderBlock::Code { code, lang, .. } => {
                // Render code block as HTML
                result.push_str(r#"<pre class="astro-code" tabindex="0">"#);
                if let Some(l) = lang {
                    let escaped_lang = escape_attr_value_for_html(l);
                    result.push_str(&format!(r#"<code class="language-{}">"#, escaped_lang));
                } else {
                    result.push_str("<code>");
                }
                result.push_str(&escape_code_text_for_html(code));
                result.push_str("</code></pre>");
            }
            RenderBlock::Component {
                name,
                props,
                slot_children,
            } => {
                let slot_html = slot_children_to_html(slot_children);

                // Fragment-with-slot: render as <span style="display:contents" slot="name">
                // so Astro's slot distribution works (Fragment VNodes are unwrapped,
                // losing the slot prop).
                let is_fragment_slot = name == "Fragment" && props.contains_key("slot");

                let slot_html = if name == "Fragment" && !is_fragment_slot {
                    escape_jsx_braces(&slot_html)
                } else {
                    slot_html
                };

                let tag = if is_fragment_slot {
                    "span"
                } else {
                    name.as_str()
                };

                // Render nested components as JSX with props preserved
                result.push('<');
                result.push_str(tag);

                // For Fragment-with-slot, add display:contents style
                if is_fragment_slot {
                    result.push_str(" style=\"display:contents\"");
                }

                for (key, prop_value) in props {
                    result.push(' ');
                    result.push_str(key);

                    // For 'slot' attribute, use HTML attribute syntax
                    if key == "slot"
                        && let PropValue::Literal { value } = prop_value
                    {
                        result.push_str("=\"");
                        result.push_str(value);
                        result.push('"');
                        continue;
                    }

                    result.push_str("={");
                    match prop_value {
                        PropValue::Literal { value } => {
                            result.push('"');
                            result.push_str(&escape_js_string_value(value));
                            result.push('"');
                        }
                        PropValue::Expression { value } => {
                            result.push_str(value);
                        }
                    }
                    result.push('}');
                }

                result.push('>');
                result.push_str(&slot_html);
                result.push_str("</");
                result.push_str(tag);
                result.push('>');
            }
        }
    }
    result
}

/// Converts RenderBlocks to a JSX string.
///
/// # Arguments
///
/// * `blocks` - The render blocks to convert
/// * `directive_mapper` - Optional closure that maps directive names to component names
///   and optionally adds a type prop. If None, directive names are used as-is.
///
/// # Example
///
/// ```
/// use xmdx_astro::codegen::{blocks_to_jsx_string, DirectiveMappingResult};
/// use xmdx_astro::RenderBlock;
///
/// let blocks = vec![RenderBlock::Html {
///     content: "<p>Hello</p>".to_string(),
/// }];
///
/// // Without directive mapping - HTML blocks use Fragment with set:html
/// let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);
/// assert_eq!(jsx, "<_Fragment set:html={\"<p>Hello</p>\"} />");
/// ```
pub fn blocks_to_jsx_string<F>(blocks: &[RenderBlock], directive_mapper: Option<F>) -> String
where
    F: Fn(&str) -> Option<DirectiveMappingResult>,
{
    blocks_to_jsx_string_with_registry(blocks, directive_mapper, None)
}

/// Converts RenderBlocks to a JSX string with registry-based slot normalization.
///
/// # Arguments
///
/// * `blocks` - The render blocks to convert
/// * `directive_mapper` - Optional closure that maps directive names to component names
/// * `registry` - Optional registry for slot normalization rules. If None, uses default Starlight registry.
pub fn blocks_to_jsx_string_with_registry<F>(
    blocks: &[RenderBlock],
    directive_mapper: Option<F>,
    registry: Option<&RegistryConfig>,
) -> String
where
    F: Fn(&str) -> Option<DirectiveMappingResult>,
{
    // Use provided registry or default to Starlight
    let default_registry = default_starlight_registry();
    let registry = registry.unwrap_or(&default_registry);

    let mut result = String::new();
    for block in blocks {
        match block {
            RenderBlock::Html { content } => {
                emit_html_block(content, &mut result);
            }
            RenderBlock::Code { code, lang, .. } => {
                emit_code_block(code, lang.as_deref(), &mut result);
            }
            RenderBlock::Component {
                name,
                props,
                slot_children,
            } => {
                emit_component_block(
                    name,
                    props,
                    slot_children,
                    &directive_mapper,
                    registry,
                    &mut result,
                );
            }
        }
    }
    result
}

/// Emits an HTML render block as a Fragment with `set:html`.
fn emit_html_block(content: &str, result: &mut String) {
    result.push_str("<_Fragment set:html={");
    result.push_str(&js_string_literal(content));
    result.push_str("} />");
}

/// Emits a code render block as a `<pre><code>` Fragment with `set:html`.
fn emit_code_block(code: &str, lang: Option<&str>, result: &mut String) {
    let mut html = String::new();
    html.push_str(r#"<pre class="astro-code" tabindex="0">"#);
    if let Some(l) = lang {
        let escaped_lang = escape_attr_value_for_html(l);
        html.push_str(&format!(r#"<code class="language-{}">"#, escaped_lang));
    } else {
        html.push_str("<code>");
    }
    html.push_str(&escape_code_text_for_html(code));
    html.push_str("</code></pre>");
    result.push_str("<_Fragment set:html={");
    result.push_str(&js_string_literal(&html));
    result.push_str("} />");
}

/// Emits a component render block with props, slot content, and directive mapping.
fn emit_component_block<F>(
    name: &str,
    props: &std::collections::HashMap<String, PropValue>,
    slot_children: &[RenderBlock],
    directive_mapper: &Option<F>,
    registry: &RegistryConfig,
    result: &mut String,
) where
    F: Fn(&str) -> Option<DirectiveMappingResult>,
{
    // Separate Fragment-with-slot children from regular children.
    let (regular_children, fragment_slot_children) = partition_slot_children(slot_children);

    // Convert regular (non-fragment-slot) children to HTML string
    let regular_blocks: Vec<RenderBlock> = regular_children.into_iter().cloned().collect();
    let slot_html = slot_children_to_html(&regular_blocks);
    let slot_html = normalize_slot_by_registry(name, &slot_html, registry);

    // Apply directive mapping if provided
    let (tag_name, type_prop) = resolve_tag_name(name, directive_mapper);

    result.push('<');
    result.push_str(&tag_name);

    if let Some(type_value) = type_prop {
        result.push_str(" type=\"");
        result.push_str(&type_value);
        result.push('"');
    }

    emit_props(props, result);

    let has_any_content = !slot_html.is_empty() || !fragment_slot_children.is_empty();

    if !has_any_content {
        result.push_str(" />");
    } else {
        result.push('>');
        emit_slot_html(&slot_html, result);

        for (slot_name, inner_children) in &fragment_slot_children {
            emit_named_slot(slot_name, inner_children, result);
        }

        result.push_str("</");
        result.push_str(&tag_name);
        result.push('>');
    }
}

/// Partitions slot children into regular children and Fragment-with-slot children.
fn partition_slot_children(
    slot_children: &[RenderBlock],
) -> (Vec<&RenderBlock>, Vec<(&str, &[RenderBlock])>) {
    let mut regular: Vec<&RenderBlock> = Vec::new();
    let mut fragment_slots: Vec<(&str, &[RenderBlock])> = Vec::new();

    for child in slot_children {
        if let RenderBlock::Component {
            name: child_name,
            props: child_props,
            slot_children: inner,
        } = child
            && child_name == "Fragment"
            && let Some(PropValue::Literal { value: slot_name }) = child_props.get("slot")
        {
            fragment_slots.push((slot_name.as_str(), inner.as_slice()));
            continue;
        }
        regular.push(child);
    }

    (regular, fragment_slots)
}

/// Resolves the JSX tag name and optional type prop via directive mapping.
fn resolve_tag_name<F>(name: &str, directive_mapper: &Option<F>) -> (String, Option<String>)
where
    F: Fn(&str) -> Option<DirectiveMappingResult>,
{
    if let Some(mapper) = directive_mapper
        && let Some(mapping) = mapper(name)
    {
        return (mapping.tag_name, mapping.type_prop);
    }
    (name.to_string(), None)
}

/// Emits component props as a JSX spread object `{...{key: value, ...}}`.
fn emit_props(props: &std::collections::HashMap<String, PropValue>, result: &mut String) {
    if props.is_empty() {
        return;
    }
    result.push_str(" {...{");
    let mut first = true;
    for (key, prop_value) in props {
        if !first {
            result.push_str(", ");
        }
        first = false;
        result.push('"');
        result.push_str(&key.replace('"', "\\\""));
        result.push_str("\": ");

        match prop_value {
            PropValue::Literal { value } => {
                result.push('"');
                result.push_str(&escape_js_string_value(value));
                result.push('"');
            }
            PropValue::Expression { value } => {
                result.push_str(value);
            }
        }
    }
    result.push_str("}}");
}

/// Emits default slot HTML content, choosing between direct JSX or Fragment with `set:html`.
fn emit_slot_html(slot_html: &str, result: &mut String) {
    if slot_html.is_empty() {
        return;
    }
    if has_pascal_case_tag(slot_html) {
        result.push_str(&html_entities_to_jsx(slot_html));
    } else {
        result.push_str("<_Fragment set:html={");
        result.push_str(&js_string_literal(slot_html));
        result.push_str("} />");
    }
}

/// Emits a named slot as a `<span style="display:contents" slot="name">`.
fn emit_named_slot(slot_name: &str, inner_children: &[RenderBlock], result: &mut String) {
    let inner_html = slot_children_to_html(inner_children);
    result.push_str("<span style=\"display:contents\" slot=\"");
    result.push_str(slot_name);
    result.push_str("\">");
    if !inner_html.is_empty() {
        emit_slot_html(&inner_html, result);
    }
    result.push_str("</span>");
}

/// Applies slot normalization based on registry configuration.
///
/// This function looks up the component in the registry's slot_normalizations
/// and applies the appropriate transformation strategy.
fn normalize_slot_by_registry(
    component: &str,
    slot_html: &str,
    registry: &RegistryConfig,
) -> String {
    if let Some(normalization) = registry.get_slot_normalization(component) {
        match normalization.strategy.as_str() {
            "wrap_in_ol" => normalize_wrap_in_ol(slot_html),
            "wrap_in_ul" => normalize_wrap_in_ul(slot_html, normalization.wrapper_class.as_deref()),
            _ => slot_html.to_string(),
        }
    } else {
        slot_html.to_string()
    }
}

/// Normalizes slot content by wrapping in a single `<ol>` element.
///
/// This is used for components like Steps that require ordered list structure.
fn normalize_wrap_in_ol(slot_html: &str) -> String {
    let trimmed = slot_html.trim();

    // If it is already a single <ol> ... </ol> with no siblings, keep it.
    if trimmed.starts_with("<ol") && trimmed.ends_with("</ol>") {
        let first_ol = trimmed.find("<ol").unwrap_or(0);
        let last_close = trimmed.rfind("</ol>").unwrap_or(trimmed.len());
        let has_extra_ol = trimmed[first_ol + 3..last_close].contains("<ol");
        let trailing = trimmed[last_close + 5..].trim(); // 5 = len("</ol>")
        let leading = trimmed[..first_ol].trim();
        if !has_extra_ol && leading.is_empty() && trailing.is_empty() {
            return slot_html.to_string();
        }
    }

    // Otherwise, merge everything into a single ordered list.
    fn push_other_as_li(buf: &mut String, fragment: &str) {
        let frag = fragment.trim();
        if frag.is_empty() {
            return;
        }
        buf.push_str("<li>");
        buf.push_str(frag);
        buf.push_str("</li>");
    }

    let mut items = String::new();
    let mut rest = trimmed;

    while let Some(start) = rest.find("<ol") {
        let before = &rest[..start];
        push_other_as_li(&mut items, before);

        let after_ol = &rest[start..];
        if let Some(end_idx) = after_ol.find("</ol>") {
            let body_start = after_ol
                .find('>')
                .map(|i| i + 1)
                .unwrap_or_else(|| "<ol".len());
            let body = &after_ol[body_start..end_idx];
            items.push_str(body); // keep inner <li> list items as-is
            rest = &after_ol[end_idx + "</ol>".len()..];
        } else {
            // Malformed; wrap remainder
            push_other_as_li(&mut items, after_ol);
            rest = "";
            break;
        }
    }

    push_other_as_li(&mut items, rest);

    format!("<ol>{}</ol>", items)
}

/// Normalizes slot content by wrapping in a single `<ul>` element.
///
/// This is used for components like FileTree that require unordered list structure.
fn normalize_wrap_in_ul(slot_html: &str, wrapper_class: Option<&str>) -> String {
    let trimmed = slot_html.trim();
    let has_li = trimmed.contains("<li");

    let class_attr = wrapper_class
        .map(|c| format!(" class=\"{}\"", c))
        .unwrap_or_default();

    if trimmed.is_empty() {
        return format!("<ul{}><li></li></ul>", class_attr);
    }

    // If already wrapped in <ul>, check if we need to add li
    if trimmed.starts_with("<ul") && trimmed.ends_with("</ul>") {
        if has_li {
            // Already properly wrapped with li items, return unchanged
            // (Starlight FileTree component handles styling internally)
            return slot_html.to_string();
        }
        // Add empty li
        return format!(
            "<ul{}>{}<li></li></ul>",
            class_attr,
            &trimmed[trimmed.find('>').map(|i| i + 1).unwrap_or(3)..trimmed.len() - 5]
        );
    }

    if has_li {
        format!("<ul{}>{}</ul>", class_attr, slot_html)
    } else {
        format!("<ul{}><li>{}</li></ul>", class_attr, slot_html)
    }
}

/// Options for Astro module generation.
#[derive(Debug, Clone, Default)]
pub struct AstroModuleOptions<'a> {
    /// The JSX content to embed in the component.
    pub jsx: &'a str,
    /// Hoisted import statements.
    pub hoisted_imports: &'a [String],
    /// Hoisted export statements (non-default).
    pub hoisted_exports: &'a [String],
    /// Serialized frontmatter as JSON.
    pub frontmatter_json: &'a str,
    /// Serialized headings as JSON.
    pub headings_json: &'a str,
    /// File path for the module.
    pub filepath: &'a str,
    /// URL for the module (None means `undefined`).
    pub url: Option<&'a str>,
    /// Layout import path (e.g., "../layouts/Base.astro").
    pub layout_import: Option<&'a str>,
    /// Whether the user provided their own `export default`.
    pub has_user_default_export: bool,
}

fn render_profile_snippet() -> &'static str {
    r#"const __markflowRenderProfileEnabled = typeof process !== 'undefined' && process.env?.MARKFLOW_RENDER_PROFILE === '1';
const __markflowRenderProfile = __markflowRenderProfileEnabled ? (() => {
  const key = '__markflowRenderProfile';
  const g = globalThis;
  const existing = g[key];
  if (existing) return existing;
  const profile = {
    totals: new Map(),
    counts: new Map(),
    hooked: false,
    dumped: false,
    top: Number((typeof process !== 'undefined' && process.env?.MARKFLOW_RENDER_PROFILE_TOP) ? process.env.MARKFLOW_RENDER_PROFILE_TOP : '20'),
  };
  g[key] = profile;
  if (typeof process !== 'undefined' && typeof process.on === 'function' && !profile.hooked) {
    profile.hooked = true;
    const dump = () => {
      if (profile.dumped) return;
      profile.dumped = true;
      const entries = Array.from(profile.totals.entries()).map(([id, total]) => {
        const count = profile.counts.get(id) ?? 0;
        return { id, total, count, avg: count > 0 ? total / count : 0 };
      });
      entries.sort((a, b) => b.total - a.total);
      const top = entries.slice(0, profile.top);
      const total = entries.reduce((acc, entry) => acc + entry.total, 0);
      console.log(`[markflow-render-profiler] total=${total.toFixed(2)}ms pages=${entries.length}`);
      for (const entry of top) {
        console.log(`[markflow-render-profiler] ${entry.id} total=${entry.total.toFixed(2)}ms avg=${entry.avg.toFixed(2)}ms n=${entry.count}`);
      }
    };
    process.on('beforeExit', dump);
    process.on('exit', dump);
  }
  return profile;
})() : null;
const __markflowRenderTotals = __markflowRenderProfile ? __markflowRenderProfile.totals : null;
const __markflowRenderCounts = __markflowRenderProfile ? __markflowRenderProfile.counts : null;
const __markflowRenderNow = () => (globalThis.performance && typeof globalThis.performance.now === 'function') ? globalThis.performance.now() : Date.now();
"#
}

fn write_jsx_fragment(code: &mut String, jsx: &str, indent: &str) {
    let _ = writeln!(code, "{}<>", indent);
    code.push_str(jsx);
    if !jsx.ends_with('\n') {
        code.push('\n');
    }
    let _ = writeln!(code, "{}</>", indent);
}

/// Emits Astro runtime imports: Fragment, jsx, createComponent, renderJSX.
fn emit_runtime_imports(code: &mut String, options: &AstroModuleOptions<'_>) {
    let _ = writeln!(
        code,
        "import {{ Fragment, jsx as __jsx }} from 'astro/jsx-runtime';"
    );
    let _ = writeln!(code, "const _Fragment = Fragment;");
    let _ = writeln!(
        code,
        "const _jsx = (type, props, ...children) => {{\n  const resolved = props ?? {{}};\n  if (children.length > 0) {{\n    resolved.children = children.length === 1 ? children[0] : children;\n  }}\n  return __jsx(type, resolved, resolved.key);\n}};"
    );
    let _ = writeln!(
        code,
        "import {{ createComponent, renderJSX }} from 'astro/runtime/server/index.js';"
    );

    if let Some(layout) = options.layout_import {
        let _ = writeln!(code, "import Layout from {};", js_string_literal(layout));
    }

    for import in options.hoisted_imports {
        let _ = writeln!(code, "{}", import);
    }

    for export in options.hoisted_exports {
        let _ = writeln!(code, "{}", export);
    }
}

/// Emits standard Astro exports (frontmatter, file, url, headings).
fn emit_astro_exports(code: &mut String, options: &AstroModuleOptions<'_>) {
    let _ = writeln!(
        code,
        "export const frontmatter = {};",
        options.frontmatter_json
    );
    let _ = writeln!(
        code,
        "export const file = {};",
        js_string_literal(options.filepath)
    );
    let url_literal = options
        .url
        .map(js_string_literal)
        .unwrap_or_else(|| "undefined".to_string());
    let _ = writeln!(code, "export const url = {};", url_literal);
    let _ = writeln!(code, "export const headings = {};", options.headings_json);
    let _ = writeln!(code, "export function getHeadings() {{");
    let _ = writeln!(code, "  return {};", options.headings_json);
    let _ = writeln!(code, "}}");
}

/// Emits the xmdxContent component with optional render profiling.
fn emit_xmdx_content(code: &mut String, options: &AstroModuleOptions<'_>) {
    code.push_str(render_profile_snippet());

    let _ = writeln!(code, "// function xmdxContent");
    let _ = writeln!(
        code,
        "const xmdxContent = createComponent((result, props) => {{"
    );
    let _ = writeln!(code, "  if (__markflowRenderProfileEnabled) {{");
    let _ = writeln!(code, "    const __markflowStart = __markflowRenderNow();");
    let _ = writeln!(code, "    const __markflowOut = renderJSX(result, (");
    write_jsx_fragment(code, options.jsx, "    ");
    let _ = writeln!(code, "    ));");
    let _ = writeln!(
        code,
        "    const __markflowDuration = __markflowRenderNow() - __markflowStart;"
    );
    let _ = writeln!(
        code,
        "    __markflowRenderTotals.set(file, (__markflowRenderTotals.get(file) ?? 0) + __markflowDuration);"
    );
    let _ = writeln!(
        code,
        "    __markflowRenderCounts.set(file, (__markflowRenderCounts.get(file) ?? 0) + 1);"
    );
    let _ = writeln!(code, "    return __markflowOut;");
    let _ = writeln!(code, "  }}");
    let _ = writeln!(code, "  return renderJSX(result, (");
    write_jsx_fragment(code, options.jsx, "    ");
    let _ = writeln!(code, "  ));");
    let _ = writeln!(code, "}}, file);");

    let _ = writeln!(code, "export const Content = xmdxContent;");

    // Add MDX component markers for Astro Content Collections
    let _ = writeln!(code, "Content[Symbol.for('mdx-component')] = true;");
    let _ = writeln!(
        code,
        "Content[Symbol.for('astro.needsHeadRendering')] = !Boolean(frontmatter.layout);"
    );
    let _ = writeln!(
        code,
        "Content.moduleId = {};",
        js_string_literal(options.filepath)
    );
}

/// Emits the default export (unless the user provided their own).
fn emit_default_export(code: &mut String, options: &AstroModuleOptions<'_>) {
    if !options.has_user_default_export {
        if options.layout_import.is_some() {
            let _ = writeln!(
                code,
                "export default createComponent((result, props) => renderJSX(result, _jsx(Layout, {{...props, frontmatter: frontmatter, children: _jsx(xmdxContent, {{...props}})}})), file);"
            );
        } else {
            let _ = writeln!(code, "export default xmdxContent;");
        }
    }
}

/// Generates an Astro-compatible JavaScript module from the given options.
///
/// This produces a complete module with:
/// - Runtime imports (Fragment, jsx, createComponent, renderJSX)
/// - Hoisted user imports
/// - Frontmatter, file, url, headings exports
/// - xmdxContent component
/// - MDX component markers for Astro Content Collections
/// - Default export (unless user provided one)
pub fn generate_astro_module(options: &AstroModuleOptions<'_>) -> String {
    let mut code = String::new();
    emit_runtime_imports(&mut code, options);
    emit_astro_exports(&mut code, options);
    emit_xmdx_content(&mut code, options);
    emit_default_export(&mut code, options);
    code
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_js_string_literal() {
        assert_eq!(js_string_literal("hello"), "\"hello\"");
        assert_eq!(js_string_literal("say \"hi\""), "\"say \\\"hi\\\"\"");
        assert_eq!(js_string_literal("line1\nline2"), "\"line1\\nline2\"");
        assert_eq!(js_string_literal("back\\slash"), "\"back\\\\slash\"");
    }

    #[test]
    fn test_has_pascal_case_tag() {
        // Should detect PascalCase tags
        assert!(has_pascal_case_tag("<Card>content</Card>"));
        assert!(has_pascal_case_tag("<Aside type=\"note\">text</Aside>"));
        assert!(has_pascal_case_tag("<p><NestedComponent /></p>"));
        assert!(has_pascal_case_tag("text <MyComponent> more"));

        // Should detect initialism/acronym-prefixed PascalCase components
        assert!(has_pascal_case_tag("<MDXProvider>content</MDXProvider>"));
        assert!(has_pascal_case_tag("<URLTable />"));
        assert!(has_pascal_case_tag("<APIClient>nested</APIClient>"));
        assert!(has_pascal_case_tag("<XMLParser>data</XMLParser>"));
        assert!(has_pascal_case_tag("<HTMLRenderer />"));
        assert!(has_pascal_case_tag("<JSONViewer>content</JSONViewer>"));

        // Should NOT detect lowercase HTML tags
        assert!(!has_pascal_case_tag("<p>paragraph</p>"));
        assert!(!has_pascal_case_tag("<div class=\"card\">content</div>"));
        assert!(!has_pascal_case_tag("<span>inline</span>"));
        assert!(!has_pascal_case_tag("no tags at all"));
        assert!(!has_pascal_case_tag("")); // empty string

        // Should NOT detect uppercase HTML tags (not PascalCase)
        assert!(!has_pascal_case_tag("<DIV>content</DIV>"));
        assert!(!has_pascal_case_tag("<SVG viewBox=\"0 0 100 100\"></SVG>"));
        assert!(!has_pascal_case_tag("<A href=\"#\">link</A>"));
        assert!(!has_pascal_case_tag("<BR />"));
        assert!(!has_pascal_case_tag("<HTML><BODY></BODY></HTML>"));
    }

    #[test]
    fn test_escape_js_string_value() {
        // Basic escaping
        assert_eq!(escape_js_string_value("hello"), "hello");
        assert_eq!(escape_js_string_value("say \"hi\""), "say \\\"hi\\\"");
        assert_eq!(escape_js_string_value("line1\nline2"), "line1\\nline2");
        assert_eq!(escape_js_string_value("back\\slash"), "back\\\\slash");

        // CJK characters
        assert_eq!(escape_js_string_value("中文"), "中文");
        assert_eq!(escape_js_string_value("中文\"引用\""), "中文\\\"引用\\\"");
        assert_eq!(escape_js_string_value("한글"), "한글");

        // Special characters
        assert_eq!(escape_js_string_value("tab\there"), "tab\\there");
        assert_eq!(escape_js_string_value("return\rhere"), "return\\rhere");
    }

    #[test]
    fn test_blocks_to_jsx_string_cjk_props() {
        let mut props = HashMap::new();
        props.insert(
            "title".to_string(),
            PropValue::Literal {
                value: "中文\"引用\"标题".to_string(),
            },
        );
        let blocks = vec![RenderBlock::Component {
            name: "Card".to_string(),
            props,
            slot_children: vec![RenderBlock::Html {
                content: "<p>Content</p>".to_string(),
            }],
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);
        // Component slot content uses Fragment with set:html for proper <slot /> support
        // Note: slot_children_to_html escapes braces in Html blocks
        assert_eq!(
            jsx,
            "<Card {...{\"title\": \"中文\\\"引用\\\"标题\"}}><_Fragment set:html={\"<p>Content</p>\"} /></Card>"
        );
    }

    #[test]
    fn test_blocks_to_jsx_string_html_only() {
        let blocks = vec![RenderBlock::Html {
            content: "<p>Hello</p>".to_string(),
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);
        // HTML blocks are now wrapped in _Fragment with set:html
        assert_eq!(jsx, "<_Fragment set:html={\"<p>Hello</p>\"} />");
    }

    #[test]
    fn test_blocks_to_jsx_string_component() {
        let mut props = HashMap::new();
        props.insert(
            "title".to_string(),
            PropValue::Literal {
                value: "Hello".to_string(),
            },
        );
        let blocks = vec![RenderBlock::Component {
            name: "Card".to_string(),
            props,
            slot_children: vec![RenderBlock::Html {
                content: "<p>Content</p>".to_string(),
            }],
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);
        // Component slot content uses _Fragment with set:html for proper <slot /> support
        assert_eq!(
            jsx,
            "<Card {...{\"title\": \"Hello\"}}><_Fragment set:html={\"<p>Content</p>\"} /></Card>"
        );
    }

    #[test]
    fn test_blocks_to_jsx_string_with_directive_mapper() {
        let mut props = HashMap::new();
        props.insert(
            "title".to_string(),
            PropValue::Literal {
                value: "Important".to_string(),
            },
        );
        let blocks = vec![RenderBlock::Component {
            name: "note".to_string(),
            props,
            slot_children: vec![RenderBlock::Html {
                content: "<p>Content</p>".to_string(),
            }],
        }];

        let mapper = |name: &str| -> Option<DirectiveMappingResult> {
            match name {
                "note" | "tip" | "caution" | "danger" => Some(DirectiveMappingResult {
                    tag_name: "Aside".to_string(),
                    type_prop: Some(name.to_string()),
                }),
                _ => None,
            }
        };

        let jsx = blocks_to_jsx_string(&blocks, Some(mapper));
        // Component slot content uses _Fragment with set:html for proper <slot /> support
        assert_eq!(
            jsx,
            "<Aside type=\"note\" {...{\"title\": \"Important\"}}><_Fragment set:html={\"<p>Content</p>\"} /></Aside>"
        );
    }

    #[test]
    fn test_blocks_to_jsx_string_nested_components() {
        // When slot contains nested JSX components (PascalCase tags),
        // they should be embedded directly, not wrapped in set:html
        let blocks = vec![RenderBlock::Component {
            name: "CardGrid".to_string(),
            props: HashMap::new(),
            slot_children: vec![RenderBlock::Html {
                content: "<Card title=\"First\"><p>Content 1</p></Card><Card title=\"Second\"><p>Content 2</p></Card>".to_string(),
            }],
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);
        // Nested components should be embedded directly (no set:html)
        assert_eq!(
            jsx,
            "<CardGrid><Card title=\"First\"><p>Content 1</p></Card><Card title=\"Second\"><p>Content 2</p></Card></CardGrid>"
        );
    }

    #[test]
    fn test_blocks_to_jsx_string_mixed_html_and_components() {
        // When slot contains a mix of HTML and components, embed directly
        let blocks = vec![RenderBlock::Component {
            name: "Wrapper".to_string(),
            props: HashMap::new(),
            slot_children: vec![RenderBlock::Html {
                content: "<p>Before</p><NestedComponent /><p>After</p>".to_string(),
            }],
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);
        // Should embed directly because there's a PascalCase component
        assert_eq!(
            jsx,
            "<Wrapper><p>Before</p><NestedComponent /><p>After</p></Wrapper>"
        );
    }

    #[test]
    fn test_html_entities_to_jsx() {
        // Basic entity conversion to JSX expressions (text content)
        assert_eq!(html_entities_to_jsx("&amp;"), "{\"&\"}");
        assert_eq!(
            html_entities_to_jsx("&lt;button&gt;"),
            "{\"<\"}button{\">\"}"
        );
        assert_eq!(html_entities_to_jsx("a &amp;&amp; b"), "a {\"&\"}{\"&\"} b");
        assert_eq!(html_entities_to_jsx("no entities"), "no entities");
        assert_eq!(html_entities_to_jsx(""), "");

        // Quote entities
        assert_eq!(
            html_entities_to_jsx("&quot;hello&quot;"),
            "{\"\\\"\"}hello{\"\\\"\"}"
        );
        assert_eq!(
            html_entities_to_jsx("&#39;single&#39;"),
            "{\"'\"}single{\"'\"}"
        );
        assert_eq!(
            html_entities_to_jsx("&apos;apos&apos;"),
            "{\"'\"}apos{\"'\"}"
        );

        // Mixed entities - results in JSX expressions
        assert_eq!(
            html_entities_to_jsx("a &lt; b &amp;&amp; c &gt; d"),
            "a {\"<\"} b {\"&\"}{\"&\"} c {\">\"} d"
        );

        // Code with HTML tag entities - entities converted in text content
        assert_eq!(
            html_entities_to_jsx("<code>&lt;button&gt;</code>"),
            "<code>{\"<\"}button{\">\"}</code>"
        );

        // Literal & characters (not part of entities) should also be converted
        assert_eq!(html_entities_to_jsx("A & B"), "A {\"&\"} B");
        assert_eq!(html_entities_to_jsx("foo&bar"), "foo{\"&\"}bar");
        assert_eq!(html_entities_to_jsx("&"), "{\"&\"}");
        assert_eq!(html_entities_to_jsx("a & b & c"), "a {\"&\"} b {\"&\"} c");

        // Unknown entities should be left as-is
        assert_eq!(html_entities_to_jsx("&unknown;"), "&unknown;");
        assert_eq!(html_entities_to_jsx("&nbsp;"), "&nbsp;");

        // Context-aware: entities in attribute values should NOT be converted
        assert_eq!(
            html_entities_to_jsx("<a href=\"https://example.com?a=1&amp;b=2\">link</a>"),
            "<a href=\"https://example.com?a=1&amp;b=2\">link</a>"
        );

        // Raw curly braces in text content should be converted to JSX expressions
        assert_eq!(
            html_entities_to_jsx("h1 { color: red }"),
            "h1 {\"{\"} color: red {\"}\"}"
        );

        // Curly brace entities in text content should become JSX expressions
        assert_eq!(html_entities_to_jsx("&#123;&#125;"), "{\"{\"}{\"}\"}");

        // UTF-8 multibyte characters (CJK, emoji) should be preserved correctly
        assert_eq!(html_entities_to_jsx("日本語テキスト"), "日本語テキスト");
        assert_eq!(html_entities_to_jsx("Hello 世界!"), "Hello 世界!");
        assert_eq!(html_entities_to_jsx("Emoji: 🎉🚀"), "Emoji: 🎉🚀");
        assert_eq!(
            html_entities_to_jsx("中文 &amp; 日本語"),
            "中文 {\"&\"} 日本語"
        );
        assert_eq!(
            html_entities_to_jsx("<p>こんにちは &lt;world&gt;</p>"),
            "<p>こんにちは {\"<\"}world{\">\"}</p>"
        );

        // Entities inside <pre> should be preserved (not converted to JSX)
        assert_eq!(
            html_entities_to_jsx("<Comp><pre><code>&lt;html&gt;</code></pre></Comp>"),
            "<Comp><pre><code>&lt;html&gt;</code></pre></Comp>"
        );

        // Entities outside <pre> still converted, inside preserved
        assert_eq!(
            html_entities_to_jsx("<p>&lt;b&gt;</p><pre>&lt;b&gt;</pre><p>&lt;b&gt;</p>"),
            "<p>{\"<\"}b{\">\"}</p><pre>&lt;b&gt;</pre><p>{\"<\"}b{\">\"}</p>"
        );

        // Nested <pre> tags
        assert_eq!(
            html_entities_to_jsx("<pre><pre>&amp;</pre></pre>"),
            "<pre><pre>&amp;</pre></pre>"
        );
    }

    #[test]
    fn test_blocks_to_jsx_string_nested_components_with_entities() {
        // When slot contains nested components AND HTML entities,
        // entities become JSX expressions so they render as text, not markup
        let blocks = vec![RenderBlock::Component {
            name: "Card".to_string(),
            props: HashMap::new(),
            slot_children: vec![RenderBlock::Html {
                content: "<Badge>a &lt; b &amp;&amp; c</Badge>".to_string(),
            }],
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);
        // Entities should become JSX expressions: &lt; becomes {"<"}, &amp; becomes {"&"}
        assert_eq!(
            jsx,
            "<Card><Badge>a {\"<\"} b {\"&\"}{\"&\"} c</Badge></Card>"
        );
    }

    #[test]
    fn test_blocks_to_jsx_string_preserves_jsx_expressions() {
        // JSX expressions like {title} or {items.map(...)} should be preserved
        let blocks = vec![RenderBlock::Component {
            name: "CardGrid".to_string(),
            props: HashMap::new(),
            slot_children: vec![RenderBlock::Component {
                name: "Card".to_string(),
                props: {
                    let mut p = HashMap::new();
                    p.insert(
                        "title".to_string(),
                        PropValue::Expression {
                            value: "title".to_string(),
                        },
                    );
                    p
                },
                slot_children: vec![RenderBlock::Html {
                    content: "Content".to_string(),
                }],
            }],
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);
        // JSX expressions should NOT be escaped
        assert!(jsx.contains("title={title}"));
        assert!(!jsx.contains("{'{'}"));
        assert_eq!(
            jsx,
            "<CardGrid><Card title={title}>Content</Card></CardGrid>"
        );
    }

    #[test]
    fn test_html_entities_to_jsx_self_closing_tag() {
        // Regression test for: self-closing tags with expression attributes
        // The fix ensures &#125;/> (}/>) is matched before &#125;> (}>)
        // to avoid producing invalid JSX like <Card title={foo}>/
        assert_eq!(
            html_entities_to_jsx("<Card title=&#123;foo&#125;/>"),
            "<Card title={foo}/>"
        );
        assert_eq!(
            html_entities_to_jsx("<Button onClick=&#123;handler&#125; />"),
            "<Button onClick={handler} />"
        );
        // Multiple expression attributes on self-closing tag
        assert_eq!(
            html_entities_to_jsx("<Input value=&#123;val&#125; onChange=&#123;fn&#125;/>"),
            "<Input value={val} onChange={fn}/>"
        );
        // Non-self-closing tags should still work
        assert_eq!(
            html_entities_to_jsx("<Card title=&#123;foo&#125;>content</Card>"),
            "<Card title={foo}>content</Card>"
        );
    }

    #[test]
    fn test_html_entities_to_jsx_unbalanced_braces_in_code_prop() {
        // Code block with unbalanced { in JSX expression prop
        let input = r#"<Code code={"if (x) {\n  console.log('hi');\n"} /><p>text with {astro}</p>"#;
        let result = html_entities_to_jsx(input);
        // The <Code> tag should be preserved, and {astro} in text should be escaped
        assert!(result.contains("<Code code="));
        assert!(result.contains(r#"{"{"}"#)); // {astro} → {"{"}astro{"}"}
    }

    #[test]
    fn test_html_entities_to_jsx_balanced_braces_in_code_prop() {
        let input = r#"<Code code={"import { foo } from 'bar';"} />"#;
        let result = html_entities_to_jsx(input);
        assert_eq!(result, input); // No text content, no changes needed
    }

    #[test]
    fn test_html_entities_to_jsx_escaped_quotes_in_code_prop() {
        // JSON string with escaped quotes
        let input = r#"<Code code={"say \"hello\""} />"#;
        let result = html_entities_to_jsx(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_generate_astro_module_basic() {
        let options = AstroModuleOptions {
            jsx: "<p>Hello</p>",
            hoisted_imports: &[],
            hoisted_exports: &[],
            frontmatter_json: "{}",
            headings_json: "[]",
            filepath: "/test.md",
            url: None,
            layout_import: None,
            has_user_default_export: false,
        };

        let code = generate_astro_module(&options);

        assert!(code.contains("import { Fragment, jsx as __jsx } from 'astro/jsx-runtime';"));
        assert!(code.contains("export const frontmatter = {};"));
        assert!(code.contains("export const file = \"/test.md\";"));
        assert!(code.contains("export const url = undefined;"));
        assert!(code.contains("<p>Hello</p>"));
        assert!(code.contains("export default xmdxContent;"));
    }

    #[test]
    fn test_generate_astro_module_with_layout() {
        let options = AstroModuleOptions {
            jsx: "<p>Hello</p>",
            hoisted_imports: &[],
            hoisted_exports: &[],
            frontmatter_json: "{}",
            headings_json: "[]",
            filepath: "/test.md",
            url: None,
            layout_import: Some("../layouts/Base.astro"),
            has_user_default_export: false,
        };

        let code = generate_astro_module(&options);

        assert!(code.contains("import Layout from \"../layouts/Base.astro\";"));
        assert!(code.contains("_jsx(Layout,"));
    }

    #[test]
    fn test_generate_astro_module_no_default_export() {
        let options = AstroModuleOptions {
            jsx: "<p>Hello</p>",
            hoisted_imports: &[],
            hoisted_exports: &[],
            frontmatter_json: "{}",
            headings_json: "[]",
            filepath: "/test.md",
            url: None,
            layout_import: None,
            has_user_default_export: true,
        };

        let code = generate_astro_module(&options);

        assert!(!code.contains("export default xmdxContent;"));
    }

    #[test]
    fn test_generate_astro_module_with_exports() {
        let options = AstroModuleOptions {
            jsx: "<p>Hello</p>",
            hoisted_imports: &["import Foo from './foo';".to_string()],
            hoisted_exports: &["export const bar = 1;".to_string()],
            frontmatter_json: "{}",
            headings_json: "[]",
            filepath: "/test.md",
            url: None,
            layout_import: None,
            has_user_default_export: false,
        };

        let code = generate_astro_module(&options);

        assert!(code.contains("import Foo from './foo';"));
        assert!(code.contains("export const bar = 1;"));
        // Exports should appear before the component
        let export_pos = code.find("export const bar = 1;").unwrap();
        let component_pos = code.find("const xmdxContent").unwrap();
        assert!(
            export_pos < component_pos,
            "User exports should appear before xmdxContent"
        );
    }

    #[test]
    fn test_blocks_to_jsx_string_fragment_slot_uses_span_wrapper() {
        // Fragment-with-slot children should be rendered as <span style="display:contents" slot="name">
        // instead of <Fragment slot="name"> because Astro's renderJSX unwraps Fragment VNodes
        // before slot distribution, losing the slot assignment.
        let blocks = vec![RenderBlock::Component {
            name: "IslandsDiagram".to_string(),
            props: HashMap::new(),
            slot_children: vec![
                RenderBlock::Component {
                    name: "Fragment".to_string(),
                    props: {
                        let mut p = HashMap::new();
                        p.insert("slot".to_string(), PropValue::literal("headerApp"));
                        p
                    },
                    slot_children: vec![RenderBlock::Html {
                        content: "Header (interactive island)".to_string(),
                    }],
                },
                RenderBlock::Component {
                    name: "Fragment".to_string(),
                    props: {
                        let mut p = HashMap::new();
                        p.insert("slot".to_string(), PropValue::literal("footer"));
                        p
                    },
                    slot_children: vec![RenderBlock::Html {
                        content: "Footer (static HTML)".to_string(),
                    }],
                },
            ],
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);

        // Should use <span style="display:contents" slot="..."> instead of <Fragment slot="...">
        assert!(
            jsx.contains("style=\"display:contents\" slot=\"headerApp\""),
            "Expected span with display:contents for headerApp slot, got: {}",
            jsx
        );
        assert!(
            jsx.contains("style=\"display:contents\" slot=\"footer\""),
            "Expected span with display:contents for footer slot, got: {}",
            jsx
        );
        // Should NOT contain <Fragment slot=
        assert!(
            !jsx.contains("<Fragment slot="),
            "Should not use Fragment for slot distribution, got: {}",
            jsx
        );
    }

    #[test]
    fn test_blocks_to_jsx_string_fragment_slot_with_default_content() {
        // Component with both Fragment-slot children and regular default slot content
        let blocks = vec![RenderBlock::Component {
            name: "MyComponent".to_string(),
            props: HashMap::new(),
            slot_children: vec![
                RenderBlock::Html {
                    content: "<p>Default content</p>".to_string(),
                },
                RenderBlock::Component {
                    name: "Fragment".to_string(),
                    props: {
                        let mut p = HashMap::new();
                        p.insert("slot".to_string(), PropValue::literal("sidebar"));
                        p
                    },
                    slot_children: vec![RenderBlock::Html {
                        content: "Sidebar content".to_string(),
                    }],
                },
            ],
        }];
        let jsx = blocks_to_jsx_string(&blocks, None::<fn(&str) -> Option<DirectiveMappingResult>>);

        // Default slot content should use set:html
        assert!(
            jsx.contains("set:html={\"<p>Default content</p>\"}"),
            "Expected default slot content, got: {}",
            jsx
        );
        // Named slot should use div wrapper
        assert!(
            jsx.contains("slot=\"sidebar\""),
            "Expected sidebar slot, got: {}",
            jsx
        );
        assert!(
            jsx.contains("display:contents"),
            "Expected display:contents wrapper, got: {}",
            jsx
        );
    }

    #[test]
    fn test_slot_children_to_html_fragment_slot_uses_span() {
        // When Fragment-with-slot appears in slot_children_to_html (nested case),
        // it should also be rendered as <span style="display:contents" slot="name">
        let blocks = vec![RenderBlock::Component {
            name: "Fragment".to_string(),
            props: {
                let mut p = HashMap::new();
                p.insert("slot".to_string(), PropValue::literal("test"));
                p
            },
            slot_children: vec![RenderBlock::Html {
                content: "Slot content".to_string(),
            }],
        }];
        let html = slot_children_to_html(&blocks);
        assert!(
            html.contains("<span style=\"display:contents\" slot=\"test\">"),
            "Expected span wrapper in slot_children_to_html, got: {}",
            html
        );
        assert!(
            !html.contains("<Fragment"),
            "Should not contain Fragment tag, got: {}",
            html
        );
    }
}
