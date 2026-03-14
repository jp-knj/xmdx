# xmdx

## 0.0.9

### Patch Changes

- 2c20fd4: fix: fence closing now follows CommonMark rules for indented openers; Shiki fallback runs when ExpressiveCode peer is unavailable
- 2c20fd4: fix: preserve valid href output for HTML anchors and component props in generated xmdx JSX
- 2c20fd4: Restore expressive-code as direct dependency, add astro-expressive-code runtime dependency, and re-initialize Shiki after enabling fallback in batch compilation path
- 2c20fd4: fix: update Shiki integration, restore ExpressiveCode pre-render rewrite path, and reject fence closers with info strings
  - @xmdx/napi@0.0.8

## 0.0.9-next.3

### Patch Changes

- 8c063a1: fix: preserve valid href output for HTML anchors and component props in generated xmdx JSX

## 0.0.9-next.2

### Patch Changes

- 774bd2f: fix: update Shiki integration, restore ExpressiveCode pre-render rewrite path, and reject fence closers with info strings

## 0.0.9-next.1

### Patch Changes

- 1d7e63d: fix: track indent level in fence parsing to prevent false closes

## 0.0.9-next.0

### Patch Changes

- ab302b9: Reduce bundle size by moving shiki/expressive-code to optional peerDeps

## 0.1.0-next.0

### Minor Changes

- Release next.1
