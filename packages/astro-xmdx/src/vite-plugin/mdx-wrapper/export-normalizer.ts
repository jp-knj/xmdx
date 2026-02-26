/**
 * Normalizes mdxjs-rs default export to ensure MDXContent is available.
 * @module vite-plugin/export-normalizer
 */

/**
 * Normalizes the mdxjs-rs export to ensure MDXContent is available.
 * Handles both direct exports and function reference exports.
 */
export function normalizeMdxExport(code: string): string {
  // Remove the default export line(s) - we'll create our own wrapper
  let normalized = code
    // Remove: export default function MDXContent
    .replace(/export\s+default\s+function\s+MDXContent/g, 'function MDXContent')
    // Remove: export default MDXContent;
    .replace(/export\s+default\s+MDXContent\s*;?/g, '')
    // Remove: export { MDXContent as default };
    .replace(/export\s*\{\s*MDXContent\s+as\s+default\s*\}\s*;?/g, '')
    // Remove: export default _createMdxContent;
    .replace(/export\s+default\s+_createMdxContent\s*;?/g, '');

  // If there's a _createMdxContent function that was the default export,
  // alias it to MDXContent for consistency
  if (normalized.includes('function _createMdxContent') && !normalized.includes('function MDXContent')) {
    normalized += '\nconst MDXContent = _createMdxContent;';
  }

  return normalized;
}
