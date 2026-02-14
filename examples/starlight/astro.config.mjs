import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import xmdx from 'astro-xmdx';
import { starlightPreset } from 'astro-xmdx/presets';

export default defineConfig({
  integrations: [
    starlight({
      title: 'xmdx Starlight Example',
      sidebar: [
        { label: 'Home', link: '/' },
        {
          label: 'Guides',
          items: [
            { label: 'Getting Started', link: '/guides/getting-started/' },
            { label: 'Configuration', link: '/guides/configuration/' },
          ],
        },
      ],
    }),
    xmdx({
      presets: [starlightPreset({ expressiveCode: false })],
    }),
  ],
});
