use std::collections::HashMap;

/// Extracts a `{#custom-id}` suffix from heading text.
///
/// If the text ends with `{#some-id}` (where the id contains ASCII alphanumerics,
/// hyphens, or underscores), returns the trimmed text without the suffix and `Some(id)`.
/// Otherwise returns the original text and `None`.
///
/// # Examples
///
/// ```
/// use xmdx_core::slug::extract_custom_id;
///
/// let (text, id) = extract_custom_id("My Heading {#my-heading}");
/// assert_eq!(text, "My Heading");
/// assert_eq!(id, Some("my-heading"));
///
/// let (text, id) = extract_custom_id("Plain heading");
/// assert_eq!(text, "Plain heading");
/// assert_eq!(id, None);
/// ```
pub fn extract_custom_id(text: &str) -> (&str, Option<&str>) {
    let trimmed = text.trim_end();
    if !trimmed.ends_with('}') {
        return (text, None);
    }

    // Find the opening `{#`
    if let Some(open) = trimmed.rfind("{#") {
        let id_with_brace = &trimmed[open + 2..trimmed.len() - 1]; // between {# and }

        // Validate: id must be non-empty and contain only [a-zA-Z0-9_-]
        if !id_with_brace.is_empty()
            && id_with_brace
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            let before = trimmed[..open].trim_end();
            return (before, Some(id_with_brace));
        }
    }

    (text, None)
}

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

    /// Reserves a slug so future auto-generated slugs won't collide with it.
    pub fn reserve(&mut self, slug: &str) {
        let entry = self.counts.entry(slug.to_string()).or_insert(0);
        *entry += 1;
    }
}

/// Slugify the given text, updating counts to ensure uniqueness.
///
/// Matches github-slugger's algorithm:
/// 1. Lowercase
/// 2. Remove all non-alphanumeric, non-space characters
/// 3. Replace only spaces with hyphens
/// 4. No trailing-hyphen trimming, no consecutive-hyphen collapsing
pub fn slugify(text: &str, counts: &mut HashMap<String, usize>) -> String {
    let mut slug = String::new();

    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            slug.push(ch.to_ascii_lowercase());
        } else if !ch.is_ascii() && ch.is_alphanumeric() {
            // Keep unicode letters/digits; lowercase where possible
            for lower in ch.to_lowercase() {
                slug.push(lower);
            }
        } else if ch == ' ' {
            slug.push('-');
        }
        // All other characters (punctuation, tabs, newlines, etc.) are silently dropped
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
    fn spaces_become_hyphens_no_collapsing_or_trimming() {
        let mut counts = HashMap::new();
        // Spaces → hyphens, hyphens preserved, no collapsing, no trimming
        assert_eq!(slugify("  a---b  ", &mut counts), "--a---b--");
    }

    #[test]
    fn dots_removed() {
        let mut counts = HashMap::new();
        assert_eq!(slugify("import.meta.glob", &mut counts), "importmetaglob");
    }

    #[test]
    fn trailing_hyphen_preserved() {
        let mut counts = HashMap::new();
        // `<Image />` → angle brackets and slash removed, space becomes hyphen
        assert_eq!(slugify("<Image />", &mut counts), "image-");
    }

    #[test]
    fn dots_in_config_keys() {
        let mut counts = HashMap::new();
        assert_eq!(slugify("build.format", &mut counts), "buildformat");
        assert_eq!(slugify("i18n.locales", &mut counts), "i18nlocales");
    }

    #[test]
    fn extract_custom_id_basic() {
        let (text, id) = extract_custom_id("My Heading {#my-heading}");
        assert_eq!(text, "My Heading");
        assert_eq!(id, Some("my-heading"));
    }

    #[test]
    fn extract_custom_id_with_trailing_space() {
        let (text, id) = extract_custom_id("My Heading {#my-heading}  ");
        assert_eq!(text, "My Heading");
        assert_eq!(id, Some("my-heading"));
    }

    #[test]
    fn extract_custom_id_none() {
        let (text, id) = extract_custom_id("Plain heading");
        assert_eq!(text, "Plain heading");
        assert_eq!(id, None);
    }

    #[test]
    fn extract_custom_id_underscores() {
        let (text, id) = extract_custom_id("Title {#my_custom_id}");
        assert_eq!(text, "Title");
        assert_eq!(id, Some("my_custom_id"));
    }

    #[test]
    fn extract_custom_id_invalid_chars() {
        // Spaces in the id are not allowed
        let (text, id) = extract_custom_id("Title {#bad id}");
        assert_eq!(text, "Title {#bad id}");
        assert_eq!(id, None);
    }

    #[test]
    fn extract_custom_id_empty_id() {
        // Empty id not allowed
        let (text, id) = extract_custom_id("Title {#}");
        assert_eq!(text, "Title {#}");
        assert_eq!(id, None);
    }

    #[test]
    fn extract_custom_id_unicode_text() {
        let (text, id) =
            extract_custom_id("共通データ型バリデーター {#common-data-type-validators}");
        assert_eq!(text, "共通データ型バリデーター");
        assert_eq!(id, Some("common-data-type-validators"));
    }

    #[test]
    fn reserve_prevents_collision() {
        let mut slugger = Slugger::new();
        slugger.reserve("intro");
        assert_eq!(slugger.next_slug("Intro"), "intro-1");
    }

    /// Verify parity with github-slugger for real Astro docs headings.
    /// Expected values generated by: `require('github-slugger').slug(input)`
    #[test]
    fn github_slugger_parity() {
        let cases: Vec<(&str, &str)> = vec![
            ("Hello World", "hello-world"),
            ("import.meta.glob", "importmetaglob"),
            ("<Image />", "image-"),
            ("build.format", "buildformat"),
            ("i18n.locales", "i18nlocales"),
            ("多言語 ガイド", "多言語-ガイド"),
            ("  a---b  ", "--a---b--"),
            ("src/content/", "srccontent"),
            ("astro.config.mjs", "astroconfigmjs"),
            ("Astro.props", "astroprops"),
            ("define:vars", "definevars"),
            ("client:load", "clientload"),
            ("set:html", "sethtml"),
            ("is:inline", "isinline"),
            ("class:list", "classlist"),
            ("transition:name", "transitionname"),
            ("getStaticPaths()", "getstaticpaths"),
            ("Content Collections", "content-collections"),
            ("Why Astro?", "why-astro"),
            ("<Fragment />", "fragment-"),
            ("TypeScript & JSX", "typescript--jsx"),
            ("node_modules/.astro", "node_modulesastro"),
            ("public/", "public"),
            ("@astrojs/mdx", "astrojsmdx"),
            ("import.meta.env", "importmetaenv"),
            ("Markdown & MDX", "markdown--mdx"),
            ("<Code />", "code-"),
            ("astro:content", "astrocontent"),
            ("Using __dirname", "using-__dirname"),
        ];

        for (input, expected) in &cases {
            let mut counts = HashMap::new();
            let actual = slugify(input, &mut counts);
            assert_eq!(
                &actual, expected,
                "Mismatch for {:?}: got {:?}, expected {:?}",
                input, actual, expected
            );
        }
    }

    #[test]
    fn parity_tabs_emoji_mixed_scripts() {
        let cases: Vec<(&str, &str)> = vec![
            // Tab characters are silently dropped (not space, not alphanumeric)
            ("Hello\tWorld", "helloworld"),
            // Emoji are non-ASCII non-alphanumeric → dropped
            ("🚀 Getting Started", "-getting-started"),
            // Mixed CJK + Latin
            ("安装 Installation Guide", "安装-installation-guide"),
            // Korean
            ("시작하기 Guide", "시작하기-guide"),
            // Accented Latin characters preserved (unicode alphanumeric)
            ("Héllo Wörld", "héllo-wörld"),
        ];

        for (input, expected) in &cases {
            let mut counts = HashMap::new();
            let actual = slugify(input, &mut counts);
            assert_eq!(
                &actual, expected,
                "Mismatch for {:?}: got {:?}, expected {:?}",
                input, actual, expected
            );
        }
    }
}
