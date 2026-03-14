import { describe, expect, test } from 'bun:test';
import { xmdxPlugin } from './vite-plugin.js';
import { OUTPUT_EXTENSION, VIRTUAL_MODULE_PREFIX } from './constants.js';

describe('xmdxPlugin resolveId', () => {
  test('re-wraps alias-resolved markdown imports from virtual modules', async () => {
    const plugin = xmdxPlugin();
    const resolveId = plugin.resolveId;

    expect(resolveId).toBeDefined();

    const result = await resolveId!.call(
      {
        resolve: async (id: string) => {
          if (id === '@/docs/post') {
            return { id: '/repo/src/docs/post.mdx' };
          }
          return null;
        },
      },
      '@/docs/post',
      `${VIRTUAL_MODULE_PREFIX}/repo/src/pages/index.mdx${OUTPUT_EXTENSION}`
    );

    expect(result).toBe(`${VIRTUAL_MODULE_PREFIX}/repo/src/docs/post.mdx${OUTPUT_EXTENSION}`);
  });

  test('does not resolve bare specifiers from astro-xmdx private dependencies', async () => {
    const plugin = xmdxPlugin();
    const resolveId = plugin.resolveId;

    expect(resolveId).toBeDefined();

    // 'gray-matter' is in astro-xmdx's dependency tree. When the consumer app
    // cannot resolve it, virtual modules must not fall back to xmdx's private tree.
    const result = await resolveId!.call(
      {
        resolve: async () => null,
      },
      'gray-matter',
      `${VIRTUAL_MODULE_PREFIX}/repo/src/pages/index.mdx${OUTPUT_EXTENSION}`
    );

    expect(result).toBeNull();
  });
});
