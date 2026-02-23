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

/// Returns true if the character is a Unicode combining mark (Mn, Mc, Me categories).
/// Combining marks include diacritical marks, halant (virama), nukta, and other
/// characters that combine with preceding base characters. These must be preserved
/// in slugs for correct rendering of scripts like Devanagari, Arabic, Thai, etc.
fn is_combining_mark(ch: char) -> bool {
    use std::ops::RangeInclusive;

    // Common combining mark ranges (Unicode General_Category = Mn, Mc, Me)
    // This covers the most frequently used combining characters.
    const RANGES: &[RangeInclusive<u32>] = &[
        // Combining Diacritical Marks (U+0300..U+036F)
        0x0300..=0x036F,
        // Devanagari combining marks (nukta, virama/halant, etc.)
        0x0900..=0x0903, // Devanagari signs (chandrabindu, anusvara, visarga)
        0x093A..=0x094F, // Devanagari vowel signs, virama
        0x0951..=0x0957, // Devanagari stress signs, nukta, etc.
        0x0962..=0x0963, // Devanagari vowel signs
        // Bengali combining marks
        0x0980..=0x0983,
        0x09BC..=0x09CD,
        // Gurmukhi combining marks
        0x0A01..=0x0A03,
        0x0A3C..=0x0A4D,
        // Gujarati combining marks
        0x0A81..=0x0A83,
        0x0ABC..=0x0ACD,
        // Tamil combining marks
        0x0B01..=0x0B03,
        0x0BBE..=0x0BCD,
        // Thai combining marks
        0x0E31..=0x0E3A,
        0x0E47..=0x0E4E,
        // Arabic combining marks
        0x0610..=0x061A,
        0x064B..=0x065F,
        0x0670..=0x0670,
        // Hebrew combining marks
        0x0591..=0x05BD,
        0x05BF..=0x05BF,
        0x05C1..=0x05C2,
        0x05C4..=0x05C5,
        0x05C7..=0x05C7,
        // Korean combining marks (Hangul Jamo)
        0x302A..=0x302F,
        // CJK compatibility
        0x3099..=0x309A,
        // Combining Diacritical Marks Extended
        0x1AB0..=0x1AFF,
        // Combining Diacritical Marks Supplement
        0x1DC0..=0x1DFF,
        // Combining Half Marks
        0xFE20..=0xFE2F,
    ];

    let cp = ch as u32;
    RANGES.iter().any(|r| r.contains(&cp))
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
        } else if !ch.is_ascii() && (ch.is_alphanumeric() || is_combining_mark(ch)) {
            // Keep unicode letters/digits and combining marks; lowercase where possible
            for lower in ch.to_lowercase() {
                slug.push(lower);
            }
        } else if ch == ' ' {
            slug.push('-');
        }
        // All other characters (punctuation, tabs, newlines, soft hyphens, etc.) are silently dropped
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

    #[test]
    fn hindi_combining_marks_preserved() {
        let cases: Vec<(&str, &str)> = vec![
            // Hindi halant (virama) must be preserved
            ("स्लॉट्स", "स्लॉट्स"),
            // Hindi with halant in multi-word heading
            ("सर्वर-प्रथम", "सर्वर-प्रथम"),
            // Hindi with nukta
            ("डिफ़ॉल्ट रूप से तेज़", "डिफ़ॉल्ट-रूप-से-तेज़"),
            // Hindi with various combining marks
            ("प्रयोग करने में आसान", "प्रयोग-करने-में-आसान"),
            ("डेवलपर केंद्रित", "डेवलपर-केंद्रित"),
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
    fn soft_hyphen_stripped() {
        // Unicode soft hyphen (U+00AD) should be stripped (not alphanumeric, not combining)
        let mut counts = HashMap::new();
        assert_eq!(
            slugify("Entwicklungs\u{00AD}werkzeugleiste", &mut counts),
            "entwicklungswerkzeugleiste"
        );
    }
}
