# xmdx

High-performance streaming Markdown/MDX compiler built with Rust.

## Installation

```bash
npm install xmdx
# or
pnpm add xmdx
# or
yarn add xmdx
```

## Usage

### Node.js

```js
import { compile } from 'xmdx';

const html = await compile('# Hello, world!');
console.log(html);
// <h1>Hello, world!</h1>
```

### Browser

The package automatically uses WebAssembly in browser environments:

```js
import { compile } from 'xmdx';

// Works the same way in browsers
const html = await compile('**Bold text**');
```

### Direct WASM Import

```js
import { compile } from 'xmdx/wasm';

const html = compile('# Direct WASM usage');
```

## Astro Integration

Use `xmdx` directly when you need framework-agnostic compilation APIs.
For Astro projects, use [`astro-xmdx`](../astro-xmdx) as the integration layer.

- Runnable Starlight example: [`examples/starlight`](../../examples/starlight)

## API

### `compile(source: string, options?: CompileOptions): Promise<string>`

Compiles Markdown/MDX source to HTML.

**Parameters:**

- `source` - Markdown or MDX source string
- `options` - Optional configuration object

**Returns:** Promise resolving to HTML string

### `compileSync(source: string, options?: CompileOptions): string`

Synchronous version of compile (Node.js only).

## Exports

| Export | Description |
|--------|-------------|
| `xmdx` | Auto-selects Node.js or browser implementation |
| `xmdx/browser` | Browser-specific (WASM) implementation |
| `xmdx/wasm` | Direct WebAssembly bindings |
| `xmdx/registry` | Plugin registry utilities |

## Supported Environments

- Node.js >= 18
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Edge runtimes (Cloudflare Workers, Vercel Edge)
- Bun

## License

MIT
