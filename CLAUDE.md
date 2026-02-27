# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

xmdx is a high-performance streaming Markdown/MDX compiler built with Rust, designed primarily for Astro integration. It compiles MDX files into JSX-compatible Astro modules via a layered architecture: Rust core crates handle parsing/codegen, NAPI bindings expose them to Node.js, and TypeScript packages provide the Astro integration and Vite plugin.

## Repository Structure

This is a hybrid Rust + TypeScript monorepo managed by pnpm workspaces and Cargo workspaces.

**Rust crates (`crates/`):**
- `core` — Markdown parsing, frontmatter extraction, MDX compilation, slug generation, directive parsing
- `astro` — Astro-specific JSX code generation and AST transforms
- `napi` — Node.js NAPI-RS bindings with batch/parallel compilation (Rayon)
- `wasm` — WebAssembly build via wasm-bindgen

**TypeScript packages (`packages/`):**
- `xmdx` — Core JS API; conditional exports route to NAPI (Node.js) or WASM (browser/edge). Includes component registry system.
- `astro-xmdx` — Astro integration + Vite plugin. Contains the transform pipeline, presets (Starlight, ExpressiveCode), and all integration logic.
- `astro-loader` — Astro Content Collections loader using xmdx

**Data flow:** MDX file → Vite plugin (load handler) → NAPI binding → Rust core parse/compile → Rust astro codegen → JSX module string → Vite pipeline

## Build & Test Commands

### Full monorepo
```
pnpm install
pnpm build          # Build all packages recursively
pnpm test           # Run all tests recursively
```

### Rust
```
cargo fmt --all -- --check    # Format check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --exclude xmdx-napi   # Core + astro crate tests
cargo test -p xmdx-napi                       # NAPI crate tests (needs NAPI build first)
```

Rust snapshot tests use the `insta` crate. Update snapshots with `cargo insta review`.

### NAPI bindings (`crates/napi/`)
```
cd crates/napi && bun install
bun run build       # napi build --platform --release --esm
bun test            # JS-side NAPI tests
```

### TypeScript packages
```
# In packages/xmdx or packages/astro-xmdx:
bun test                     # Run tests
bun test --watch             # Watch mode
bun test path/to/file.test.ts  # Single test file
tsc --noEmit                 # Type check only
```

## Architecture Details

### Vite Plugin (`packages/astro-xmdx/src/vite-plugin/`)
The Vite plugin intercepts `.mdx`/`.md` file loads. Key components:
- `load-handler.ts` — Main Vite load hook
- `batch-compiler.ts` — Parallel file compilation
- `binding-loader.ts` — Manages NAPI binding lifecycle
- `jsx-transform.ts` — JSX AST transforms
- `jsx-worker-pool.ts` — Worker pool for parallel JSX processing
- `cache/` — `disk-cache.ts` (build-time caching)
- `fallback/` — `compile.ts` (@mdx-js/mdx fallback), `directive-rewriter.ts`, `rehype-heading-ids.ts`, `rehype-tasklist.ts`
- `highlighting/` — `shiki-manager.ts`, `expressive-code-manager.ts`, `shiki-highlighter.ts`
- `mdx-wrapper/` — `component-detection.ts`, `component-imports.ts`, `heading-id-injector.ts`, `export-normalizer.ts`

### Transform Pipeline (`packages/astro-xmdx/src/pipeline/`)
Orchestrated chain of transforms with hooks: `preprocess` → `afterParse` → `beforeInject` → `beforeOutput`. Transforms include `blocks-to-jsx`, `inject-components`, `shiki`, and `expressive-code`.

### Presets (`packages/astro-xmdx/src/presets/`)
Preconfigured transform sets for Astro, Starlight, and ExpressiveCode. Starlight projects are auto-detected.

### Component Registry (`packages/xmdx/src/registry/`)
Maps MDX component names to implementations with schema validation. Ships with built-in Astro and Starlight presets.

## CI

GitHub Actions workflows (`.github/workflows/`):
1. **`ci.yml`** — Build, lint, and test: `cargo fmt`, `cargo clippy`, `cargo test` (excludes xmdx-napi)
2. **`napi-build.yml`** — Test NAPI bindings: builds NAPI, runs `cargo test -p xmdx-napi` and `bun test`
3. **`publish-packages.yml`** — Publish packages to npm

## Key Conventions

- Do not add `Co-Authored-By` lines to commit messages
- Rust edition 2024, TypeScript strict mode with ES2022 target and NodeNext module resolution
- Test files are co-located with source as `*.test.ts` (TypeScript) or inline `#[cfg(test)]` modules (Rust)
- Package exports use TypeScript source files directly (no pre-compilation step for development)
- The `xmdx` package uses conditional exports: `node` condition → NAPI, `browser`/`edge-light`/`workerd` → WASM
