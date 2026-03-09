# astro-xmdx

## 0.0.10-next.8

### Patch Changes

- 774bd2f: fix: update Shiki integration, restore ExpressiveCode pre-render rewrite path, and reject fence closers with info strings
- Updated dependencies [774bd2f]
  - xmdx@0.0.9-next.2

## 0.0.10-next.7

### Patch Changes

- Updated dependencies [1d7e63d]
  - xmdx@0.0.9-next.1

## 0.0.10-next.6

### Patch Changes

- 295699f: chore: bump @xmdx/napi dependency to 0.0.8-next.0 with MDX heading extraction fix

## 0.0.10-next.5

### Patch Changes

- 3835cb0: fix: extract all headings from MDX files with indented code fences

  MDX content inside JSX components (e.g. `<Fragment>`, `<PackageManagerTabs>`) is commonly indented 4+ spaces. The heading extractor was applying CommonMark's indented-code-block rules, causing closing code fences with 4+ spaces of indentation to not be recognized. This left the extractor stuck inside "open" code blocks, skipping all subsequent headings.

  Since MDX disables indented code blocks (indentation is used for JSX structure), the fix removes the 3-space indentation limit for fence markers and the indented-code-block check from MDX heading extraction.

## 0.0.10-next.4

### Patch Changes

- ea662ff: Fix heading ID injection to prioritize `_components.hN` (markdown headings) over string-tag `"hN"` calls (literal JSX headings), preventing literal JSX headings from stealing IDs. Also adds raw-text-first matching to avoid normalization conflation between distinct headings.

## 0.0.10-next.3

### Patch Changes

- 358097d: fix: resolve bare specifiers from virtual modules for pnpm strict mode

## 0.0.10-next.2

### Patch Changes

- bbcf4f1: Fix "Vite module runner has been closed" build crash

## 0.0.10-next.0

### Patch Changes

- ab302b9: Reduce bundle size by moving shiki/expressive-code to optional peerDeps
- Updated dependencies [ab302b9]
  - xmdx@0.0.9-next.0

## 0.1.0-next.0

### Minor Changes

- Release next.1

### Patch Changes

- Updated dependencies
  - xmdx@0.1.0-next.0
