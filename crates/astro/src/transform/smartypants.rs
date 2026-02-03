//! Smart punctuation transformations (smart quotes, dashes, ellipsis).

use std::iter::Peekable;
use std::str::Chars;

/// Apply smartypants-style replacements to plain text HTML, skipping code/pre/script/style blocks
/// and MDX/JS expressions enclosed in `{...}`.
pub fn apply_smartypants(input: &str) -> String {
    if !input.contains(['"', '\'', '-']) && !input.contains("...") {
        return input.to_string();
    }

    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    let mut code_depth = 0usize;
    let mut brace_depth = 0usize;
    let mut in_tick = false;

    while let Some(c) = chars.next() {
        // Inline code with backticks
        if c == '`' {
            in_tick = !in_tick;
            out.push(c);
            continue;
        }

        // Handle tags wholesale to manage code/pre/script/style skipping.
        if c == '<' {
            consume_html_tag(&mut chars, &mut out, &mut code_depth);
            continue;
        }

        // Track MDX/JS expressions; skip transforms inside braces.
        if c == '{' {
            brace_depth += 1;
            out.push(c);
            continue;
        }
        if c == '}' && brace_depth > 0 {
            brace_depth -= 1;
            out.push(c);
            continue;
        }

        if in_tick || code_depth > 0 || brace_depth > 0 {
            out.push(c);
            continue;
        }

        replace_punctuation(c, &mut chars, &mut out);
    }

    out
}

/// Consumes an HTML tag from the character stream, tracking code/pre/script/style depth.
fn consume_html_tag(chars: &mut Peekable<Chars<'_>>, out: &mut String, code_depth: &mut usize) {
    let mut tag = String::from("<");
    for n in chars.by_ref() {
        tag.push(n);
        if n == '>' {
            break;
        }
    }
    let lower = tag.to_ascii_lowercase();
    if lower.starts_with("<code")
        || lower.starts_with("<pre")
        || lower.starts_with("<script")
        || lower.starts_with("<style")
    {
        *code_depth += 1;
    } else if lower.starts_with("</code")
        || lower.starts_with("</pre")
        || lower.starts_with("</script")
        || lower.starts_with("</style")
    {
        *code_depth = code_depth.saturating_sub(1);
    }
    out.push_str(&tag);
}

/// Replaces ASCII punctuation with smart Unicode equivalents.
fn replace_punctuation(c: char, chars: &mut Peekable<Chars<'_>>, out: &mut String) {
    let is_opening =
        |s: &str| s.is_empty() || s.ends_with(|c: char| c.is_whitespace() || "([{\"'".contains(c));

    match c {
        '-' => match chars.peek() {
            Some('-') => {
                chars.next();
                match chars.peek() {
                    Some('-') => {
                        chars.next();
                        out.push('\u{2014}');
                    }
                    _ => out.push('\u{2013}'),
                }
            }
            _ => out.push('-'),
        },
        '.' => match chars.peek() {
            Some('.') => {
                if let Some('.') = chars.clone().nth(1) {
                    chars.next();
                    chars.next();
                    out.push('\u{2026}');
                } else {
                    out.push('.');
                }
            }
            _ => out.push('.'),
        },
        '"' => out.push(if is_opening(out) {
            '\u{201c}'
        } else {
            '\u{201d}'
        }),
        '\'' => out.push(if is_opening(out) {
            '\u{2018}'
        } else {
            '\u{2019}'
        }),
        _ => out.push(c),
    }
}

#[cfg(test)]
mod tests {
    use super::apply_smartypants;

    #[test]
    fn transforms_basic_punctuation() {
        let input = "Hello -- \"world\" ... and 'quote' --- end";
        let out = apply_smartypants(input);
        assert_eq!(
            out,
            "Hello \u{2013} \u{201c}world\u{201d} \u{2026} and \u{2018}quote\u{2019} \u{2014} end"
        );
    }

    #[test]
    fn skips_code_tags_and_inline_code() {
        let input = "<code>\"---\"</code> and `--` outside -- ok";
        let out = apply_smartypants(input);
        assert!(out.contains("<code>\"---\"</code>"));
        assert!(out.contains("`--`"));
        assert!(out.contains("outside \u{2013} ok"));
    }

    #[test]
    fn skips_mdx_expressions() {
        let input = "<p>Hello {props.name ?? 'friend'} -- ok</p>";
        let out = apply_smartypants(input);
        assert!(out.contains("{props.name ?? 'friend'}"));
        assert!(out.contains("\u{2013} ok"));
    }
}
