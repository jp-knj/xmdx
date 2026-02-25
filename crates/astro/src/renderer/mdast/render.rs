//! Rendering functions for the mdast renderer.

use super::context::Context;
use super::types::{HeadingEntry, PropValue, RenderBlock, Scope};
use markdown::mdast::Node;
use std::collections::BTreeMap;
use xmdx_core::slug::extract_custom_id;

/// Extracts plain text from a list of AST nodes (for heading text).
///
/// This recursively traverses the nodes and collects all text content,
/// which is used for generating slugs and table of contents entries.
pub fn extract_text_from_nodes(nodes: &[Node]) -> String {
    let mut text = String::new();
    for node in nodes {
        extract_text_from_node(node, &mut text);
    }
    text.trim().to_string()
}

/// Helper function to recursively extract text from a single node.
fn extract_text_from_node(node: &Node, buffer: &mut String) {
    match node {
        Node::Text(t) => buffer.push_str(&t.value),
        Node::InlineCode(code) => buffer.push_str(&code.value),
        Node::Strong(strong) => {
            for child in &strong.children {
                extract_text_from_node(child, buffer);
            }
        }
        Node::Emphasis(emphasis) => {
            for child in &emphasis.children {
                extract_text_from_node(child, buffer);
            }
        }
        Node::Link(link) => {
            for child in &link.children {
                extract_text_from_node(child, buffer);
            }
        }
        Node::Delete(del) => {
            for child in &del.children {
                extract_text_from_node(child, buffer);
            }
        }
        // Ignore other node types in headings
        _ => {}
    }
}

/// Renders a list node as `<ul>` or `<ol>`.
fn render_list(list: &markdown::mdast::List, ctx: &mut Context) {
    let tag = if list.ordered { "ol" } else { "ul" };
    ctx.push_raw(&format!("<{}>", tag));
    ctx.enter(Scope::List {
        spread: list.spread,
    });

    for child in &list.children {
        render_node(child, ctx);
    }

    ctx.exit();
    ctx.push_raw(&format!("</{}>", tag));
}

/// Renders a list item node as `<li>`.
///
/// For task list items (GFM), adds `task-list-item` class and wraps content
/// in `<label><input><span>` to match the structure expected by rehype-tasklist-enhancer.
fn render_list_item(item: &markdown::mdast::ListItem, ctx: &mut Context) {
    let class_attr = if item.checked.is_some() {
        " class=\"task-list-item\""
    } else {
        ""
    };
    ctx.push_raw(&format!("<li{}>", class_attr));

    if let Some(checked) = item.checked {
        let checked_str = if checked { " checked" } else { "" };
        ctx.push_raw(&format!(
            "<label><input type=\"checkbox\" disabled{}/><span>",
            checked_str
        ));

        // Partition children: inline/phrasing content (up through the first
        // Paragraph) goes inside <label><span>, block children (nested List,
        // Blockquote, etc.) are rendered after </label> as siblings inside <li>.
        let mut found_paragraph = false;
        let mut block_children = Vec::new();
        for child in &item.children {
            if found_paragraph {
                block_children.push(child);
            } else {
                render_node(child, ctx);
                if matches!(child, Node::Paragraph(_)) {
                    found_paragraph = true;
                }
            }
        }

        ctx.push_raw("</span></label>");

        // Render block children (nested lists, etc.) after </label>
        for child in block_children {
            render_node(child, ctx);
        }
    } else {
        for child in &item.children {
            render_node(child, ctx);
        }
    }

    ctx.push_raw("</li>");
}

/// Helper function to render a table row with proper alignment.
fn render_table_row(
    row: &markdown::mdast::TableRow,
    ctx: &mut Context,
    is_header: bool,
    aligns: &[markdown::mdast::AlignKind],
) {
    ctx.push_raw("<tr>");
    ctx.enter(Scope::TableRow);

    for (i, cell) in row.children.iter().enumerate() {
        if let Node::TableCell(c) = cell {
            let tag = if is_header { "th" } else { "td" };

            let align_attr = if i < aligns.len() {
                match aligns[i] {
                    markdown::mdast::AlignKind::Left => " align=\"left\"",
                    markdown::mdast::AlignKind::Right => " align=\"right\"",
                    markdown::mdast::AlignKind::Center => " align=\"center\"",
                    markdown::mdast::AlignKind::None => "",
                }
            } else {
                ""
            };

            ctx.push_raw(&format!("<{}{}>", tag, align_attr));
            ctx.enter(Scope::TableCell);

            for child in &c.children {
                render_node(child, ctx);
            }

            ctx.exit(); // TableCell
            ctx.push_raw(&format!("</{}>", tag));
        }
    }

    ctx.exit(); // TableRow
    ctx.push_raw("</tr>");
}

/// Renders a JSX element (MDX) as either a component block or transparent container.
fn render_jsx(
    name: Option<&str>,
    attributes: &[markdown::mdast::AttributeContent],
    children: &[Node],
    ctx: &mut Context,
) {
    // 1. Fragment handling: <> ... </> has no name, just render children
    let Some(tag_name) = name else {
        for child in children {
            render_node(child, ctx);
        }
        return;
    };

    // 2. Handle internal directive container: <mf-directive name="..." title="...">...</mf-directive>
    if tag_name == "mf-directive" {
        let mut directive_type = "note".to_string();
        let mut title: Option<String> = None;

        for attr in attributes {
            if let markdown::mdast::AttributeContent::Property(prop) = attr {
                let val = match &prop.value {
                    Some(markdown::mdast::AttributeValue::Literal(s)) => s.clone(),
                    _ => String::new(),
                };

                match prop.name.as_str() {
                    "name" => directive_type = val,
                    "title" => {
                        title = Some(val.replace("&quot;", "\""));
                    }
                    _ => {}
                }
            }
        }

        // Look up the component name from the registry, defaulting to "Aside"
        // Clone to avoid borrow conflicts with ctx
        let component_name = ctx
            .registry()
            .get_directive_component(&directive_type)
            .unwrap_or("Aside")
            .to_string();

        let slot_children = ctx.render_children_to_blocks(children);

        let mut props = BTreeMap::new();
        props.insert("type".to_string(), PropValue::literal(directive_type));
        if let Some(t) = title {
            props.insert("title".to_string(), PropValue::literal(t));
        }

        if ctx.is_in_list() {
            ctx.push_component_inline(&component_name, &props, &slot_children);
        } else {
            ctx.push_component(&component_name, props, slot_children);
        }
        return;
    }

    // 3. Extract props from JSX attributes
    let mut props = BTreeMap::new();
    for attr in attributes {
        match attr {
            markdown::mdast::AttributeContent::Property(prop) => {
                let value = match &prop.value {
                    Some(markdown::mdast::AttributeValue::Literal(s)) => {
                        PropValue::literal(s.clone())
                    }
                    Some(markdown::mdast::AttributeValue::Expression(expr)) => {
                        PropValue::expression(expr.value.clone())
                    }
                    None => PropValue::literal(String::new()),
                };
                props.insert(prop.name.clone(), value);
            }
            markdown::mdast::AttributeContent::Expression(_) => {
                // Spread attributes not yet supported
            }
        }
    }

    // 5. Render children to structured blocks
    // Note: Slot normalization (Steps → <ol>, FileTree → <ul>) is handled in codegen.rs
    // based on registry configuration, not here.
    let slot_children = ctx.render_children_to_blocks(children);

    // 6. Special handling for Fragment with slot attribute
    if tag_name == "Fragment" && props.contains_key("slot") {
        // Keep slot fragments as standalone component blocks so downstream
        // codegen can safely escape braces inside the slot HTML.
        ctx.push_component(tag_name, props, slot_children);
        return;
    }

    // 7. Push as component block
    // Inline JSX elements inside paragraphs, lists, or tables should be
    // rendered inline to avoid fragmenting the HTML structure.
    if ctx.is_in_list() || ctx.is_in_table() || ctx.is_in_paragraph() {
        ctx.push_component_inline(tag_name, &props, &slot_children);
    } else {
        ctx.push_component(tag_name, props, slot_children);
    }
}

/// Renders a paragraph node, suppressing `<p>` wrappers in tight lists.
fn render_paragraph(para: &markdown::mdast::Paragraph, ctx: &mut Context) {
    let in_tight_list = ctx.is_in_tight_list();
    if !in_tight_list {
        ctx.push_raw("<p>");
        ctx.enter(Scope::Paragraph);
    }

    for child in &para.children {
        render_node(child, ctx);
    }

    if !in_tight_list {
        ctx.exit();
        ctx.push_raw("</p>");
    }
}

/// Renders a link node as `<a>`.
fn render_link(link: &markdown::mdast::Link, ctx: &mut Context) {
    ctx.push_raw(r#"<a href=""#);
    ctx.push_attr_value(&link.url);
    ctx.push_raw(r#"""#);

    if let Some(title) = &link.title {
        ctx.push_raw(r#" title=""#);
        ctx.push_attr_value(title);
        ctx.push_raw(r#"""#);
    }

    ctx.push_raw(">");

    for child in &link.children {
        render_node(child, ctx);
    }

    ctx.push_raw("</a>");
}

/// Walks the AST to find a `{#custom-id}` only in the last Text node.
///
/// This avoids false positives from InlineCode nodes like `` `{#bar}` ``,
/// which should be treated as literal code, not custom heading IDs.
fn find_custom_id_in_last_text_node(nodes: &[Node]) -> Option<&str> {
    let last = nodes.last()?;
    match last {
        Node::Text(t) => {
            let (_, id) = extract_custom_id(&t.value);
            id
        }
        Node::Strong(s) => find_custom_id_in_last_text_node(&s.children),
        Node::Emphasis(e) => find_custom_id_in_last_text_node(&e.children),
        Node::Link(l) => find_custom_id_in_last_text_node(&l.children),
        Node::Delete(d) => find_custom_id_in_last_text_node(&d.children),
        _ => None, // InlineCode, Image, etc. — not custom ID
    }
}

/// Renders a heading node with slug-based id and TOC entry.
///
/// Supports `{#custom-id}` syntax: if the heading text ends with `{#some-id}`,
/// that ID is used as the slug instead of auto-generating one, and the `{#...}`
/// suffix is stripped from both the heading text metadata and the rendered output.
fn render_heading(heading: &markdown::mdast::Heading, ctx: &mut Context) {
    let raw_text = extract_text_from_nodes(&heading.children);
    let custom_id = find_custom_id_in_last_text_node(&heading.children);
    let clean_text = if custom_id.is_some() {
        let (text, _) = extract_custom_id(&raw_text);
        text
    } else {
        raw_text.as_str()
    };

    let slug = if let Some(id) = custom_id {
        ctx.reserve_slug(id);
        id.to_string()
    } else {
        ctx.generate_slug(clean_text)
    };

    ctx.add_heading(HeadingEntry {
        depth: heading.depth,
        slug: slug.clone(),
        text: clean_text.to_string(),
    });

    let tag = format!("h{}", heading.depth);
    ctx.push_raw(&format!("<{} id=\"{}\">", tag, slug));

    // Wrap heading content in an anchor if autolinks are enabled.
    // Skip when heading already contains a link to avoid invalid nested <a> elements.
    let autolink = ctx.heading_autolinks_enabled() && !children_contain_link(&heading.children);
    if autolink {
        ctx.push_raw("<a href=\"#");
        ctx.push_raw(&slug);
        ctx.push_raw("\">");
    }

    // Render children, stripping {#id} from the last Text node if present
    if custom_id.is_some() {
        render_heading_children(&heading.children, ctx);
    } else {
        for child in &heading.children {
            render_node(child, ctx);
        }
    }

    if autolink {
        ctx.push_raw("</a>");
    }

    ctx.push_raw(&format!("</{}>", tag));
}

/// Returns true if any node in the tree is a Link (anchor).
/// Used to prevent wrapping heading children in `<a>` when they already contain links,
/// which would produce invalid nested `<a>` elements.
fn children_contain_link(children: &[Node]) -> bool {
    for child in children {
        match child {
            Node::Link(_) => return true,
            Node::MdxJsxFlowElement(elem) if elem.name.as_deref() == Some("a") => {
                return true;
            }
            Node::MdxJsxTextElement(elem) if elem.name.as_deref() == Some("a") => {
                return true;
            }
            Node::Html(html) => {
                let lower = html.value.to_ascii_lowercase();
                if lower.contains("<a ") || lower.contains("<a>") {
                    return true;
                }
            }
            Node::MdxJsxFlowElement(elem) => {
                if children_contain_link(&elem.children) {
                    return true;
                }
            }
            Node::MdxJsxTextElement(elem) => {
                if children_contain_link(&elem.children) {
                    return true;
                }
            }
            Node::Strong(n) => {
                if children_contain_link(&n.children) {
                    return true;
                }
            }
            Node::Emphasis(n) => {
                if children_contain_link(&n.children) {
                    return true;
                }
            }
            Node::Delete(n) => {
                if children_contain_link(&n.children) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// Renders heading children, stripping the trailing `{#...}` from the deepest last Text descendant.
fn render_heading_children(children: &[Node], ctx: &mut Context) {
    if children.is_empty() {
        return;
    }

    let last_idx = children.len() - 1;
    for (i, child) in children.iter().enumerate() {
        if i == last_idx {
            render_node_stripping_custom_id(child, ctx);
        } else {
            render_node(child, ctx);
        }
    }
}

/// Renders a node, stripping a trailing `{#...}` from its deepest last Text descendant.
fn render_node_stripping_custom_id(node: &Node, ctx: &mut Context) {
    match node {
        Node::Text(text) => {
            if let Some(pos) = text.value.rfind("{#") {
                let trimmed = text.value[..pos].trim_end();
                ctx.push_text(trimmed);
            } else {
                ctx.push_text(&text.value);
            }
        }
        Node::Strong(strong) => {
            ctx.push_raw("<strong>");
            render_heading_children(&strong.children, ctx);
            ctx.push_raw("</strong>");
        }
        Node::Emphasis(em) => {
            ctx.push_raw("<em>");
            render_heading_children(&em.children, ctx);
            ctx.push_raw("</em>");
        }
        Node::Link(link) => {
            ctx.push_raw(r#"<a href=""#);
            ctx.push_attr_value(&link.url);
            ctx.push_raw(r#"""#);
            if let Some(title) = &link.title {
                ctx.push_raw(r#" title=""#);
                ctx.push_attr_value(title);
                ctx.push_raw(r#"""#);
            }
            ctx.push_raw(">");
            render_heading_children(&link.children, ctx);
            ctx.push_raw("</a>");
        }
        Node::Delete(del) => {
            ctx.push_raw("<del>");
            render_heading_children(&del.children, ctx);
            ctx.push_raw("</del>");
        }
        _ => render_node(node, ctx),
    }
}

/// Renders a code block, either inline (in lists/tables) or as a structured block.
fn render_code(code: &markdown::mdast::Code, ctx: &mut Context) {
    if ctx.is_in_list() || ctx.is_in_table() {
        // Render inline to avoid fragmenting list/table HTML structure
        ctx.push_code_inline(&code.value, code.lang.as_deref());
    } else {
        // Emit structured Code block for TypeScript processing (ExpressiveCode/Shiki)
        ctx.flush_html();
        ctx.blocks.push(RenderBlock::Code {
            code: code.value.clone(),
            lang: code.lang.clone(),
            meta: code.meta.clone(),
        });
    }
}

/// Renders an image node as `<img>`.
fn render_image(img: &markdown::mdast::Image, ctx: &mut Context) {
    ctx.push_raw(r#"<img src=""#);
    ctx.push_attr_value(&img.url);
    ctx.push_raw(r#"""#);

    ctx.push_raw(r#" alt=""#);
    ctx.push_attr_value(&img.alt);
    ctx.push_raw(r#"""#);

    if let Some(title) = &img.title {
        ctx.push_raw(r#" title=""#);
        ctx.push_attr_value(title);
        ctx.push_raw(r#"""#);
    }

    if ctx.lazy_images_enabled() {
        ctx.push_raw(r#" loading="lazy""#);
    }

    ctx.push_raw(" />");
}

/// Renders a table node as `<table>` with `<thead>` and optional `<tbody>`.
fn render_table(table: &markdown::mdast::Table, ctx: &mut Context) {
    ctx.enter(Scope::Table);
    ctx.push_raw("<table>");

    ctx.push_raw("<thead>");
    if let Some(Node::TableRow(row)) = table.children.first() {
        render_table_row(row, ctx, true, &table.align);
    }
    ctx.push_raw("</thead>");

    if table.children.len() > 1 {
        ctx.push_raw("<tbody>");
        for row in table.children.iter().skip(1) {
            if let Node::TableRow(r) = row {
                render_table_row(r, ctx, false, &table.align);
            }
        }
        ctx.push_raw("</tbody>");
    }

    ctx.push_raw("</table>");
    ctx.exit(); // Table
}

/// Renders raw HTML, either as passthrough or escaped based on options.
fn render_html(html: &markdown::mdast::Html, ctx: &mut Context) {
    if ctx.raw_html_allowed() {
        ctx.push_raw(&html.value);
    } else {
        // Reduce noise: escape silently when raw HTML is disabled.
        log::debug!(
            "Raw HTML in markdown will be escaped for security: {}",
            html.value
        );
        ctx.push_text(&html.value);
    }
}

/// Renders a blockquote node as `<blockquote>`.
fn render_blockquote(quote: &markdown::mdast::Blockquote, ctx: &mut Context) {
    ctx.push_raw("<blockquote>");
    for child in &quote.children {
        render_node(child, ctx);
    }
    ctx.push_raw("</blockquote>");
}

/// Renders a footnote reference as a superscript link `<sup><a href="#fn-id">[n]</a></sup>`.
///
/// The footnote index is determined by the order references appear in the document.
/// References link to the corresponding footnote definition.
/// Repeated references to the same footnote get suffixed IDs (fnref-id, fnref-id-2, fnref-id-3).
fn render_footnote_reference(fnref: &markdown::mdast::FootnoteReference, ctx: &mut Context) {
    let id = &fnref.identifier;
    let safe_id = ctx.get_safe_footnote_id(id);
    let ordinal = ctx.get_or_assign_footnote_ordinal(id);
    let ref_count = ctx.next_footnote_ref_count(id);
    let id_suffix = if ref_count == 1 {
        String::new()
    } else {
        format!("-{}", ref_count)
    };

    ctx.push_raw("<sup><a href=\"#user-content-fn-");
    ctx.push_raw(&safe_id);
    ctx.push_raw("\" id=\"user-content-fnref-");
    ctx.push_raw(&safe_id);
    ctx.push_raw(&id_suffix);
    ctx.push_raw("\" data-footnote-ref aria-describedby=\"footnote-label\">");
    ctx.push_raw(&ordinal.to_string());
    ctx.push_raw("</a></sup>");
}

/// Renders a footnote definition, deferring the `<li>` wrapper and backref links to `finish()`.
///
/// Only the children content is rendered here. The `<li>` element and backref
/// links are built at `finish()` time when total reference counts are known,
/// allowing correct backref anchors for repeated footnote references.
fn render_footnote_definition(fndef: &markdown::mdast::FootnoteDefinition, ctx: &mut Context) {
    let id = &fndef.identifier;
    let children_html = ctx.render_children_to_html(&fndef.children);
    ctx.push_footnote(id.to_string(), children_html);
}

/// Recursively renders an AST node to HTML, updating the context state.
pub fn render_node(node: &Node, ctx: &mut Context) {
    match node {
        Node::Root(root) => {
            for child in &root.children {
                render_node(child, ctx);
            }
        }
        Node::Text(text) => ctx.push_text(&text.value),
        Node::Paragraph(para) => render_paragraph(para, ctx),
        Node::Link(link) => render_link(link, ctx),
        Node::Strong(strong) => {
            ctx.push_raw("<strong>");
            for child in &strong.children {
                render_node(child, ctx);
            }
            ctx.push_raw("</strong>");
        }
        Node::Emphasis(emphasis) => {
            ctx.push_raw("<em>");
            for child in &emphasis.children {
                render_node(child, ctx);
            }
            ctx.push_raw("</em>");
        }
        Node::InlineCode(code) => {
            ctx.push_raw("<code>");
            ctx.push_code_text(&code.value);
            ctx.push_raw("</code>");
        }
        Node::Heading(heading) => render_heading(heading, ctx),
        Node::List(list) => render_list(list, ctx),
        Node::ListItem(item) => render_list_item(item, ctx),
        Node::Code(code) => render_code(code, ctx),
        Node::Blockquote(quote) => render_blockquote(quote, ctx),
        Node::Image(img) => render_image(img, ctx),
        Node::ThematicBreak(_) => ctx.push_raw("<hr />"),
        Node::Html(html) => render_html(html, ctx),
        Node::Delete(delete) => {
            ctx.push_raw("<del>");
            for child in &delete.children {
                render_node(child, ctx);
            }
            ctx.push_raw("</del>");
        }
        Node::Table(table) => render_table(table, ctx),
        Node::TableRow(_) => {}
        Node::TableCell(_) => {}
        Node::MdxJsxFlowElement(elem) => {
            render_jsx(elem.name.as_deref(), &elem.attributes, &elem.children, ctx);
        }
        Node::MdxJsxTextElement(elem) => {
            render_jsx(elem.name.as_deref(), &elem.attributes, &elem.children, ctx);
        }
        Node::FootnoteReference(fnref) => render_footnote_reference(fnref, ctx),
        Node::FootnoteDefinition(fndef) => render_footnote_definition(fndef, ctx),
        Node::Math(math) => {
            let mut props = BTreeMap::new();
            props.insert("expr".to_string(), PropValue::literal(&math.value));
            ctx.push_component("MathBlock", props, Vec::new());
        }
        Node::InlineMath(math) => {
            ctx.push_raw(&format!(
                "<MathInline expr={{{}}} />",
                serde_json::to_string(&math.value).unwrap_or_default()
            ));
        }
        _ => {
            log::warn!("Unhandled markdown node type: {:?}", node);
        }
    }
}
