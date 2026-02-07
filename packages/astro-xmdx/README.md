# astro-xmdx

Astro integration for xmdx - a high-performance MDX compiler.

## Installation

```bash
npm install astro-xmdx
# or
pnpm add astro-xmdx
# or
yarn add astro-xmdx
```

## Setup

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';

export default defineConfig({
  integrations: [xmdx()],
});
```

## Presets

### Starlight

Optimized for Starlight documentation sites:

```js
import xmdx from 'astro-xmdx';
import { starlight } from 'astro-xmdx/presets';

export default defineConfig({
  integrations: [
    xmdx({
      preset: starlight(),
    }),
  ],
});
```

### ExpressiveCode

For code blocks with syntax highlighting:

```js
import xmdx from 'astro-xmdx';
import { expressiveCode } from 'astro-xmdx/presets';

export default defineConfig({
  integrations: [
    xmdx({
      preset: expressiveCode({
        themes: ['github-dark', 'github-light'],
      }),
    }),
  ],
});
```

## Configuration

```js
xmdx({
  // File extensions to process
  extensions: ['.mdx', '.md'],

  // Apply a preset
  preset: starlight(),

  // Remark plugins
  remarkPlugins: [remarkGfm],

  // Rehype plugins
  rehypePlugins: [rehypeSlug],

  // Code highlighting options
  shiki: {
    themes: {
      light: 'github-light',
      dark: 'github-dark',
    },
  },
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `extensions` | `string[]` | `['.mdx', '.md']` | File extensions to process |
| `preset` | `Preset` | - | Configuration preset |
| `remarkPlugins` | `Plugin[]` | `[]` | Remark plugins to apply |
| `rehypePlugins` | `Plugin[]` | `[]` | Rehype plugins to apply |
| `shiki` | `ShikiOptions` | - | Shiki syntax highlighting config |

## Exports

| Export | Description |
|--------|-------------|
| `astro-xmdx` | Main Astro integration |
| `astro-xmdx/presets` | Preset configurations |
| `astro-xmdx/vite-plugin` | Standalone Vite plugin |
| `astro-xmdx/pipeline` | Processing pipeline utilities |
| `astro-xmdx/transforms` | AST transform utilities |

## License

MIT
