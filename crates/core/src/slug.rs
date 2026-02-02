use std::collections::HashMap;

/// Github-slugger compatible slug generator.
#[derive(Default)]
pub struct Slugger {
    counts: HashMap<String, usize>,
}

impl Slugger {
    /// Creates a new slugger.
    pub fn new() -> Self {
        Self {
            counts: HashMap::new(),
        }
    }

    /// Generates the next slug for the given heading text.
    pub fn next_slug(&mut self, text: &str) -> String {
        slugify(text, &mut self.counts)
    }
}

/// Slugify the given text, updating counts to ensure uniqueness.
pub fn slugify(text: &str, counts: &mut HashMap<String, usize>) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !ch.is_ascii() && (ch.is_alphanumeric()) {
            // keep unicode letters/digits; lowercase where possible
            for lower in ch.to_lowercase() {
                slug.push(lower);
            }
            last_dash = false;
        } else if (ch.is_whitespace()
            || matches!(
                ch,
                '-' | '_' | ':' | '.' | '/' | '\\' | '(' | ')' | '[' | ']' | '{' | '}' | '&'
            ))
            && !slug.is_empty()
            && !last_dash
        {
            slug.push('-');
            last_dash = true;
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }

    // empty fallback
    if slug.is_empty() {
        slug.push_str("heading");
    }

    let entry = counts.entry(slug.clone()).or_insert(0);
    if *entry > 0 {
        slug.push_str(&format!("-{}", *entry));
    }
    *entry += 1;

    slug
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_basic() {
        let mut counts = HashMap::new();
        assert_eq!(slugify("Hello World", &mut counts), "hello-world");
    }

    #[test]
    fn deduplication() {
        let mut counts = HashMap::new();
        assert_eq!(slugify("Title", &mut counts), "title");
        assert_eq!(slugify("Title", &mut counts), "title-1");
        assert_eq!(slugify("Title", &mut counts), "title-2");
    }

    #[test]
    fn unicode_preserved() {
        let mut counts = HashMap::new();
        assert_eq!(slugify("多言語 ガイド", &mut counts), "多言語-ガイド");
    }

    #[test]
    fn trims_and_collapses() {
        let mut counts = HashMap::new();
        assert_eq!(slugify("  a---b  ", &mut counts), "a-b");
    }
}
