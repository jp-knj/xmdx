//! Directive rewriting utilities.

use std::fmt::Write as _;

use crate::registry::RegistryConfig;
use crate::transform::code_fence::{FenceState, advance_fence_state};

/// Ensures Aside import is present when directives were rewritten.
/// If `count > 0` and no existing import from `@astrojs/starlight/components` is present,
/// it pushes the import into the `hoisted` list.
///
/// # Deprecated
///
/// This function is deprecated. Use `ensure_directive_imports` with a registry instead,
/// which supports custom component mappings.
#[deprecated(
    since = "0.5.0",
    note = "Use ensure_directive_imports with a registry instead"
)]
pub fn ensure_aside_import(hoisted: &mut Vec<String>, directive_count: usize) {
    if directive_count == 0 {
        return;
    }

    let already_imported = hoisted
        .iter()
        .any(|line| line.contains("@astrojs/starlight/components"));

    if !already_imported {
        hoisted.insert(
            0,
            "import { Aside } from '@astrojs/starlight/components';".to_string(),
        );
    }
}

/// Ensures necessary imports are present for components used in directive mappings.
///
/// This function uses the registry to determine which components need to be imported
/// based on the directives used in the document.
///
/// # Arguments
///
/// * `hoisted` - Mutable reference to the list of hoisted import statements
/// * `used_directives` - List of directive names that were used in the document
/// * `registry` - The component registry for looking up component import paths
pub fn ensure_directive_imports(
    hoisted: &mut Vec<String>,
    used_directives: &[&str],
    registry: &RegistryConfig,
) {
    use std::collections::HashSet;

    // Collect unique component names needed for the used directives
    let mut components_needed: HashSet<&str> = HashSet::new();
    for directive in used_directives {
        if let Some(component) = registry.get_directive_component(directive) {
            components_needed.insert(component);
        }
    }

    // For each component, check if import exists and add if needed
    for component in components_needed {
        if let Some(module_path) = registry.get_component_module(component) {
            let import_fragment = format!("from '{}'", module_path);
            let already_imported = hoisted.iter().any(|line| line.contains(&import_fragment));

            if !already_imported {
                hoisted.insert(
                    0,
                    format!("import {{ {} }} from '{}';", component, module_path),
                );
            }
        }
    }
}

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
    pub(crate) fn to_aside_start(&self) -> String {
        let mut tag = String::from("<Aside data-mf-source=\"directive\"");

        // type attribute is always injected/overwritten.
        write!(tag, " type=\"{}\"", self.name).ok();

        // Attributes from source line: keep as-is after stripping conflicting keys.
        if !self.raw_attrs.is_empty() {
            tag.push(' ');
            tag.push_str(&self.raw_attrs);
        }

        // Title resolution: bracket > attribute (attributes already stripped of title when bracket present).
        if let Some(title) = self.bracket_title.as_ref() {
            write!(tag, " title=\"{}\"", title).ok();
        }

        tag.push('>');
        tag
    }

    pub(crate) fn to_aside_end(&self) -> String {
        "</Aside>".to_string()
    }
}

pub(crate) fn parse_opening_directive(line: &str) -> Option<DirectiveOpening> {
    let trimmed = line.trim();
    if !trimmed.starts_with(":::") {
        return None;
    }

    // Strip leading :::
    let after_colons = &trimmed[3..];
    let mut chars = after_colons.chars().peekable();

    // Read directive name (alphabetic)
    let mut name = String::new();
    while let Some(&ch) = chars.peek() {
        if ch.is_ascii_alphabetic() {
            name.push(ch.to_ascii_lowercase());
            chars.next();
        } else {
            break;
        }
    }

    if name.is_empty() || !is_supported_name(&name) {
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
    let mut chars = attrs.char_indices().peekable();
    let mut token_start: Option<usize> = None;
    let mut in_quotes = false;
    let mut quote_char = '"';

    while let Some((i, c)) = chars.next() {
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

pub(crate) fn is_directive_closer(line: &str) -> bool {
    line.trim() == ":::"
}

fn is_supported_name(name: &str) -> bool {
    matches!(
        name,
        "note" | "tip" | "info" | "caution" | "warning" | "danger"
    )
}

/// Legacy string-based directive rewrite used internally by the streaming adapter for block-local transforms.
#[allow(dead_code)]
pub(crate) fn rewrite_directives_to_asides(input: &str) -> (String, usize) {
    let mut fence_state = FenceState::default();
    let mut output = String::new();
    let mut count = 0usize;

    // Stack of active directive names (to support nesting if encountered).
    let mut directive_stack: Vec<DirectiveOpening> = Vec::new();

    for line in input.lines() {
        let fence_outcome = advance_fence_state(line, fence_state);
        fence_state = fence_outcome.next_state;

        if fence_outcome.skip_imports {
            // Inside code fence; passthrough without touching directive syntax.
            writeln!(output, "{}", line).ok();
            continue;
        }

        if let Some(opening) = parse_opening_directive(line) {
            count += 1;
            directive_stack.push(opening.clone());
            let start_tag = opening.to_aside_start();
            writeln!(output, "{}", start_tag).ok();
            continue;
        }

        if is_directive_closer(line)
            && let Some(opened) = directive_stack.pop()
        {
            let end_tag = opened.to_aside_end();
            writeln!(output, "{}", end_tag).ok();
            continue;
        }

        writeln!(output, "{}", line).ok();
    }

    // For any unclosed directives, close them at the end to avoid broken output.
    while directive_stack.pop().is_some() {
        writeln!(output, "</Aside>").ok();
    }

    (output, count)
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
    fn parse_directive_with_quoted_title_attr() {
        // This is the regression case: title="foo bar" was being split incorrectly
        let opening = parse_opening_directive(":::note title=\"foo bar\"").unwrap();
        assert_eq!(opening.name, "note");
        // title should be preserved as a single attribute
        assert_eq!(opening.raw_attrs, "title=\"foo bar\"");
    }

    #[test]
    fn parse_directive_with_multiple_spaced_attrs() {
        let opening =
            parse_opening_directive(":::warning title=\"Be careful here\" class=\"my class\"")
                .unwrap();
        assert_eq!(opening.name, "warning");
        assert_eq!(
            opening.raw_attrs,
            "title=\"Be careful here\" class=\"my class\""
        );
    }
}
