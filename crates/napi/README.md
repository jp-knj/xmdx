# @xmdx/napi

Native Node.js bindings for xmdx - a high-performance Markdown/MDX compiler built with Rust.

## Supported Platforms

| Platform | Architecture | Package |
|----------|--------------|---------|
| macOS | x64 | `@xmdx/napi-darwin-x64` |
| macOS | ARM64 | `@xmdx/napi-darwin-arm64` |
| Windows | x64 | `@xmdx/napi-win32-x64-msvc` |
| Linux (glibc) | x64 | `@xmdx/napi-linux-x64-gnu` |
| Linux (glibc) | ARM64 | `@xmdx/napi-linux-arm64-gnu` |
| Linux (musl) | x64 | `@xmdx/napi-linux-x64-musl` |
| Linux (musl) | ARM64 | `@xmdx/napi-linux-arm64-musl` |

The correct binary is automatically selected at install time.

## Installation

```bash
npm install @xmdx/napi
```

## API

### `compile(source: string): string`

Compiles Markdown source to HTML synchronously.

```js
import { compile } from '@xmdx/napi';

const html = compile('# Hello, world!');
console.log(html);
// <h1>Hello, world!</h1>
```

### `compileCodeBlock(code: string, lang: string): Promise<string>`

Compiles a code block with syntax highlighting using Shiki.

```js
import { compileCodeBlock } from '@xmdx/napi';

const html = await compileCodeBlock('const x = 1;', 'javascript');
```

## Build from Source

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Build NAPI binary
pnpm run build

# Run tests
pnpm test
```

## Development

```bash
# Smoke test against fixture
pnpm run smoke:napi -- ../../fixtures/core/markdown/hello.md
```

## Notes

- The `napi` CLI must be available via `node_modules/.bin` (comes from devDependencies)
- If you see `napi: not found`, run `pnpm install` first
- Requires Node.js >= 10

## License

MIT
