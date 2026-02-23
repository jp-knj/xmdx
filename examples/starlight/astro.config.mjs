import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import xmdx from "astro-xmdx";

export default defineConfig({
  site: "https://example.com",
  integrations: [
    starlight({
      title: "Example",
      prerender: true,
      disable404Route: true,
      sidebar: [
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
      ],
    }),
    xmdx(),
  ],
});
