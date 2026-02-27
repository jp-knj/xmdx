//! Markdown parsing utilities and extension hooks.

use crate::{MarkflowError, SourceLocation};
use markdown::mdast::Node;
use markdown::message::{Message, Place};
use std::borrow::Cow;

/// Parser options for building markdown-rs parse options.
#[derive(Clone, Copy, Debug)]
pub struct ParseOptions {
    /// Enable MDX constructs (JSX, ESM, expressions).
    pub mdx: bool,
    /// Enable GitHub Flavored Markdown constructs.
    pub gfm: bool,
    /// Enable YAML frontmatter parsing.
    pub frontmatter: bool,
    /// Enable indented code blocks.
    pub code_indented: bool,
    /// Allow raw HTML nodes in the AST.
    pub raw_html: bool,
    /// Enable math constructs ($inline$ and $$block$$).
    pub math: bool,
}

impl ParseOptions {
    /// Markdown-friendly defaults (no MDX).
    pub const fn markdown() -> Self {
        Self {
            mdx: false,
            gfm: true,
            frontmatter: true,
            code_indented: true,
            raw_html: false,
            math: false,
        }
    }

    /// MDX-friendly defaults (JSX/ESM/expression enabled).
    pub const fn mdx() -> Self {
        Self {
            mdx: true,
            gfm: true,
            frontmatter: true,
            code_indented: false,
            raw_html: false,
            math: false,
        }
    }

    /// Convert to markdown-rs `ParseOptions`.
    pub fn to_markdown(self) -> markdown::ParseOptions {
        let mut constructs = markdown::Constructs {
            frontmatter: self.frontmatter,
            code_indented: self.code_indented,
            html_flow: self.raw_html,
            html_text: self.raw_html,
            ..Default::default()
        };

        if self.gfm {
            constructs.gfm_autolink_literal = true;
            constructs.gfm_footnote_definition = true;
            constructs.gfm_label_start_footnote = true;
            constructs.gfm_strikethrough = true;
            constructs.gfm_table = true;
            constructs.gfm_task_list_item = true;
        }

        if self.mdx {
            constructs.mdx_esm = true;
            constructs.mdx_expression_flow = true;
            constructs.mdx_expression_text = true;
            constructs.mdx_jsx_flow = true;
            constructs.mdx_jsx_text = true;
        }

        if self.math {
            constructs.math_flow = true;
            constructs.math_text = true;
        }

        markdown::ParseOptions {
            constructs,
            math_text_single_dollar: self.math,
            ..markdown::ParseOptions::default()
        }
    }
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self::markdown()
    }
}

/// Trait for preprocessing raw markdown text before parsing.
pub trait TextTransform {
    /// Transform the input markdown text, returning an owned or borrowed string.
    fn transform<'a>(&self, input: &'a str) -> Cow<'a, str>;
}

impl<F> TextTransform for F
where
    F: for<'a> Fn(&'a str) -> Cow<'a, str>,
{
    fn transform<'a>(&self, input: &'a str) -> Cow<'a, str> {
        (self)(input)
    }
}

/// Trait for mutating the parsed MDAST after parsing.
pub trait AstTransform {
    /// Mutate the parsed markdown AST in place.
    fn transform(&self, root: &mut Node);
}

impl<F> AstTransform for F
where
    F: Fn(&mut Node),
{
    fn transform(&self, root: &mut Node) {
        (self)(root)
    }
}

/// Configurable parsing pipeline with optional transforms.
pub struct ParserPipeline {
    options: markdown::ParseOptions,
    text_transforms: Vec<Box<dyn TextTransform>>,
    ast_transforms: Vec<Box<dyn AstTransform>>,
}

impl ParserPipeline {
    /// Create a new pipeline from markdown-rs parse options.
    pub fn new(options: markdown::ParseOptions) -> Self {
        Self {
            options,
            text_transforms: Vec::new(),
            ast_transforms: Vec::new(),
        }
    }

    /// Add a text preprocessor transform.
    pub fn add_text_transform<T: TextTransform + 'static>(&mut self, transform: T) {
        self.text_transforms.push(Box::new(transform));
    }

    /// Add an AST transform.
    pub fn add_ast_transform<T: AstTransform + 'static>(&mut self, transform: T) {
        self.ast_transforms.push(Box::new(transform));
    }

    /// Parse markdown into MDAST using the configured pipeline.
    pub fn parse(&self, input: &str) -> Result<Node, MarkflowError> {
        let mut current = Cow::Borrowed(input);
        for transform in &self.text_transforms {
            let next = transform.transform(current.as_ref());
            current = Cow::Owned(next.into_owned());
        }

        let mut root = parse_mdast_with_options(&current, &self.options)?;
        for transform in &self.ast_transforms {
            transform.transform(&mut root);
        }

        Ok(root)
    }
}

/// Parse markdown into an MDAST tree using core options.
pub fn parse_mdast(input: &str, options: &ParseOptions) -> Result<Node, MarkflowError> {
    parse_mdast_with_options(input, &options.to_markdown())
}

/// Parse markdown into an MDAST tree using markdown-rs `ParseOptions`.
pub fn parse_mdast_with_options(
    input: &str,
    options: &markdown::ParseOptions,
) -> Result<Node, MarkflowError> {
    markdown::to_mdast(input, options).map_err(|err| MarkflowError::MarkdownAdapter {
        message: err.to_string(),
        location: message_location(&err),
    })
}

fn message_location(message: &Message) -> SourceLocation {
    match &message.place {
        Some(place) => match place.as_ref() {
            Place::Point(point) => SourceLocation::new(point.line, point.column),
            Place::Position(position) => {
                SourceLocation::new(position.start.line, position.start.column)
            }
        },
        None => SourceLocation::new(1, 1),
    }
}
