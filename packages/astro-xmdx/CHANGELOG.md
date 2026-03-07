# astro-xmdx

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
