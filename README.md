# xmdx

A high-performance streaming Markdown/MDX engine built with Rust, designed for modern web frameworks.

## Features

- **Rust-powered performance** - Native speed with NAPI bindings for Node.js
- **Streaming architecture** - Process large files efficiently
- **WASM support** - Run in browsers and edge runtimes
- **Astro integration** - First-class support for Starlight projects
- **MDX compatible** - Full JSX component support

## Packages

| Package | Description |
|---------|-------------|
| [`xmdx`](./packages/xmdx) | Core JavaScript API with Node.js and browser support |
| [`astro-xmdx`](./packages/astro-xmdx) | Astro integration with presets and plugins |
| [`@xmdx/napi`](./crates/napi) | Native Node.js bindings (NAPI-RS) |
| `xmdx-wasm` | WebAssembly build for browsers |

## Quick Start

### xmdx (Standalone)

```bash
npm install xmdx
```

```js
import { compile } from 'xmdx';

const html = await compile('# Hello, world!');
```

### astro-xmdx (Astro Integration)

```bash
npm install astro-xmdx
```

```js
import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';

export default defineConfig({
  integrations: [xmdx()],
});
```

## Examples

- [`examples/starlight`](./examples/starlight): Starlight docs site using `astro-xmdx` with auto-detected Starlight support.

## Supported Platforms

| Platform | Architecture |
|----------|--------------|
| macOS | x64, ARM64 |
| Windows | x64 |
| Linux (glibc) | x64, ARM64 |
| Linux (musl) | x64, ARM64 |
| Browser/Edge | WebAssembly |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## License

MIT
