# CLAUDE.md

Guidance for Claude Code instances working in this repository.

## Build & Development Commands

### Root-level (pnpm)

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages (pnpm -r build)
pnpm build:napi           # Build NAPI bindings only
pnpm test                 # Run all tests (pnpm -r test)
pnpm knip                 # Detect unused code & dependencies
```

### Per-package (TypeScript)

```bash
# packages/xmdx and packages/astro-xmdx
pnpm --filter <package> build        # tsc
pnpm --filter <package> test         # bun test
pnpm --filter <package> test:watch   # bun test --watch
pnpm --filter <package> typecheck    # tsc --noEmit

# packages/astro-loader
pnpm --filter @xmdx/astro-loader build   # tsdown build
pnpm --filter @xmdx/astro-loader lint    # tsc --noEmit
```

### Running a single test file

```bash
bun test packages/astro-xmdx/src/tests/some-test.test.ts
```

### Rust (Cargo)

```bash
cargo fmt --all -- --check                                  # Check formatting
cargo clippy --workspace --all-targets -- -D warnings       # Lint
cargo test --workspace --exclude xmdx-napi                  # Run tests (excluding NAPI)
cargo test -p xmdx-napi                                     # NAPI-specific tests
```

## Architecture Overview

Polyglot monorepo: 4 Rust crates + 3 TypeScript packages.

### Rust Crates (`crates/`)

| Crate | Purpose |
|-------|---------|
| `xmdx-core` | Parsing (MDAST), frontmatter extraction, slug generation, directive rewriting, MDX compilation via mdxjs-rs |
| `xmdx-astro` | Astro-specific rendering: MDAST to RenderBlock IR, code generation to JSX |
| `xmdx-napi` | Node.js bindings via NAPI-RS. Exports `compile()`, `compileMdx()`, `parseBlocks()`, batch variants. Uses Rayon for parallelism |
| `xmdx-wasm` | WebAssembly build via wasm-bindgen for browser/edge runtimes |

### TypeScript Packages (`packages/`)

| Package | Purpose |
|---------|---------|
| `xmdx` | Core JS library with Node (NAPI) and browser (WASM) entry points. Houses the component registry and preset definitions |
| `astro-xmdx` | Astro integration: Vite plugin, transform pipeline, Starlight auto-detection, presets |
| `astro-loader` | Astro Content Collections loader for MDX files |

### Data Flow

```
.mdx file
  -> Vite plugin load hook (astro-xmdx)
  -> Preprocess hooks
  -> Compilation (Rust native OR @mdx-js/mdx fallback)
  -> Transform pipeline (ExpressiveCode, component injection, Shiki)
  -> esbuild JSX transform
  -> Astro-compatible module (default export + frontmatter + headings)
```

## Key Concepts

### Dual Compilation Paths

The Vite plugin tries the fast Rust compiler first. If it detects problematic patterns (imports not in `allowImports`, unsupported JSX), it falls back to `@mdx-js/mdx`. The same transform pipeline runs on both paths' output.

- **Rust path:** `xmdx-core::parse_mdast()` -> `xmdx-astro::render` -> RenderBlock IR -> JSX codegen
- **Fallback path:** `@mdx-js/mdx` with remark-gfm + rehype plugins -> JSX

Key files: `packages/astro-xmdx/src/vite-plugin/load-handler.ts`, `packages/astro-xmdx/src/vite-plugin/jsx-module.ts`

### Registry & Preset System

The registry (`packages/xmdx/src/registry/`) maps component names to their module paths and handles directive-to-component mappings (e.g., `:::note` -> `<Aside>`). Presets bundle registry configurations:

- `starlightPreset()` — Starlight + Astro + ExpressiveCode libraries, safe import patterns
- `expressiveCodePreset()` — Astro + ExpressiveCode libraries
- `astroPreset()` — Minimal Astro-only library

Presets compose via `mergePresets()`.

### Starlight Auto-Detection

When `@astrojs/starlight` is found in the Astro config's integrations, `astro-xmdx` automatically enables Starlight components, ExpressiveCode, safe import allowlists, and applies any user-defined component overrides. No manual preset configuration required.

Key file: `packages/astro-xmdx/src/utils/starlight-detection.ts`

### Transform Pipeline

Sequential functional composition (`packages/astro-xmdx/src/pipeline/`):

1. `afterParse` user hooks
2. `transformExpressiveCode` — rewrites code blocks to EC components
3. `beforeInject` user hooks
4. `transformInjectComponentsFromRegistry` — scans JSX for used components, injects missing imports
5. `transformShikiHighlight` — syntax highlighting (skipped when EC is active)
6. `beforeOutput` user hooks

## CI Checks

CI runs on push/PR to main (`.github/workflows/ci.yml`):

### Rust (`rust` job)
1. **Formatting** — `cargo fmt --all -- --check`
2. **Linting** — `cargo clippy --workspace --all-targets -- -D warnings`
3. **Tests** — `cargo test --workspace --exclude xmdx-napi`

### NAPI (`napi` job)
4. **Build** — builds NAPI binding via `bun run build` in `crates/napi`
5. **Rust tests** — `cargo test -p xmdx-napi`
6. **JS tests** — `bun test` in `crates/napi`

### TypeScript (`typescript` job, depends on `napi`)
7. **Build** — `pnpm build` (all packages)
8. **Typecheck** — `tsc --noEmit` per package
9. **Tests** — `pnpm test` (`bun test` per package)

### Unused code (`knip` job)
10. **Knip** — `pnpm knip` (config in `knip.json`)
