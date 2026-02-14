import { defineConfig } from 'astro/config';
import xmdx from 'astro-xmdx';

export default defineConfig({
  integrations: [xmdx()],
});
