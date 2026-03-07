---
"astro-xmdx": patch
---

fix: extract all headings from MDX files with indented code fences

MDX content inside JSX components (e.g. `<Fragment>`, `<PackageManagerTabs>`) is commonly indented 4+ spaces. The heading extractor was applying CommonMark's indented-code-block rules, causing closing code fences with 4+ spaces of indentation to not be recognized. This left the extractor stuck inside "open" code blocks, skipping all subsequent headings.

Since MDX disables indented code blocks (indentation is used for JSX structure), the fix removes the 3-space indentation limit for fence markers and the indented-code-block check from MDX heading extraction.
