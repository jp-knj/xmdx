import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default defineConfig(
  // Global ignores
  { ignores: ['crates/**', 'target/**', 'node_modules/**', '**/dist/**', 'examples/**', 'fixtures/**', '**/wasm/**', '**/*.d.ts', 'eslint.config.ts'] },

  // Base: recommended + type-checked
  ...tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },

  // Test files: not in tsconfig, so disable type-checked rules entirely
  {
    files: ['**/*.test.ts'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Source files: ban `as` (except `as const`), ban any propagation
  {
    files: ['packages/*/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/ops/type-narrowing.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'TSAsExpression:not([typeAnnotation.type="TSTypeReference"][typeAnnotation.typeName.name="const"])',
        message: 'Type assertions are banned. Use ops/type-narrowing.ts.',
      }],
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ops/type-narrowing.ts: allow `as` + `any` (the ONE exception)
  {
    files: ['packages/*/src/ops/type-narrowing.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // astro-loader: relax rules caused by Astro's own `any`-typed APIs (parseData, store.set)
  {
    files: ['packages/astro-loader/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/ops/type-narrowing.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Boundaries (astro-xmdx only)
  {
    files: ['packages/astro-xmdx/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'types',        pattern: ['src/types.ts', 'src/constants.ts'], mode: 'file' },
        { type: 'utils',        pattern: 'src/utils/*' },
        { type: 'transforms',   pattern: 'src/transforms/*' },
        { type: 'pipeline',     pattern: 'src/pipeline/*' },
        { type: 'highlighting', pattern: 'src/vite-plugin/highlighting/*' },
        { type: 'mdx-wrapper',  pattern: 'src/vite-plugin/mdx-wrapper/*' },
        { type: 'fallback',     pattern: 'src/vite-plugin/fallback/*' },
        { type: 'cache',        pattern: 'src/vite-plugin/cache/*' },
        { type: 'vite-plugin',  pattern: 'src/vite-plugin/*' },
        { type: 'presets',      pattern: 'src/presets/*' },
        { type: 'entry',        pattern: ['src/index.ts', 'src/vite-plugin.ts', 'src/server.ts'], mode: 'file' },
      ],
      'boundaries/ignore': ['**/*.test.ts'],
    },
    rules: {
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'utils',        allow: ['types'] },
          { from: 'transforms',   allow: ['types', 'utils'] },
          { from: 'pipeline',     allow: ['types', 'utils', 'transforms'] },
          { from: 'highlighting', allow: ['types', 'utils'] },
          { from: 'mdx-wrapper',  allow: ['types', 'utils'] },
          { from: 'fallback',     allow: ['types', 'utils', 'highlighting'] },
          { from: 'cache',        allow: ['types'] },
          { from: 'vite-plugin',  allow: ['types', 'utils', 'transforms', 'pipeline', 'highlighting', 'mdx-wrapper', 'fallback', 'cache'] },
          { from: 'presets',      allow: ['types'] },
          { from: 'entry',        allow: ['types', 'utils', 'transforms', 'pipeline', 'highlighting', 'mdx-wrapper', 'fallback', 'cache', 'vite-plugin', 'presets'] },
        ],
      }],
    },
  },
);
