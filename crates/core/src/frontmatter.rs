use serde_json::Value as JsonValue;
use thiserror::Error;

/// Result returned after extracting frontmatter from a Markdown document.
#[derive(Debug)]
pub struct FrontmatterExtraction {
    /// Parsed frontmatter as a JSON value.
    pub value: JsonValue,
    /// Byte offset inside the original document where Markdown content begins.
    pub body_start: usize,
}

impl FrontmatterExtraction {
    fn empty() -> Self {
        Self {
            value: JsonValue::Object(Default::default()),
            body_start: 0,
        }
    }
}

/// Errors emitted while parsing or extracting frontmatter.
#[derive(Debug, Error)]
pub enum FrontmatterError {
    /// Unclosed YAML fence (e.g., missing terminating `---`).
    #[error("Unterminated YAML frontmatter block: expected closing '---'")]
    Unterminated,
    /// YAML failed to parse.
    #[error("Frontmatter parse error: {0}")]
    Parse(String),
    /// Top-level YAML node was not a mapping.
    #[error("Frontmatter must be a YAML mapping at the top level")]
    InvalidRootType,
}

/// Extracts YAML frontmatter from an input document.
pub fn extract_frontmatter(input: &str) -> Result<FrontmatterExtraction, FrontmatterError> {
    match find_yaml_block(input)? {
        Some((block, body_start)) => {
            let value = parse_yaml_block(&block)?;
            Ok(FrontmatterExtraction { value, body_start })
        }
        None => Ok(FrontmatterExtraction::empty()),
    }
}

fn parse_yaml_block(block: &str) -> Result<JsonValue, FrontmatterError> {
    if block.trim().is_empty() {
        return Ok(JsonValue::Object(Default::default()));
    }

    let yaml_value: serde_yaml::Value =
        serde_yaml::from_str(block).map_err(|err| FrontmatterError::Parse(err.to_string()))?;
    let json_value =
        serde_json::to_value(yaml_value).map_err(|err| FrontmatterError::Parse(err.to_string()))?;

    match json_value {
        JsonValue::Null => Ok(JsonValue::Object(Default::default())),
        JsonValue::Object(_) => Ok(json_value),
        _ => Err(FrontmatterError::InvalidRootType),
    }
}

fn find_yaml_block(input: &str) -> Result<Option<(String, usize)>, FrontmatterError> {
    let (without_bom, bom_len) = strip_bom(input);
    let mut cursor = 0usize;

    loop {
        match next_line(without_bom, cursor) {
            Some((line, next_cursor)) => {
                if line.trim().is_empty() {
                    cursor = next_cursor;
                    continue;
                }

                if !is_yaml_fence(line) {
                    return Ok(None);
                }

                let block_start = next_cursor;
                let mut scan_cursor = next_cursor;

                loop {
                    match next_line(without_bom, scan_cursor) {
                        Some((block_line, next_line_cursor)) => {
                            if is_yaml_fence(block_line) {
                                let raw_block = &without_bom[block_start..scan_cursor];
                                let trimmed = raw_block.trim_end_matches(['\r', '\n']);
                                let body_index = bom_len + next_line_cursor;
                                return Ok(Some((trimmed.to_string(), body_index)));
                            }
                            scan_cursor = next_line_cursor;
                        }
                        None => return Err(FrontmatterError::Unterminated),
                    }
                }
            }
            None => return Ok(None),
        }
    }
}

fn strip_bom(input: &str) -> (&str, usize) {
    if let Some(stripped) = input.strip_prefix('\u{feff}') {
        (stripped, '\u{feff}'.len_utf8())
    } else {
        (input, 0)
    }
}

fn next_line(input: &str, start: usize) -> Option<(&str, usize)> {
    if start >= input.len() {
        return None;
    }

    let bytes = &input.as_bytes()[start..];
    if let Some(pos) = bytes.iter().position(|b| *b == b'\n') {
        let line_end = start + pos;
        let line = &input[start..line_end];
        Some((line, line_end + 1))
    } else {
        Some((&input[start..], input.len()))
    }
}

fn is_yaml_fence(line: &str) -> bool {
    normalize_line(line) == "---"
}

fn normalize_line(line: &str) -> &str {
    line.trim_end_matches('\r')
}
#[cfg(test)]
mod tests {
    use super::*;

    fn extract(input: &str) -> FrontmatterExtraction {
        extract_frontmatter(input).expect("frontmatter extraction should succeed")
    }

    #[test]
    fn returns_empty_when_no_frontmatter() {
        let result = extract("# Title\nBody");
        assert_eq!(result.body_start, 0);
        assert_eq!(result.value, JsonValue::Object(Default::default()));
    }

    #[test]
    fn parses_basic_yaml() {
        let input = "---\ntitle: Example\ntags:\n  - rust\n  - astro\n---\n# Content";
        let result = extract(input);
        assert_eq!(result.body_start, input.find("# Content").unwrap());
        let title = result
            .value
            .get("title")
            .and_then(JsonValue::as_str)
            .expect("title should exist");
        assert_eq!(title, "Example");
    }

    #[test]
    fn handles_empty_block() {
        let input = "---\n---\n# Body";
        let result = extract(input);
        assert_eq!(result.value, JsonValue::Object(Default::default()));
        assert_eq!(result.body_start, input.find("# Body").unwrap());
    }

    #[test]
    fn preserves_bom_and_whitespace() {
        let input = "\u{feff}\n   \n---\nfoo: bar\n---\nBody";
        let result = extract(input);
        assert_eq!(
            result.value.get("foo").and_then(JsonValue::as_str).unwrap(),
            "bar"
        );
        assert_eq!(result.body_start, input.find("Body").unwrap());
    }

    #[test]
    fn errors_on_invalid_yaml() {
        let input = "---\ninvalid: [unterminated\n---\n";
        let err = extract_frontmatter(input).unwrap_err();
        assert!(matches!(err, FrontmatterError::Parse(_)), "{err:?}");
    }

    #[test]
    fn errors_on_unterminated_block() {
        let input = "---\ntitle: test";
        let err = extract_frontmatter(input).unwrap_err();
        assert!(matches!(err, FrontmatterError::Unterminated));
    }
}
