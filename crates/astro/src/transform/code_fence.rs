//! Code fence detection utilities to guard import/export hoisting.

/// Separated import and export statements from document root.
#[derive(Debug, Clone, Default)]
pub struct HoistedStatements {
    /// Import statements (e.g., `import X from 'module'`).
    pub imports: Vec<String>,
    /// Export statements (e.g., `export const X = 1`).
    pub exports: Vec<String>,
}

/// Fence parsing phases tracked across lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FencePhase {
    /// Not currently inside a fence.
    #[default]
    Outside,
    /// Opening fence delimiter line.
    FenceOpening,
    /// Within fence contents.
    InsideFence,
    /// Closing fence delimiter line.
    FenceClosing,
}

/// Current fence state (phase, marker, and indent).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FenceState {
    /// Current fence phase.
    pub phase: FencePhase,
    /// Fence marker character (``` or ~~~).
    pub marker: Option<char>,
    /// Leading whitespace count captured at opening.
    pub indent: usize,
}

impl Default for FenceState {
    fn default() -> Self {
        FenceState {
            phase: FencePhase::Outside,
            marker: None,
            indent: 0,
        }
    }
}

/// Outcome of processing a single line for fence state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineParseOutcome {
    /// State to carry into the next line.
    pub next_state: FenceState,
    /// Whether import hoisting should be skipped for this line.
    pub skip_imports: bool,
}

/// Advance fence state based on a single line of text.
pub fn advance_fence_state(line: &str, state: FenceState) -> LineParseOutcome {
    let indent = leading_whitespace_len(line);
    let after_indent = &line[indent..];

    let mut next_state = state;
    let mut skip_imports = matches!(state.phase, FencePhase::InsideFence);

    if matches!(state.phase, FencePhase::Outside)
        && let Some(marker) = detect_fence_marker(after_indent)
    {
        next_state = FenceState {
            phase: FencePhase::InsideFence,
            marker: Some(marker),
            indent,
        };
        skip_imports = true;
    } else if matches!(state.phase, FencePhase::InsideFence)
        && indent <= state.indent
        && is_closing_fence(after_indent)
        && detect_fence_marker(after_indent) == state.marker
    {
        // Only close if it's a bare fence (no info string)
        next_state = FenceState {
            phase: FencePhase::Outside,
            marker: None,
            indent: 0,
        };
        skip_imports = true;
    }

    LineParseOutcome {
        next_state,
        skip_imports,
    }
}

/// Collect root-level import/export statements while preserving the remaining lines.
/// Returns (hoisted_statements, body_lines) tuple.
pub fn collect_root_imports(body: &str) -> (Vec<String>, Vec<String>) {
    let (hoisted, body_lines) = collect_root_statements(body);
    // Combine imports and exports for backward compatibility
    let mut all_hoisted = hoisted.imports;
    all_hoisted.extend(hoisted.exports);
    (all_hoisted, body_lines)
}

/// Collect root-level import and export statements separately.
/// Returns (HoistedStatements, body_lines) tuple where imports and exports are separated.
pub fn collect_root_statements(body: &str) -> (HoistedStatements, Vec<String>) {
    let mut fence_state = FenceState::default();
    let mut imports = Vec::new();
    let mut exports = Vec::new();
    let mut body_lines = Vec::new();
    let mut buffer = String::new();
    let mut depth: isize = 0;
    let mut collecting = false;
    let mut collecting_import = false; // true = import, false = export
    let mut lines_iter = body.lines().peekable();

    while let Some(line) = lines_iter.next() {
        let outcome = advance_fence_state(line, fence_state);
        fence_state = outcome.next_state;

        if outcome.skip_imports {
            if collecting {
                buffer.push_str(line);
                buffer.push('\n');
            } else {
                body_lines.push(line.to_string());
            }
            continue;
        }

        let trimmed = line.trim_start();
        if !collecting {
            let is_import = is_import_start(trimmed);
            let is_export = is_export_start(trimmed);
            if is_import || is_export {
                collecting = true;
                collecting_import = is_import;
                depth = 0;
                buffer.push_str(line);
                buffer.push('\n');
                depth += paren_delta(line);
                let next = lines_iter.peek().copied();
                if ends_statement(line, depth, next) {
                    let statement = buffer.trim_end().to_string();
                    if collecting_import {
                        imports.push(statement);
                    } else {
                        exports.push(statement);
                    }
                    buffer.clear();
                    collecting = false;
                    depth = 0;
                }
                continue;
            }
        }

        if collecting {
            buffer.push_str(line);
            buffer.push('\n');
            depth += paren_delta(line);
            let next = lines_iter.peek().copied();
            if ends_statement(line, depth, next) {
                let statement = buffer.trim_end().to_string();
                if collecting_import {
                    imports.push(statement);
                } else {
                    exports.push(statement);
                }
                buffer.clear();
                collecting = false;
                depth = 0;
            }
        } else {
            body_lines.push(line.to_string());
        }
    }

    if collecting && !buffer.is_empty() {
        let statement = buffer.trim_end().to_string();
        if collecting_import {
            imports.push(statement);
        } else {
            exports.push(statement);
        }
    }

    (HoistedStatements { imports, exports }, body_lines)
}

fn is_import_start(trimmed: &str) -> bool {
    trimmed.starts_with("import ")
}

fn is_export_start(trimmed: &str) -> bool {
    trimmed.starts_with("export ")
}

fn paren_delta(line: &str) -> isize {
    let mut depth: isize = 0;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_template = false;
    let mut escape = false;

    for ch in line.chars() {
        if escape {
            escape = false;
            continue;
        }
        match ch {
            '\\' => {
                escape = true;
            }
            '\'' if !in_double_quote && !in_template => {
                in_single_quote = !in_single_quote;
            }
            '"' if !in_single_quote && !in_template => {
                in_double_quote = !in_double_quote;
            }
            '`' if !in_single_quote && !in_double_quote => {
                in_template = !in_template;
            }
            '(' | '{' | '[' if !in_single_quote && !in_double_quote && !in_template => {
                depth += 1;
            }
            ')' | '}' | ']' if !in_single_quote && !in_double_quote && !in_template => {
                depth -= 1;
            }
            _ => {}
        }
    }

    depth
}

fn ends_statement(line: &str, depth: isize, next_line: Option<&str>) -> bool {
    if depth != 0 {
        return false;
    }

    let trimmed = line.trim_end();

    // explicit terminator
    if trimmed.ends_with(';') {
        return true;
    }

    // explicit continuations
    if trimmed.ends_with('\\')
        || trimmed.ends_with(',')
        || trimmed.ends_with('{')
        || trimmed.ends_with('(')
    {
        return false;
    }

    // closing brace/paren/bracket: peek next line for continuation
    if trimmed.ends_with('}') || trimmed.ends_with(')') || trimmed.ends_with(']') {
        if let Some(next) = next_line {
            let nt = next.trim_start();
            if nt.starts_with(',')
                || nt.starts_with('.')
                || nt.starts_with('{')
                || nt.starts_with('(')
            {
                return false;
            }
        }
        return true;
    }

    // default: treat as ended unless the next line is a continuation
    if let Some(next) = next_line {
        let nt = next.trim_start();
        if nt.starts_with(',') || nt.starts_with('{') || nt.starts_with('(') || nt.starts_with('.')
        {
            return false;
        }
        return true;
    }

    true
}

fn leading_whitespace_len(line: &str) -> usize {
    line.bytes()
        .take_while(|b| matches!(*b, b' ' | b'\t'))
        .count()
}

fn detect_fence_marker(after_indent: &str) -> Option<char> {
    let mut chars = after_indent.chars();
    let first = chars.next()?;
    if first != '`' && first != '~' {
        return None;
    }
    let run_len = 1 + chars.take_while(|c| *c == first).count();
    if run_len >= 3 { Some(first) } else { None }
}

/// Check if a line is a closing fence (no info string after markers).
/// A closing fence has only fence markers followed by optional whitespace.
fn is_closing_fence(after_indent: &str) -> bool {
    let mut chars = after_indent.chars();
    let first = match chars.next() {
        Some(c) if c == '`' || c == '~' => c,
        _ => return false,
    };
    // Count fence markers
    let mut count = 1;
    for c in chars.by_ref() {
        if c == first {
            count += 1;
        } else {
            // After markers, only whitespace is allowed for a closing fence
            return count >= 3 && c.is_whitespace() && chars.all(|c| c.is_whitespace());
        }
    }
    // All markers, no trailing content
    count >= 3
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_and_closes_backtick_fence() {
        let start = advance_fence_state("```js", FenceState::default());
        assert!(start.skip_imports);
        assert!(matches!(start.next_state.phase, FencePhase::InsideFence));
        assert_eq!(start.next_state.marker, Some('`'));
        assert_eq!(start.next_state.indent, 0);

        let inner = advance_fence_state("console.log('hi');", start.next_state);
        assert!(inner.skip_imports);
        assert!(matches!(inner.next_state.phase, FencePhase::InsideFence));

        let end = advance_fence_state("```", inner.next_state);
        assert!(end.skip_imports);
        assert!(matches!(end.next_state.phase, FencePhase::Outside));
        assert_eq!(end.next_state.marker, None);
    }

    #[test]
    fn does_not_close_with_greater_indent() {
        let start = advance_fence_state("    ```", FenceState::default());
        let inner = advance_fence_state("      code", start.next_state);
        let not_closed = advance_fence_state("      ```", inner.next_state);

        assert!(not_closed.skip_imports);
        assert!(matches!(
            not_closed.next_state.phase,
            FencePhase::InsideFence
        ));
    }

    #[test]
    fn ignores_mismatched_marker() {
        let start = advance_fence_state("~~~ts", FenceState::default());
        let still_inside = advance_fence_state("```", start.next_state);

        assert!(still_inside.skip_imports);
        assert!(matches!(
            still_inside.next_state.phase,
            FencePhase::InsideFence
        ));
        assert_eq!(still_inside.next_state.marker, Some('~'));
    }

    #[test]
    fn requires_three_markers_to_open() {
        let outcome = advance_fence_state("``", FenceState::default());
        assert!(!outcome.skip_imports);
        assert!(matches!(outcome.next_state.phase, FencePhase::Outside));
    }

    #[test]
    fn collects_single_line_import() {
        let body = "import A from './a'\nconst x = 1;";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["import A from './a'"]);
        assert_eq!(rest, vec!["const x = 1;"]);
    }

    #[test]
    fn collects_multiline_import() {
        let body = "import {\n  A,\n  B,\n} from './a';\nconsole.log(A);";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["import {\n  A,\n  B,\n} from './a';"]);
        assert_eq!(rest, vec!["console.log(A);"]);
    }

    #[test]
    fn ignores_import_inside_fence() {
        let body = "```\nimport bad from './nope'\n```\nimport good from './ok';";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["import good from './ok';"]);
        assert_eq!(rest, vec!["```", "import bad from './nope'", "```"]);
    }

    #[test]
    fn detects_after_fence_with_indent() {
        let body = "    ```\ncode\n    ```\nexport const x = 1;";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["export const x = 1;"]);
        assert_eq!(rest, vec!["    ```", "code", "    ```"]);
    }

    #[test]
    fn collects_semicolonless_export_const() {
        let body = "export const foo = () => {\n  return 1\n}\nconsole.log(foo());";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["export const foo = () => {\n  return 1\n}"]);
        assert_eq!(rest, vec!["console.log(foo());"]);
    }

    #[test]
    fn collects_export_block() {
        let body = "export {\n  foo,\n  bar,\n}\nconst x = 1;";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["export {\n  foo,\n  bar,\n}"]);
        assert_eq!(rest, vec!["const x = 1;"]);
    }

    #[test]
    fn collects_export_default_function_multiline() {
        let body = "export default function test()\n{\n  return 1;\n}\n# Title";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(
            imports,
            vec!["export default function test()\n{\n  return 1;\n}"]
        );
        assert_eq!(rest, vec!["# Title"]);
    }

    #[test]
    fn collects_export_default_async_arrow() {
        let body = "export default async () => {\n  return 1\n}\nContent";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["export default async () => {\n  return 1\n}"]);
        assert_eq!(rest, vec!["Content"]);
    }

    #[test]
    fn collects_export_all() {
        let body = "export * from './mod';\nText";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["export * from './mod';"]);
        assert_eq!(rest, vec!["Text"]);
    }

    #[test]
    fn collects_export_with_inline_comment() {
        let body = "export const foo = 1 // inline\nNext";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["export const foo = 1 // inline"]);
        assert_eq!(rest, vec!["Next"]);
    }

    #[test]
    fn ignores_export_inside_fence() {
        let body = "```\nexport const skip = true\n```\nexport const ok = false;";
        let (imports, rest) = collect_root_imports(body);
        assert_eq!(imports, vec!["export const ok = false;"]);
        assert_eq!(rest, vec!["```", "export const skip = true", "```"]);
    }

    #[test]
    fn fence_with_info_string_does_not_close_previous_fence() {
        // A fence with info string (like ```astro) is an OPENER, not a closer
        // So ```ini should not close the fence opened by ```
        let body = "```\n{\"key\": \"value\"}\n```ini\nmore\n```\nimport ok from 'ok';";
        let (imports, rest) = collect_root_imports(body);
        // The import should be hoisted because it's after all fences are closed
        assert_eq!(imports, vec!["import ok from 'ok';"]);
        // The content should preserve the fence structure
        assert_eq!(
            rest,
            vec!["```", "{\"key\": \"value\"}", "```ini", "more", "```"]
        );
    }

    #[test]
    fn is_closing_fence_tests() {
        // Bare fence markers are closing fences
        assert!(is_closing_fence("```"));
        assert!(is_closing_fence("~~~"));
        assert!(is_closing_fence("````"));
        assert!(is_closing_fence("```  ")); // trailing whitespace OK

        // Fences with info strings are NOT closing fences
        assert!(!is_closing_fence("```js"));
        assert!(!is_closing_fence("```astro title=\"test\""));
        assert!(!is_closing_fence("~~~ini"));

        // Too few markers
        assert!(!is_closing_fence("``"));
        assert!(!is_closing_fence("~"));
    }

    #[test]
    fn collects_imports_and_exports_separately() {
        let body = "import A from './a'\nexport const x = 1;\nconst y = 2;";
        let (hoisted, rest) = collect_root_statements(body);
        assert_eq!(hoisted.imports, vec!["import A from './a'"]);
        assert_eq!(hoisted.exports, vec!["export const x = 1;"]);
        assert_eq!(rest, vec!["const y = 2;"]);
    }

    #[test]
    fn identifies_default_export() {
        let body = "export default function App() { return 1; }\n# Title";
        let (hoisted, rest) = collect_root_statements(body);
        assert!(hoisted.imports.is_empty());
        assert_eq!(hoisted.exports.len(), 1);
        assert!(hoisted.exports[0].starts_with("export default"));
        assert_eq!(rest, vec!["# Title"]);
    }

    #[test]
    fn handles_multiline_export() {
        let body = "export const config = {\n  foo: 1,\n  bar: 2,\n};\nContent";
        let (hoisted, rest) = collect_root_statements(body);
        assert!(hoisted.imports.is_empty());
        assert_eq!(
            hoisted.exports,
            vec!["export const config = {\n  foo: 1,\n  bar: 2,\n};"]
        );
        assert_eq!(rest, vec!["Content"]);
    }

    #[test]
    fn separates_multiple_imports_and_exports() {
        let body = "import A from 'a';\nimport B from 'b';\nexport const x = 1;\nexport const y = 2;\n# Heading";
        let (hoisted, rest) = collect_root_statements(body);
        assert_eq!(
            hoisted.imports,
            vec!["import A from 'a';", "import B from 'b';"]
        );
        assert_eq!(
            hoisted.exports,
            vec!["export const x = 1;", "export const y = 2;"]
        );
        assert_eq!(rest, vec!["# Heading"]);
    }

    #[test]
    fn handles_export_all_from() {
        let body = "export * from './module';\nText";
        let (hoisted, rest) = collect_root_statements(body);
        assert!(hoisted.imports.is_empty());
        assert_eq!(hoisted.exports, vec!["export * from './module';"]);
        assert_eq!(rest, vec!["Text"]);
    }

    #[test]
    fn handles_export_named_from() {
        let body = "export { foo, bar } from './module';\nText";
        let (hoisted, rest) = collect_root_statements(body);
        assert!(hoisted.imports.is_empty());
        assert_eq!(
            hoisted.exports,
            vec!["export { foo, bar } from './module';"]
        );
        assert_eq!(rest, vec!["Text"]);
    }

    #[test]
    fn ignores_exports_inside_fence() {
        let body = "```\nexport const bad = true\n```\nexport const good = false;";
        let (hoisted, rest) = collect_root_statements(body);
        assert!(hoisted.imports.is_empty());
        assert_eq!(hoisted.exports, vec!["export const good = false;"]);
        assert_eq!(rest, vec!["```", "export const bad = true", "```"]);
    }

    #[test]
    fn backward_compat_collect_root_imports() {
        // Ensure collect_root_imports still returns combined imports + exports
        let body = "import A from 'a';\nexport const x = 1;\nText";
        let (hoisted, rest) = collect_root_imports(body);
        assert_eq!(hoisted, vec!["import A from 'a';", "export const x = 1;"]);
        assert_eq!(rest, vec!["Text"]);
    }
}
