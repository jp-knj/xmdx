/**
 * Shared constants for astro-xmdx
 * @module constants
 */

/**
 * Virtual module prefix for Vite module resolution.
 * The null byte prefix ensures these are treated as virtual modules.
 */
export const VIRTUAL_MODULE_PREFIX = '\0xmdx:';

/**
 * File extension for compiled xmdx JSX output.
 */
export const OUTPUT_EXTENSION = '.xmdx.jsx';

/**
 * esbuild configuration for JSX transformation.
 * Used to transform JSX syntax into function calls compatible with Astro's runtime.
 */
export const ESBUILD_JSX_CONFIG = {
  loader: 'jsx' as const,
  jsx: 'transform' as const,
  jsxFactory: '_jsx',
  jsxFragment: '_Fragment',
} as const;

/**
 * Shiki syntax highlighting theme configuration.
 * Uses CSS variables for theming compatibility with Astro.
 */
export const SHIKI_THEME = {
  /** Theme name used by shiki */
  name: 'astro-code',
  /** CSS variable prefix for syntax highlighting colors */
  variablePrefix: '--astro-code-',
  /** CSS class name added to highlighted code blocks */
  className: 'astro-code',
} as const;

/**
 * Default glob patterns to ignore when scanning for markdown files.
 */
export const DEFAULT_IGNORE_PATTERNS = ['node_modules/**', 'dist/**'] as const;

/**
 * CSS @layer order declaration for Starlight.
 * Injected as inline <style> in dev mode, Head.astro overlay in build.
 */
export const STARLIGHT_LAYER_ORDER = '@layer starlight.base, starlight.reset, starlight.core, starlight.content, starlight.components, starlight.utils;';
