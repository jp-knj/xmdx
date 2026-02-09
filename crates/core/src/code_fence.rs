//! Code fence detection utilities for directive rewriting.
//!
//! This module provides minimal code fence tracking needed to skip
//! directive rewriting inside code blocks.

/// Fence parsing phases tracked across lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FencePhase {
    /// Not currently inside a fence.
    #[default]
    Outside,
    /// Within fence contents.
    InsideFence,
}

/// Current fence state (phase, marker, indent, and length).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FenceState {
    /// Current fence phase.
    pub phase: FencePhase,
    /// Fence marker character (``` or ~~~).
    pub marker: Option<char>,
    /// Leading whitespace count captured at opening.
    pub indent: usize,
    /// Length of the opening fence (number of ` or ~ characters).
    pub length: usize,
}

impl Default for FenceState {
    fn default() -> Self {
        FenceState {
            phase: FencePhase::Outside,
            marker: None,
            indent: 0,
            length: 0,
        }
    }
}

/// Outcome of processing a single line for fence state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineParseOutcome {
    /// State to carry into the next line.
    pub next_state: FenceState,
    /// Whether we are inside a code fence (skip directive rewriting).
    pub skip_rewrite: bool,
}

/// Advance fence state based on a single line of text.
pub fn advance_fence_state(line: &str, state: FenceState) -> LineParseOutcome {
    let (visual_indent, byte_offset) = leading_whitespace_info(line);
    let after_indent = &line[byte_offset..];

    let mut next_state = state;
    let mut skip_rewrite = matches!(state.phase, FencePhase::InsideFence);

    if matches!(state.phase, FencePhase::Outside) && visual_indent <= 3 {
        // CommonMark: fence opener must have 0-3 spaces of indentation
        // 4+ spaces = indented code block, not a fenced code block
        if let Some((marker, length)) = detect_fence_marker_with_length(after_indent) {
            next_state = FenceState {
                phase: FencePhase::InsideFence,
                marker: Some(marker),
                indent: visual_indent,
                length,
            };
            skip_rewrite = true;
        }
    } else if matches!(state.phase, FencePhase::InsideFence)
        && visual_indent <= 3 // CommonMark: closing fence can have 0-3 spaces of indentation
        && is_closing_fence(after_indent)
    {
        // Check that closer has same marker and length >= opener length
        if let Some((marker, closer_len)) = detect_fence_marker_with_length(after_indent)
            && Some(marker) == state.marker
            && closer_len >= state.length
        {
            next_state = FenceState {
                phase: FencePhase::Outside,
                marker: None,
                indent: 0,
                length: 0,
            };
            skip_rewrite = true;
        }
    }

    LineParseOutcome {
        next_state,
        skip_rewrite,
    }
}

/// Returns (visual_columns, byte_offset) for leading whitespace.
/// Visual columns expand tabs to 4-column boundaries per CommonMark.
fn leading_whitespace_info(line: &str) -> (usize, usize) {
    let mut col = 0;
    let mut bytes = 0;
    for b in line.bytes() {
        match b {
            b' ' => {
                col += 1;
                bytes += 1;
            }
            b'\t' => {
                col += 4 - (col % 4); // Tab expands to next 4-column boundary
                bytes += 1;
            }
            _ => break,
        }
    }
    (col, bytes)
}

fn detect_fence_marker_with_length(after_indent: &str) -> Option<(char, usize)> {
    let mut chars = after_indent.chars();
    let first = chars.next()?;
    if first != '`' && first != '~' {
        return None;
    }
    let run_len = 1 + chars.take_while(|c| *c == first).count();
    if run_len >= 3 {
        Some((first, run_len))
    } else {
        None
    }
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
        assert!(start.skip_rewrite);
        assert!(matches!(start.next_state.phase, FencePhase::InsideFence));
        assert_eq!(start.next_state.marker, Some('`'));
        assert_eq!(start.next_state.indent, 0);

        let inner = advance_fence_state("console.log('hi');", start.next_state);
        assert!(inner.skip_rewrite);
        assert!(matches!(inner.next_state.phase, FencePhase::InsideFence));

        let end = advance_fence_state("```", inner.next_state);
        assert!(end.skip_rewrite);
        assert!(matches!(end.next_state.phase, FencePhase::Outside));
        assert_eq!(end.next_state.marker, None);
    }

    #[test]
    fn does_not_close_with_greater_indent() {
        // Fence opened with 3-space indent should not close on 6-space indented closer (6 > 3)
        let start = advance_fence_state("   ```", FenceState::default()); // 3 spaces
        let inner = advance_fence_state("      code", start.next_state);
        let not_closed = advance_fence_state("      ```", inner.next_state); // 6 spaces > 3

        assert!(not_closed.skip_rewrite);
        assert!(matches!(
            not_closed.next_state.phase,
            FencePhase::InsideFence
        ));
    }

    #[test]
    fn deeply_indented_fence_not_opened() {
        // CommonMark: 4+ spaces = indented code block, not fenced code
        let outcome = advance_fence_state("    ```js", FenceState::default());

        // Should NOT enter InsideFence - this is an indented code block
        assert!(!outcome.skip_rewrite);
        assert!(matches!(outcome.next_state.phase, FencePhase::Outside));
    }

    #[test]
    fn tab_indented_fence_not_opened() {
        // CommonMark: tab at column 0 = 4 spaces = indented code block
        let outcome = advance_fence_state("\t```js", FenceState::default());

        // Should NOT enter InsideFence - tab equals 4 spaces
        assert!(!outcome.skip_rewrite);
        assert!(matches!(outcome.next_state.phase, FencePhase::Outside));
    }

    #[test]
    fn three_space_indent_opens_fence() {
        // CommonMark: up to 3 spaces is valid for fence opener
        let outcome = advance_fence_state("   ```js", FenceState::default());

        assert!(outcome.skip_rewrite);
        assert!(matches!(outcome.next_state.phase, FencePhase::InsideFence));
    }

    #[test]
    fn ignores_mismatched_marker() {
        let start = advance_fence_state("~~~ts", FenceState::default());
        let still_inside = advance_fence_state("```", start.next_state);

        assert!(still_inside.skip_rewrite);
        assert!(matches!(
            still_inside.next_state.phase,
            FencePhase::InsideFence
        ));
        assert_eq!(still_inside.next_state.marker, Some('~'));
    }

    #[test]
    fn requires_three_markers_to_open() {
        let outcome = advance_fence_state("``", FenceState::default());
        assert!(!outcome.skip_rewrite);
        assert!(matches!(outcome.next_state.phase, FencePhase::Outside));
    }

    #[test]
    fn fence_with_info_string_does_not_close() {
        let start = advance_fence_state("```", FenceState::default());
        let inside = advance_fence_state("content", start.next_state);
        // A fence with info string should not close the current fence
        let not_closed = advance_fence_state("```js", inside.next_state);

        // Should still be inside (```js is not a valid closer)
        assert!(not_closed.skip_rewrite);
        assert!(matches!(
            not_closed.next_state.phase,
            FencePhase::InsideFence
        ));
    }

    #[test]
    fn four_backtick_fence_contains_three_backtick() {
        // 4-backtick fence should not close on 3-backtick line
        let start = advance_fence_state("````markdown", FenceState::default());
        assert!(start.skip_rewrite);
        assert!(matches!(start.next_state.phase, FencePhase::InsideFence));
        assert_eq!(start.next_state.marker, Some('`'));
        assert_eq!(start.next_state.length, 4);

        // Inner 3-backtick opening should NOT close the fence
        let inner_open = advance_fence_state("```js", start.next_state);
        assert!(inner_open.skip_rewrite);
        assert!(matches!(
            inner_open.next_state.phase,
            FencePhase::InsideFence
        ));
        assert_eq!(inner_open.next_state.length, 4); // Still tracking outer fence

        // Content inside inner block
        let content = advance_fence_state(":::note", inner_open.next_state);
        assert!(content.skip_rewrite);
        assert!(matches!(content.next_state.phase, FencePhase::InsideFence));

        // Inner 3-backtick closing should NOT close the outer fence
        let inner_close = advance_fence_state("```", content.next_state);
        assert!(inner_close.skip_rewrite);
        assert!(matches!(
            inner_close.next_state.phase,
            FencePhase::InsideFence
        ));

        // 4-backtick closing SHOULD close the fence
        let outer_close = advance_fence_state("````", inner_close.next_state);
        assert!(outer_close.skip_rewrite);
        assert!(matches!(outer_close.next_state.phase, FencePhase::Outside));
    }

    #[test]
    fn longer_fence_closes_shorter_opener() {
        // A 5-backtick closer can close a 3-backtick opener
        let start = advance_fence_state("```", FenceState::default());
        assert_eq!(start.next_state.length, 3);

        let inner = advance_fence_state("content", start.next_state);
        let close = advance_fence_state("`````", inner.next_state);

        assert!(close.skip_rewrite);
        assert!(matches!(close.next_state.phase, FencePhase::Outside));
    }

    #[test]
    fn indented_closer_closes_unindented_fence() {
        // CommonMark: closing fence can be indented up to 3 spaces regardless of opener
        let start = advance_fence_state("```", FenceState::default());
        let inner = advance_fence_state("code", start.next_state);
        let closed = advance_fence_state("  ```", inner.next_state); // 2-space indent

        assert!(closed.skip_rewrite);
        assert!(matches!(closed.next_state.phase, FencePhase::Outside));
    }
}
