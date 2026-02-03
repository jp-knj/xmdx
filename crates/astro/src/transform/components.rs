//! Rewrites Astro docs components (Aside, Steps, Tabs, FileTree, Aside) into plain HTML structures.

use lol_html::Selector;
use lol_html::{ElementContentHandlers, element};
use std::borrow::Cow;

/// Builder for aggregating element handlers before passing to lol_html.
pub struct ComponentHandlers {
    handlers: Vec<(Cow<'static, Selector>, ElementContentHandlers<'static>)>,
}

impl ComponentHandlers {
    /// Creates an empty handler list.
    pub fn new() -> Self {
        Self {
            handlers: Vec::new(),
        }
    }

    /// Pushes a single handler tuple.
    pub fn push(&mut self, handler: (Cow<'static, Selector>, ElementContentHandlers<'static>)) {
        self.handlers.push(handler);
    }

    /// Extends the list with more handlers.
    pub fn extend(
        &mut self,
        handlers: Vec<(Cow<'static, Selector>, ElementContentHandlers<'static>)>,
    ) {
        self.handlers.extend(handlers);
    }

    /// Converts into the handler vector.
    pub fn into_vec(self) -> Vec<(Cow<'static, Selector>, ElementContentHandlers<'static>)> {
        self.handlers
    }
}

impl Default for ComponentHandlers {
    fn default() -> Self {
        Self::new()
    }
}

/// Returns lol_html handlers for rewriting Astro docs components into plain HTML.
pub fn component_handlers() -> Vec<(Cow<'static, Selector>, ElementContentHandlers<'static>)> {
    vec![
        aside_handler(),
        steps_handler(),
        step_handler(),
        tabs_handler(),
        tab_handler(),
        filetree_handler(),
        file_handler(),
    ]
}

fn steps_handler() -> (Cow<'static, Selector>, ElementContentHandlers<'static>) {
    element!("Steps", |el| {
        el.set_tag_name("ol")?;
        el.set_attribute("class", "steps")?;
        Ok(())
    })
}

fn step_handler() -> (Cow<'static, Selector>, ElementContentHandlers<'static>) {
    element!("Step", |el| {
        el.set_tag_name("li")?;
        el.set_attribute("class", "steps__item")?;
        Ok(())
    })
}

fn tabs_handler() -> (Cow<'static, Selector>, ElementContentHandlers<'static>) {
    element!("Tabs", |el| {
        el.set_tag_name("div")?;
        el.set_attribute("class", "tabs")?;
        el.set_attribute("role", "tablist")?;
        Ok(())
    })
}

fn tab_handler() -> (Cow<'static, Selector>, ElementContentHandlers<'static>) {
    element!("Tab", |el| {
        let title = el.get_attribute("title").unwrap_or_default();
        el.set_tag_name("div")?;
        el.set_attribute("class", "tab")?;
        el.set_attribute("role", "tabpanel")?;
        if !title.is_empty() {
            let heading = format!("<div class=\"tab__title\">{}</div>", title);
            el.prepend(&heading, lol_html::html_content::ContentType::Html);
            el.remove_attribute("title");
        }
        Ok(())
    })
}

fn filetree_handler() -> (Cow<'static, Selector>, ElementContentHandlers<'static>) {
    element!("FileTree", |el| {
        el.set_tag_name("ul")?;
        el.set_attribute("class", "filetree")?;
        Ok(())
    })
}

fn file_handler() -> (Cow<'static, Selector>, ElementContentHandlers<'static>) {
    element!("File", |el| {
        el.set_tag_name("li")?;
        el.set_attribute("class", "filetree__item")?;
        Ok(())
    })
}

fn aside_handler() -> (Cow<'static, Selector>, ElementContentHandlers<'static>) {
    element!("Aside", |el| {
        let aside_type = el.get_attribute("type").unwrap_or_default();
        let title = el.get_attribute("title").unwrap_or_default();

        el.set_tag_name("aside")?;

        let mut classes = Vec::new();
        classes.push("aside".to_string());
        if !aside_type.is_empty() {
            classes.push(format!("aside--{}", aside_type));
        }
        if let Some(existing) = el.get_attribute("class")
            && !existing.trim().is_empty()
        {
            classes.push(existing.trim().to_string());
        }
        el.set_attribute("class", &classes.join(" "))?;

        if !title.is_empty() {
            let heading = format!("<div class=\"aside__title\">{}</div>", title);
            el.prepend(&heading, lol_html::html_content::ContentType::Html);
        }

        el.remove_attribute("type");
        el.remove_attribute("title");
        el.remove_attribute("data-mf-source");

        Ok(())
    })
}
