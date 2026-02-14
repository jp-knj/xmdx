#!/usr/bin/env node
// Patches content.config.ts to use static data instead of network fetches

const fs = require('fs');
const path = require('path');

const configPath = path.join(process.cwd(), 'src/content.config.ts');
let content = fs.readFileSync(configPath, 'utf8');

// Replace packages collection with static data
content = content.replace(
  /packages: defineCollection\(\{[\s\S]*?\}\),\n\tastroContributors:/,
  `packages: defineCollection({
		loader: async () => {
			// Static data for benchmark builds
			return [
				{ id: '@astrojs/alpinejs', version: '0.5.0' },
				{ id: '@astrojs/cloudflare', version: '12.0.0' },
				{ id: '@astrojs/db', version: '0.15.0' },
				{ id: '@astrojs/markdoc', version: '0.14.0' },
				{ id: '@astrojs/mdx', version: '4.0.0' },
				{ id: '@astrojs/netlify', version: '6.0.0' },
				{ id: '@astrojs/node', version: '9.0.0' },
				{ id: '@astrojs/partytown', version: '2.1.0' },
				{ id: '@astrojs/preact', version: '4.0.0' },
				{ id: '@astrojs/react', version: '4.0.0' },
				{ id: '@astrojs/rss', version: '4.0.0' },
				{ id: '@astrojs/sitemap', version: '3.3.0' },
				{ id: '@astrojs/solid-js', version: '5.0.0' },
				{ id: '@astrojs/svelte', version: '7.0.0' },
				{ id: '@astrojs/vercel', version: '8.0.0' },
				{ id: '@astrojs/vue', version: '5.0.0' },
				{ id: 'astro', version: '5.0.0' },
			];
		},
		schema: z.object({ version: z.string() }),
	}),
	astroContributors:`
);

// Replace astroContributors collection with static data
content = content.replace(
  /astroContributors: defineCollection\(\{[\s\S]*?schema: z\.object\(\{ avatar_url: z\.string\(\) \}\),\n\t\}\),/,
  `astroContributors: defineCollection({
		loader: async () => {
			// Static data for benchmark builds
			return [
				{ id: 'natemoo-re', avatar_url: 'https://avatars.githubusercontent.com/u/7118177' },
				{ id: 'matthewp', avatar_url: 'https://avatars.githubusercontent.com/u/361671' },
			];
		},
		schema: z.object({ avatar_url: z.string() }),
	}),`
);

fs.writeFileSync(configPath, content);
console.log('Patched content.config.ts');
