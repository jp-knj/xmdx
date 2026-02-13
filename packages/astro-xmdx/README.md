# astro-xmdx

Astro integration for xmdx, a high-performance MDX compiler.

## Installation

```bash
npm install astro-xmdx
# or
pnpm add astro-xmdx
# or
yarn add astro-xmdx
```

## Basic Setup

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';

export default defineConfig({
  integrations: [xmdx()],
});
```

## Presets

Use presets to quickly configure common stacks.

### Starlight

```js
import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';
import { starlightPreset } from 'astro-xmdx/presets';

export default defineConfig({
  integrations: [
    xmdx({
      presets: [starlightPreset()],
    }),
  ],
});
```

### Expressive Code

```js
import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';
import { expressiveCodePreset } from 'astro-xmdx/presets';

export default defineConfig({
  integrations: [
    xmdx({
      presets: [expressiveCodePreset()],
    }),
  ],
});
```

### Multiple Presets

```js
import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';
import { astroPreset, starlightPreset } from 'astro-xmdx/presets';

export default defineConfig({
  integrations: [
    xmdx({
      presets: [astroPreset(), starlightPreset()],
    }),
  ],
});
```

## Configuration

```js
import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';
import { starlightPreset } from 'astro-xmdx/presets';

export default defineConfig({
  integrations: [
    xmdx({
      include: (id) => id.endsWith('.md') || id.endsWith('.mdx'),
      presets: [starlightPreset()],
      expressiveCode: {
        enabled: true,
        componentName: 'Code',
        importSource: '@astrojs/starlight/components',
      },
      mdx: {
        allowImports: ['@astrojs/starlight/*', '~/components/*'],
        ignoreCodeFences: true,
      },
      compiler: {
        jsx: {
          code_sample_components: ['Code'],
        },
      },
    }),
  ],
});
```

## Starlight Behavior

When `@astrojs/starlight` is detected, `astro-xmdx` automatically applies safe defaults unless explicitly overridden:

- enables Starlight component injection
- allows common Starlight import patterns for MDX fallback handling
- enables Expressive Code rewriting for fenced code blocks

In Starlight setups, the `Code` component resolution prefers `@astrojs/starlight/components`.

## Options

| Option | Type | Description |
|--------|------|-------------|
| `include` | `(id: string) => boolean` | File filter. Defaults to `.md` and `.mdx` files. |
| `libraries` | `ComponentLibrary[]` | Component libraries to register. |
| `presets` | `PresetConfig[]` | Presets merged in order (later presets win on conflicts). |
| `starlightComponents` | `boolean \| { enabled: boolean; importSource?: string }` | Starlight component injection config. |
| `expressiveCode` | `boolean \| { enabled: boolean; componentName?: string; importSource?: string }` | Expressive Code code-block rewrite config. |
| `compiler` | `{ jsx?: { code_sample_components?: string[] } }` | Compiler options passed to xmdx. |
| `plugins` | `XmdxPlugin[]` | Pipeline hooks (`preprocess`, `afterParse`, `beforeInject`, `beforeOutput`). |
| `mdx` | `{ allowImports?: string[]; ignoreCodeFences?: boolean }` | Controls import fallback behavior for MDX files. |

## Exports

| Export | Description |
|--------|-------------|
| `astro-xmdx` | Main Astro integration. |
| `astro-xmdx/server` | Server entrypoint export alias. |
| `astro-xmdx/server.js` | Server entrypoint export. |
| `astro-xmdx/presets` | Preset helpers (`starlightPreset`, `expressiveCodePreset`, `astroPreset`). |
| `astro-xmdx/vite-plugin` | Standalone Vite plugin. |
| `astro-xmdx/pipeline` | Pipeline utilities. |
| `astro-xmdx/transforms` | Transform utilities. |

## License

MIT
