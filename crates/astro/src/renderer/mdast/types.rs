//! Type definitions for the mdast renderer.

use serde::Serialize;
use std::collections::HashMap;

/// A component prop value - either a literal string or a JS expression.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PropValue {
    /// A literal string value (from key="value").
    Literal { value: String },
    /// A JS expression (from key={expression}).
    Expression { value: String },
}

impl PropValue {
    /// Creates a literal string prop value.
    pub fn literal(value: impl Into<String>) -> Self {
        PropValue::Literal {
            value: value.into(),
        }
    }

    /// Creates an expression prop value.
    pub fn expression(value: impl Into<String>) -> Self {
        PropValue::Expression {
            value: value.into(),
        }
    }

    /// Returns the raw value regardless of type.
    pub fn value(&self) -> &str {
        match self {
            PropValue::Literal { value } | PropValue::Expression { value } => value,
        }
    }

    /// Returns true if this is an expression.
    pub fn is_expression(&self) -> bool {
        matches!(self, PropValue::Expression { .. })
    }
}

/// Represents a rendering block to be passed to Astro.
///
/// Each block is either plain HTML content, a code block, or a component
/// invocation with props and slot content.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RenderBlock {
    /// Plain HTML content to be rendered with Astro's Fragment.
    Html {
        /// The HTML content string.
        content: String,
    },

    /// An Astro component to be dynamically rendered.
    Component {
        /// Component name (e.g., "note", "card").
        name: String,
        /// Component props as key-value pairs (literals or expressions).
        props: HashMap<String, PropValue>,
        /// Structured children for the component's default slot.
        slot_children: Vec<RenderBlock>,
    },

    /// A code block to be processed by ExpressiveCode or Shiki.
    Code {
        /// The code content.
        code: String,
        /// Optional language identifier.
        lang: Option<String>,
        /// Optional meta string (e.g., for line highlighting).
        meta: Option<String>,
    },
}

/// Heading metadata extracted during rendering.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct HeadingEntry {
    /// Heading depth (1-6).
    pub depth: u8,
    /// Slugified identifier.
    pub slug: String,
    /// Visible heading text.
    pub text: String,
}

/// Result of parsing markdown to blocks with extracted metadata.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BlocksResult {
    /// Rendering blocks (HTML or Component).
    pub blocks: Vec<RenderBlock>,
    /// Extracted heading metadata.
    pub headings: Vec<HeadingEntry>,
}

/// Represents the type of scope currently being rendered.
///
/// Used in the Context stack to track which HTML element we are currently
/// inside of (e.g., inside a paragraph, inside a list, inside an Aside component).
#[derive(Debug, Clone, PartialEq)]
pub enum Scope {
    /// Document root - not inside any specific block element.
    Root,
    /// Inside a paragraph element (`<p>`).
    Paragraph,
    /// Inside a list element (`<ul>` or `<ol>`).
    List { spread: bool },
    /// Inside a table element (`<table>`).
    Table,
    /// Inside a table row element (`<tr>`).
    TableRow,
    /// Inside a table cell element (`<td>` or `<th>`).
    TableCell,
    /// Inside an Aside component with associated metadata.
    Aside(AsideMeta),
    /// Inside a Card component with associated metadata.
    Card(CardMeta),
}

/// Metadata for Aside components.
///
/// Stores the type of aside (e.g., "note", "warning", "tip") and an optional title.
#[derive(Debug, Clone, PartialEq)]
pub struct AsideMeta {
    /// The kind of aside (e.g., "note", "warning", "caution").
    pub kind: String,
    /// Optional title to display in the aside header.
    pub title: Option<String>,
}

/// Metadata for Card components.
///
/// Stores the card's title and an optional icon identifier.
#[derive(Debug, Clone, PartialEq)]
pub struct CardMeta {
    /// The title to display in the card header.
    pub title: String,
    /// Optional icon identifier for the card.
    pub icon: Option<String>,
}
