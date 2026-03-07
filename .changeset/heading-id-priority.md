---
"astro-xmdx": patch
---

Fix heading ID injection to prioritize `_components.hN` (markdown headings) over string-tag `"hN"` calls (literal JSX headings), preventing literal JSX headings from stealing IDs. Also adds raw-text-first matching to avoid normalization conflation between distinct headings.
