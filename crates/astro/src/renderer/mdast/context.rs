//! Rendering context for the mdast renderer.

use super::Options;
use super::types::{BlocksResult, HeadingEntry, PropValue, RenderBlock, Scope};
use crate::RegistryConfig;
use crate::registry::defaults::default_starlight_registry;
use markdown::mdast::Node;
use std::collections::HashMap;
use xmdx_core::Slugger;

/// Normalizes a footnote identifier for use in HTML fragment IDs.
///
/// GFM footnote labels can contain whitespace and punctuation (e.g. `[^my note]`).
/// Raw identifiers cannot be used directly in `id` / `href` fragments because
/// spaces and special characters produce invalid or unreliable fragment targets.
/// This function converts the identifier to a safe slug: lowercase, spaces → hyphens,
/// ASCII alphanumeric/hyphens/underscores and Unicode letters/digits are kept.
pub(super) fn sanitize_footnote_id(id: &str) -> String {
    let mut result = String::with_capacity(id.len());
    for c in id.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            result.push(c.to_ascii_lowercase());
        } else if c.is_alphabetic() || c.is_numeric() {
            // Preserve non-ASCII letters/digits (Unicode)
            for lc in c.to_lowercase() {
                result.push(lc);
            }
        } else if c == ' ' || c == '\t' {
            result.push('-');
        }
        // Other chars (punctuation, etc.) are dropped
    }
    if result.is_empty() {
        result.push_str("fn");
    }
    result
}

/// Escapes a string for use in an HTML attribute value.
pub(super) fn escape_html_attr(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '&' => result.push_str("&amp;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&#39;"),
            _ => result.push(c),
        }
    }
    result
}

/// Escapes code text for HTML output (including JSX braces and newlines).
fn escape_code_text(s: &str) -> String {
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

/// Converts blocks to inline HTML for use in list/table contexts.
///
/// This is used when rendering components inside lists or tables where
/// block-level structure must be avoided.
fn blocks_to_inline_html(component_name: &str, blocks: &[RenderBlock]) -> String {
    let mut result = String::new();
    for block in blocks {
        match block {
            RenderBlock::Html { content } => {
                // Escape braces for Fragment slots so JSX text does not become expressions
                let escaped = if component_name == "Fragment" {
                    crate::codegen::escape_jsx_braces(content)
                } else {
                    content.clone()
                };
                result.push_str(&escaped);
            }
            RenderBlock::Code { code, lang, .. } => {
                // Render code block as HTML
                result.push_str(r#"<pre class="astro-code" tabindex="0">"#);
                if let Some(l) = lang {
                    result.push_str(&format!(
                        r#"<code class="language-{}">"#,
                        escape_html_attr(l)
                    ));
                } else {
                    result.push_str("<code>");
                }
                result.push_str(&escape_code_text(code));
                result.push_str("</code></pre>");
            }
            RenderBlock::Component {
                name,
                props,
                slot_children,
            } => {
                let slot_html = if name == "Fragment" {
                    blocks_to_inline_html("Fragment", slot_children)
                } else {
                    blocks_to_inline_html(name, slot_children)
                };

                // Render nested components as JSX with props preserved
                result.push('<');
                result.push_str(name);

                // Render props as JSX: key={"value"} or key={expression}
                for (key, prop_value) in props {
                    result.push(' ');
                    result.push_str(key);

                    // For 'slot' attribute on Fragment, use HTML attribute syntax not JSX expression
                    // Astro's slot system expects slot="name" not slot={"name"}
                    if name == "Fragment"
                        && key == "slot"
                        && let PropValue::Literal { value } = prop_value
                    {
                        result.push_str("=\"");
                        result.push_str(&escape_html_attr(value));
                        result.push('"');
                        continue;
                    }

                    // Default JSX expression syntax for other props
                    result.push_str("={");
                    match prop_value {
                        PropValue::Literal { value } => {
                            result.push('"');
                            result.push_str(&crate::codegen::escape_js_string_value(value));
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
                result.push_str(name);
                result.push('>');
            }
        }
    }
    result
}

/// Manages the current rendering state with block-based architecture.
///
/// This struct tracks the rendering context as we traverse the markdown AST,
/// maintaining a list of completed blocks and a current HTML buffer for
/// content that hasn't been finalized into a block yet.
pub struct Context<'a> {
    /// Completed rendering blocks (HTML or Component).
    pub blocks: Vec<RenderBlock>,

    /// Current HTML buffer (not yet finalized into a block).
    pub current_html: String,

    /// Extracted heading metadata for table of contents.
    pub headings: Vec<HeadingEntry>,

    /// Slugger for generating unique heading IDs.
    slugger: Slugger,

    stack: Vec<Scope>,
    #[allow(dead_code)]
    options: &'a Options,

    /// Component registry for directive and component mappings.
    registry: RegistryConfig,

    /// Pending footnote definitions collected during rendering.
    /// Each entry is `(identifier, children_html)` — the `<li>` wrapper and
    /// backref links are built at `finish()` time once total ref counts are known.
    pending_footnotes: Vec<(String, String)>,

    /// Per-identifier reference counter for footnotes.
    /// Used to generate unique IDs when the same footnote is referenced multiple times.
    footnote_ref_counts: HashMap<String, usize>,

    /// Maps sanitized footnote IDs → original identifier that first claimed it.
    /// Used to detect and resolve collisions when different identifiers
    /// produce the same sanitized form.
    footnote_safe_ids: HashMap<String, String>,

    /// Maps footnote identifier → ordinal number (1-indexed, assigned on first reference).
    footnote_ordinals: HashMap<String, usize>,

    /// Next ordinal to assign.
    footnote_ordinal_counter: usize,
}

impl<'a> Context<'a> {
    /// Creates a new context with default Starlight registry.
    pub fn new(options: &'a Options) -> Self {
        Self::with_registry(options, None)
    }

    /// Creates a new context with a custom registry.
    ///
    /// If `registry` is None, the default Starlight registry is used.
    pub fn with_registry(options: &'a Options, registry: Option<RegistryConfig>) -> Self {
        Self {
            blocks: Vec::new(),
            current_html: String::with_capacity(4096),
            headings: Vec::new(),
            slugger: Slugger::new(),
            stack: vec![Scope::Root],
            options,
            registry: registry.unwrap_or_else(default_starlight_registry),
            pending_footnotes: Vec::new(),
            footnote_ref_counts: HashMap::new(),
            footnote_safe_ids: HashMap::new(),
            footnote_ordinals: HashMap::new(),
            footnote_ordinal_counter: 0,
        }
    }

    /// Returns a reference to the component registry.
    pub fn registry(&self) -> &RegistryConfig {
        &self.registry
    }

    /// Writes a raw string to the current HTML buffer without escaping (for safe HTML tags).
    pub fn push_raw(&mut self, s: &str) {
        self.current_html.push_str(s);
    }

    /// Writes text content to the buffer with HTML escaping (public API).
    pub fn push_text(&mut self, s: &str) {
        self.push_escaped(s);
    }

    /// Writes code content to the buffer with JSX-safe escaping.
    ///
    /// This escapes curly braces in addition to HTML entities to prevent
    /// JSX interpreting `{` and `}` as expression delimiters within code blocks.
    pub fn push_code_text(&mut self, s: &str) {
        for c in s.chars() {
            match c {
                '<' => self.current_html.push_str("&lt;"),
                '>' => self.current_html.push_str("&gt;"),
                '&' => self.current_html.push_str("&amp;"),
                '`' => self.current_html.push_str("&#96;"),
                '{' => self.current_html.push_str("&#123;"),
                '}' => self.current_html.push_str("&#125;"),
                // Encode newlines as HTML entities to prevent esbuild's JSX
                // transform from stripping them (esbuild normalizes whitespace
                // in JSX text children, converting \n to spaces)
                '\n' => self.current_html.push_str("&#10;"),
                _ => self.current_html.push(c),
            }
        }
    }

    /// Writes HTML-escaped text to the current HTML buffer (internal use).
    ///
    /// Escapes `<`, `>`, `&`, and `` ` `` characters for safe text node rendering.
    /// Backticks are escaped to prevent template literal injection in JSX contexts.
    /// Curly braces are also escaped so JSX text nodes cannot be interpreted as
    /// embedded expressions (e.g. `{ foo }` inside component slots).
    fn push_escaped(&mut self, s: &str) {
        for c in s.chars() {
            match c {
                '<' => self.current_html.push_str("&lt;"),
                '>' => self.current_html.push_str("&gt;"),
                '&' => self.current_html.push_str("&amp;"),
                '`' => self.current_html.push_str("&#96;"),
                '{' => self.current_html.push_str("&#123;"),
                '}' => self.current_html.push_str("&#125;"),
                _ => self.current_html.push(c),
            }
        }
    }

    /// Writes HTML-escaped attribute value to the current HTML buffer (internal use).
    ///
    /// Escapes `<`, `>`, `&`, `"`, and `'` for safe attribute rendering.
    pub fn push_attr_value(&mut self, s: &str) {
        for c in s.chars() {
            match c {
                '<' => self.current_html.push_str("&lt;"),
                '>' => self.current_html.push_str("&gt;"),
                '&' => self.current_html.push_str("&amp;"),
                '"' => self.current_html.push_str("&quot;"),
                '\'' => self.current_html.push_str("&#39;"),
                _ => self.current_html.push(c),
            }
        }
    }

    /// Returns a reference to the current scope at the top of the stack.
    pub fn current_scope(&self) -> &Scope {
        self.stack.last().unwrap_or(&Scope::Root)
    }

    /// Returns true if any scope in the stack is a List.
    ///
    /// Used to determine if JSX components should be rendered inline
    /// to avoid fragmenting list structures.
    pub fn is_in_list(&self) -> bool {
        self.stack
            .iter()
            .any(|scope| matches!(scope, Scope::List { .. }))
    }

    /// Returns true if inside a tight (non-spread) list.
    ///
    /// Used to suppress `<p>` wrappers around list item content when the
    /// list is tight, matching the CommonMark distinction between tight
    /// and loose lists.
    pub fn is_in_tight_list(&self) -> bool {
        self.stack
            .iter()
            .rev()
            .find(|scope| matches!(scope, Scope::List { .. }))
            .is_some_and(|scope| matches!(scope, Scope::List { spread: false }))
    }

    /// Returns true if any scope in the stack is within a table structure.
    ///
    /// Table content must remain phrasing content; inserting block
    /// boundaries inside <table>/<tr>/<td> produces invalid HTML.
    pub fn is_in_table(&self) -> bool {
        self.stack
            .iter()
            .any(|scope| matches!(scope, Scope::Table | Scope::TableRow | Scope::TableCell))
    }

    /// Returns true if currently in a paragraph scope.
    ///
    /// Inline JSX elements inside paragraphs should be rendered inline
    /// to avoid fragmenting the paragraph HTML structure.
    pub fn is_in_paragraph(&self) -> bool {
        self.stack
            .iter()
            .any(|scope| matches!(scope, Scope::Paragraph))
    }

    /// Enters a new scope by pushing it onto the stack.
    pub fn enter(&mut self, scope: Scope) {
        self.stack.push(scope);
    }

    /// Exits the current scope by popping from the stack.
    pub fn exit(&mut self) -> Option<Scope> {
        self.stack.pop()
    }

    /// Finalizes the current HTML buffer into an HTML block.
    ///
    /// This moves any pending HTML content from `current_html` into the `blocks` list.
    /// If the current HTML buffer is empty, this is a no-op.
    pub fn flush_html(&mut self) {
        if !self.current_html.is_empty() {
            let content = std::mem::take(&mut self.current_html);
            self.blocks.push(RenderBlock::Html { content });
        }
    }

    /// Adds a component block to the rendering output.
    ///
    /// This first flushes any pending HTML, then adds a Component block.
    pub fn push_component(
        &mut self,
        name: &str,
        props: HashMap<String, PropValue>,
        slot_children: Vec<RenderBlock>,
    ) {
        self.flush_html();
        self.blocks.push(RenderBlock::Component {
            name: name.to_string(),
            props,
            slot_children,
        });
    }

    /// Renders a code block inline to the HTML buffer.
    ///
    /// Used when inside a list or table to avoid fragmenting the structure
    /// by flushing HTML and emitting a separate `RenderBlock::Code`.
    pub fn push_code_inline(&mut self, code: &str, lang: Option<&str>) {
        self.current_html
            .push_str(r#"<pre class="astro-code" tabindex="0">"#);
        if let Some(l) = lang {
            self.current_html.push_str(&format!(
                r#"<code class="language-{}">"#,
                escape_html_attr(l)
            ));
        } else {
            self.current_html.push_str("<code>");
        }
        self.current_html.push_str(&escape_code_text(code));
        self.current_html.push_str("</code></pre>");
    }

    /// Renders a component inline to the HTML buffer as JSX.
    ///
    /// Used when inside a list to avoid fragmenting the list structure.
    /// Instead of creating a separate Component block (which would flush
    /// the HTML buffer), this writes the component directly as JSX syntax.
    pub fn push_component_inline(
        &mut self,
        name: &str,
        props: &HashMap<String, PropValue>,
        slot_children: &[RenderBlock],
    ) {
        // Convert slot_children to inline HTML string
        let slot_html = blocks_to_inline_html(name, slot_children);

        self.current_html.push('<');
        self.current_html.push_str(name);

        for (key, prop_value) in props {
            self.current_html.push(' ');
            self.current_html.push_str(key);

            // For 'slot' attribute on Fragment, use HTML attribute syntax not JSX expression
            // Astro's slot system expects slot="name" not slot={"name"}
            if name == "Fragment"
                && key == "slot"
                && let PropValue::Literal { value } = prop_value
            {
                self.current_html.push_str("=\"");
                self.push_attr_value(value);
                self.current_html.push('"');
                continue;
            }

            // Default JSX expression syntax for other props
            self.current_html.push_str("={");
            match prop_value {
                PropValue::Literal { value } => {
                    self.current_html.push('"');
                    self.current_html
                        .push_str(&crate::codegen::escape_js_string_value(value));
                    self.current_html.push('"');
                }
                PropValue::Expression { value } => {
                    self.current_html.push_str(value);
                }
            }
            self.current_html.push('}');
        }

        self.current_html.push('>');
        self.current_html.push_str(&slot_html);
        self.current_html.push_str("</");
        self.current_html.push_str(name);
        self.current_html.push('>');
    }

    /// Renders child nodes to a Vec of blocks (for component slots).
    ///
    /// Creates a temporary context to render the children, returning all
    /// resulting blocks as structured data for further processing.
    ///
    /// **Important:** This also bubbles up any headings found in the children
    /// to the parent context, ensuring JSX component content appears in the TOC.
    pub fn render_children_to_blocks(&mut self, children: &[Node]) -> Vec<RenderBlock> {
        // Import render_node here to avoid circular dependency at module level
        use super::render::render_node;

        // Clone registry to pass to child context
        let mut child_ctx = Context::with_registry(self.options, Some(self.registry.clone()));

        // Seed the child context with the parent's footnote state so footnotes
        // inside components get correct document-level ordinals and ref counts.
        child_ctx.footnote_ordinals = self.footnote_ordinals.clone();
        child_ctx.footnote_ordinal_counter = self.footnote_ordinal_counter;
        child_ctx.footnote_ref_counts = self.footnote_ref_counts.clone();
        child_ctx.footnote_safe_ids = self.footnote_safe_ids.clone();

        for child in children {
            render_node(child, &mut child_ctx);
        }
        child_ctx.flush_html();

        // Bubble up headings from child context to parent (for TOC)
        self.headings.append(&mut child_ctx.headings);

        // Bubble up footnote definitions from child context to parent
        self.pending_footnotes
            .append(&mut child_ctx.pending_footnotes);

        // Absorb the child's updated footnote state back into the parent
        self.footnote_ref_counts = std::mem::take(&mut child_ctx.footnote_ref_counts);
        self.footnote_ordinals = std::mem::take(&mut child_ctx.footnote_ordinals);
        self.footnote_ordinal_counter = child_ctx.footnote_ordinal_counter;
        self.footnote_safe_ids = std::mem::take(&mut child_ctx.footnote_safe_ids);

        child_ctx.blocks
    }

    /// Renders child nodes to an HTML string for inline embedding.
    ///
    /// Used when children need to be embedded directly in the HTML buffer
    /// (e.g., FileTree slot normalization). Code blocks are converted to HTML.
    pub fn render_children_to_html(&mut self, children: &[Node]) -> String {
        let blocks = self.render_children_to_blocks(children);
        blocks_to_inline_html("", &blocks)
    }

    /// Generates a unique slug for a heading.
    pub fn generate_slug(&mut self, text: &str) -> String {
        self.slugger.next_slug(text)
    }

    /// Reserves a slug so future auto-generated slugs won't collide with it.
    pub fn reserve_slug(&mut self, slug: &str) {
        self.slugger.reserve(slug);
    }

    /// Adds a heading entry to the list of headings.
    pub fn add_heading(&mut self, entry: HeadingEntry) {
        self.headings.push(entry);
    }

    /// Returns whether lazy image loading is enabled.
    pub fn lazy_images_enabled(&self) -> bool {
        self.options.lazy_images()
    }

    /// Returns whether raw HTML passthrough is enabled.
    pub fn raw_html_allowed(&self) -> bool {
        self.options.allow_raw_html()
    }

    /// Returns whether heading autolinks are enabled.
    pub fn heading_autolinks_enabled(&self) -> bool {
        self.options.heading_autolinks()
    }

    /// Increments and returns the ref count for a footnote identifier (1-indexed).
    pub fn next_footnote_ref_count(&mut self, id: &str) -> usize {
        let count = self.footnote_ref_counts.entry(id.to_string()).or_insert(0);
        *count += 1;
        *count
    }

    /// Returns total ref count for a footnote identifier.
    pub fn footnote_ref_count(&self, id: &str) -> usize {
        self.footnote_ref_counts.get(id).copied().unwrap_or(0)
    }

    /// Adds a footnote definition (children HTML only) to be aggregated at finish time.
    ///
    /// The `<li>` wrapper and backref links are built in `finish()` once total
    /// ref counts are known, so repeated references get correct backref anchors.
    pub fn push_footnote(&mut self, id: String, children_html: String) {
        self.pending_footnotes.push((id, children_html));
    }

    /// Returns a unique sanitized ID for a footnote identifier.
    /// On first call for a given identifier, sanitizes and reserves the ID.
    /// If a different identifier already claimed the same sanitized form,
    /// appends a numeric suffix to disambiguate.
    pub fn get_safe_footnote_id(&mut self, id: &str) -> String {
        // Check if this exact identifier already has an assigned safe ID
        // (reuse across repeated references to the same footnote)
        for (safe, orig) in &self.footnote_safe_ids {
            if orig == id {
                return safe.clone();
            }
        }
        let mut safe = sanitize_footnote_id(id);
        if let Some(existing_orig) = self.footnote_safe_ids.get(&safe) {
            if existing_orig != id {
                // Collision: different identifier mapped to same safe_id
                let base = safe.clone();
                let mut n = 2;
                loop {
                    safe = format!("{}-{}", base, n);
                    if !self.footnote_safe_ids.contains_key(&safe) {
                        break;
                    }
                    n += 1;
                }
            }
        }
        self.footnote_safe_ids.insert(safe.clone(), id.to_string());
        safe
    }

    /// Returns the ordinal for a footnote identifier, assigning the next
    /// sequential ordinal on first encounter.
    pub fn get_or_assign_footnote_ordinal(&mut self, id: &str) -> usize {
        if let Some(&ordinal) = self.footnote_ordinals.get(id) {
            ordinal
        } else {
            self.footnote_ordinal_counter += 1;
            let ordinal = self.footnote_ordinal_counter;
            self.footnote_ordinals.insert(id.to_string(), ordinal);
            ordinal
        }
    }

    /// Consumes the context and returns the list of rendering blocks.
    pub fn finish(mut self) -> BlocksResult {
        self.flush_html();

        // Emit a single aggregated footnotes section if any definitions were collected
        if !self.pending_footnotes.is_empty() {
            // Sort definitions by first-reference order (ordinal).
            // Unreferenced definitions (no ordinal) sort to the end.
            let ordinals = &self.footnote_ordinals;
            self.pending_footnotes.sort_by_key(|(id, _)| {
                ordinals.get(id).copied().unwrap_or(usize::MAX)
            });

            // Pre-compute safe IDs for all pending footnotes to avoid borrow conflicts.
            let ids: Vec<String> = self
                .pending_footnotes
                .iter()
                .map(|(id, _)| id.clone())
                .collect();
            let safe_ids: Vec<String> = ids.iter().map(|id| self.get_safe_footnote_id(id)).collect();

            let mut section = String::new();
            section.push_str("<section data-footnotes class=\"footnotes\"><h2 class=\"sr-only\" id=\"footnote-label\">Footnotes</h2><ol>");
            for (i, (id, children_html)) in self.pending_footnotes.iter().enumerate() {
                let total_refs = self.footnote_ref_count(id);
                let safe_id = &safe_ids[i];

                section.push_str("<li id=\"user-content-fn-");
                section.push_str(&safe_id);
                section.push_str("\">");
                section.push_str(children_html);

                // Build backref links (skip if no references exist)
                if total_refs == 1 {
                    // Single reference: one backref without suffix
                    section.push_str(" <a href=\"#user-content-fnref-");
                    section.push_str(&safe_id);
                    section.push_str("\" data-footnote-backref class=\"footnote-backref\" aria-label=\"Back to reference\">\u{21a9}</a>");
                } else {
                    // Multiple references: one backref per reference
                    for n in 1..=total_refs {
                        section.push(' ');
                        section.push_str("<a href=\"#user-content-fnref-");
                        section.push_str(&safe_id);
                        if n > 1 {
                            section.push_str(&format!("-{}", n));
                        }
                        section.push_str("\" data-footnote-backref class=\"footnote-backref\" aria-label=\"Back to reference\">\u{21a9}");
                        if n > 1 {
                            section.push_str(&format!("<sup>{}</sup>", n));
                        }
                        section.push_str("</a>");
                    }
                }

                section.push_str("</li>");
            }
            section.push_str("</ol></section>");
            self.blocks.push(RenderBlock::Html { content: section });
        }

        BlocksResult {
            blocks: self.blocks,
            headings: self.headings,
        }
    }
}
