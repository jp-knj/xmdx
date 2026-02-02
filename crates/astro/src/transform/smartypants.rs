//! Smart punctuation transformations (smart quotes, dashes, ellipsis).

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

    let is_opening =
        |s: &str| s.is_empty() || s.ends_with(|c: char| c.is_whitespace() || "([{\"'".contains(c));

    while let Some(c) = chars.next() {
        // Inline code with backticks
        if c == '`' {
            in_tick = !in_tick;
            out.push(c);
            continue;
        }

        // Handle tags wholesale to manage code/pre/script/style skipping.
        if c == '<' {
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
                code_depth += 1;
            } else if lower.starts_with("</code")
                || lower.starts_with("</pre")
                || lower.starts_with("</script")
                || lower.starts_with("</style")
            {
                code_depth = code_depth.saturating_sub(1);
            }
            out.push_str(&tag);
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

        match c {
            '-' => match chars.peek() {
                Some('-') => {
                    chars.next();
                    match chars.peek() {
                        Some('-') => {
                            chars.next();
                            out.push('—');
                        }
                        _ => out.push('–'),
                    }
                }
                _ => out.push('-'),
            },
            '.' => match chars.peek() {
                Some('.') => {
                    if let Some('.') = chars.clone().nth(1) {
                        chars.next();
                        chars.next();
                        out.push('…');
                    } else {
                        out.push('.');
                    }
                }
                _ => out.push('.'),
            },
            '"' => out.push(if is_opening(&out) { '“' } else { '”' }),
            '\'' => out.push(if is_opening(&out) { '‘' } else { '’' }),
            _ => out.push(c),
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::apply_smartypants;

    #[test]
    fn transforms_basic_punctuation() {
        let input = "Hello -- \"world\" ... and 'quote' --- end";
        let out = apply_smartypants(input);
        assert_eq!(out, "Hello – “world” … and ‘quote’ — end");
    }

    #[test]
    fn skips_code_tags_and_inline_code() {
        let input = "<code>\"---\"</code> and `--` outside -- ok";
        let out = apply_smartypants(input);
        assert!(out.contains("<code>\"---\"</code>"));
        assert!(out.contains("`--`"));
        assert!(out.contains("outside – ok"));
    }

    #[test]
    fn skips_mdx_expressions() {
        let input = "<p>Hello {props.name ?? 'friend'} -- ok</p>";
        let out = apply_smartypants(input);
        assert!(out.contains("{props.name ?? 'friend'}"));
        assert!(out.contains("– ok"));
    }
}
