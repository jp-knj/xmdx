/**
 * Transforms compiled blocks into JSX code
 * @module transforms/blocks-to-jsx
 */

import type { HeadingEntry } from 'xmdx';

/**
 * Minimal registry interface consumed by blocksToJsx.
 * Avoids coupling to the full Registry type.
 */
export interface BlocksRegistry {
  getSupportedDirectives(): string[];
  getDirectiveMapping(directive: string): { component: string; injectProps?: Record<string, { source: string; value?: string }> } | undefined;
  getSlotNormalization(component: string): { strategy: 'wrap_in_ol' | 'wrap_in_ul' } | undefined;
  getComponent(name: string): { modulePath: string; exportType: string } | undefined;
}
import { htmlEntitiesToJsx, hasPascalCaseTag } from 'xmdx-napi';

/**
 * Prop value from the Rust compiler.
 */
export interface PropValue {
  type: 'literal' | 'expression';
  value: string;
}

/**
 * Block from the Rust compiler.
 */
export interface Block {
  type: 'html' | 'component' | 'code';
  content?: string;
  name?: string;
  props?: Record<string, PropValue | string | unknown>;
  slotChildren?: Block[];
  /** Code content (for type="code") */
  code?: string;
  /** Code language (for type="code") */
  lang?: string;
  /** Code meta string (for type="code") */
  meta?: string;
}

/**
 * Escapes HTML special characters for safe embedding in HTML content.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '&#96;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/\n/g, '&#10;');
}

/**
 * Converts structured slot children blocks to an HTML string.
 * Used to process slot content that needs to be embedded as HTML.
 */
function slotChildrenToHtml(
  blocks: Block[],
  componentImports?: Map<string, { modulePath: string; exportType: string }>,
  registry?: BlocksRegistry,
  userImportedNames?: Set<string>,
): string {
  let result = '';
  for (const block of blocks) {
    if (block.type === 'html') {
      // Escape braces so JSX text does not become expressions
      result += (block.content ?? '').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
    } else if (block.type === 'code') {
      // Always render as HTML <pre><code>; ExpressiveCode rewriting happens in pipeline
      const langAttr = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
      result += `<pre class="astro-code" tabindex="0"><code${langAttr}>${escapeHtml(block.code ?? '')}</code></pre>`;
    } else if (block.type === 'component') {
      const innerHtml = slotChildrenToHtml(block.slotChildren ?? [], componentImports, registry, userImportedNames);

      // Fragment-with-slot: render as <span style="display:contents" slot="name">
      // so Astro's slot distribution works (Fragment VNodes are unwrapped,
      // losing the slot prop).
      const slotProp = block.props?.slot;
      const slotName =
        typeof slotProp === 'object' && slotProp !== null && 'type' in slotProp && 'value' in slotProp
          ? (slotProp as PropValue).value
          : typeof slotProp === 'string'
            ? slotProp
            : undefined;
      const isFragmentSlot = block.name === 'Fragment' && slotName !== undefined;
      const tag = isFragmentSlot ? 'span' : (block.name ?? '');

      result += `<${tag}`;
      if (isFragmentSlot) {
        result += ' style="display:contents"';
      }
      if (block.props) {
        for (const [key, value] of Object.entries(block.props)) {
          if (typeof value === 'object' && value !== null && 'type' in value && 'value' in value) {
            const pv = value as PropValue;
            if (isFragmentSlot && key === 'slot') {
              result += ` slot="${escapeJsString(pv.value)}"`;
            } else if (pv.type === 'literal') {
              result += ` ${key}="${escapeJsString(pv.value)}"`;
            } else {
              result += ` ${key}={${pv.value}}`;
            }
          }
        }
      }
      result += `>${innerHtml}</${tag}>`;
    }
  }
  return result;
}

/**
 * Escapes a string value for use in JSX prop.
 * Uses JSON.stringify for proper JS string escaping.
 */
function escapeJsString(value: string): string {
  // Use JSON.stringify which handles all JS escaping, then remove the outer quotes
  return JSON.stringify(String(value)).slice(1, -1);
}

/**
 * Strips `<p>` wrappers from Fragment elements with slot attributes.
 *
 * markdown-rs sometimes wraps `<Fragment slot="...">` in paragraph tags,
 * which breaks Astro's slot system because the slot attribute is on Fragment,
 * not on the wrapping `<p>`.
 *
 * Before: `<p><Fragment slot="foo">content</Fragment></p>`
 * After:  `<Fragment slot="foo">content</Fragment>`
 */
function stripParagraphFragmentWrappers(input: string): string {
  // Pattern: <p><Fragment slot="...">...</Fragment></p>
  // We need to handle nested content, so we can't use a simple regex
  let result = '';
  let cursor = 0;

  while (cursor < input.length) {
    const matchStart = input.indexOf('<p><Fragment slot=', cursor);
    if (matchStart === -1) {
      result += input.slice(cursor);
      break;
    }

    // Push everything before this match
    result += input.slice(cursor, matchStart);

    // Find the matching </Fragment></p>
    const fragmentStart = matchStart + 3; // Skip "<p>"
    const fragmentEndTag = input.indexOf('</Fragment>', fragmentStart);

    if (fragmentEndTag !== -1) {
      const fragmentEnd = fragmentEndTag + '</Fragment>'.length;
      const afterFragment = input.slice(fragmentEnd);

      if (afterFragment.startsWith('</p>')) {
        // Extract just the Fragment element (without <p> wrapper)
        result += input.slice(fragmentStart, fragmentEnd);
        cursor = fragmentEnd + 4; // Skip "</p>"
        continue;
      }
    }

    // No match found, just push the "<p>" and continue
    result += '<p>';
    cursor = matchStart + 3;
  }

  return result;
}

/**
 * Normalizes slot content based on a slot normalization strategy.
 * Ensures content is wrapped in the appropriate list structure.
 *
 * @param slot - The slot HTML content to normalize
 * @param strategy - The normalization strategy ('wrap_in_ol' or 'wrap_in_ul')
 * @returns Normalized slot content with proper list wrapping
 */
function normalizeSlotByStrategy(slot: string, strategy: 'wrap_in_ol' | 'wrap_in_ul'): string {
  const tag = strategy === 'wrap_in_ol' ? 'ol' : 'ul';
  const trimmed = slot.trim();

  // Empty content: create minimal valid structure
  if (!trimmed) {
    return `<${tag}><li></li></${tag}>`;
  }

  // Check if content already has the correct wrapper
  if (trimmed.startsWith(`<${tag}`) && trimmed.endsWith(`</${tag}>`)) {
    // If already wrapped but missing <li>, add one
    return /<li[\s>]/i.test(trimmed)
      ? slot
      : trimmed.replace(`</${tag}>`, `<li></li></${tag}>`);
  }

  // Content needs wrapping
  return /<li[\s>]/i.test(trimmed)
    ? `<${tag}>${slot}</${tag}>`
    : `<${tag}><li>${slot}</li></${tag}>`;
}

/**
 * Extract imported names from a list of import statements.
 * Handles default imports, namespace imports, and named imports.
 */
function extractNamesFromImports(imports: string[]): Set<string> {
  const names = new Set<string>();
  for (const imp of imports) {
    // Default import: import Foo from 'module'
    const defaultMatch = imp.match(/^import\s+([A-Za-z$_][\w$]*)\s*(?:,|\s+from\s)/);
    if (defaultMatch?.[1]) {
      names.add(defaultMatch[1]);
    }

    // Namespace import: import * as Foo from 'module'
    const namespaceMatch = imp.match(/^import\s+\*\s+as\s+([A-Za-z$_][\w$]*)\s+from/);
    if (namespaceMatch?.[1]) {
      names.add(namespaceMatch[1]);
    }

    // Named imports: import { Foo, Bar as Baz } from 'module'
    // Also handles: import Default, { Foo, Bar } from 'module'
    const namedMatch = imp.match(/import\s+(?:[A-Za-z$_][\w$]*\s*,\s*)?{([^}]+)}\s+from/);
    if (namedMatch?.[1]) {
      const parts = namedMatch[1].split(',');
      for (const part of parts) {
        const item = part.trim();
        if (!item) continue;
        const segments = item.split(/\s+as\s+/);
        const name = segments[1] ?? segments[0];
        if (name) {
          names.add(name.trim());
        }
      }
    }
  }
  return names;
}

/**
 * Converts blocks array from Rust compiler into JSX code with component imports and exports.
 *
 * @param blocks - Array of blocks from compiler
 * @param frontmatter - Frontmatter object to export
 * @param headings - Headings array to export
 * @param registry - Component registry for import resolution
 * @param filename - Optional filename for module ID
 * @param userImports - User import statements to preserve (these take precedence over registry)
 * @returns Complete JSX module code with imports, exports, and default component
 */
export function blocksToJsx(
  blocks: Block[],
  frontmatter: Record<string, unknown> = {},
  headings: HeadingEntry[] = [],
  registry: BlocksRegistry | null = null,
  filename?: string,
  userImports: string[] = [],
): string {
  const fragments: string[] = [];
  const componentImports = new Map<string, { modulePath: string; exportType: string }>();

  // Extract names from user imports to avoid generating duplicate imports
  const userImportedNames = extractNamesFromImports(userImports);

  // Get supported directives from registry if available
  const supportedDirectives = registry?.getSupportedDirectives() ?? [];

  for (const block of blocks) {
    if (block.type === 'html') {
      // Use set:html to avoid HTML entity parsing issues with esbuild
      // JSON.stringify handles all escaping; Astro parses the HTML at runtime
      fragments.push(`<_Fragment set:html={${JSON.stringify(block.content ?? '')}} />`);
    } else if (block.type === 'code') {
      // Always render as HTML <pre><code>; ExpressiveCode rewriting happens in pipeline
      const langAttr = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
      const html = `<pre class="astro-code" tabindex="0"><code${langAttr}>${escapeHtml(block.code ?? '')}</code></pre>`;
      fragments.push(`<_Fragment set:html={${JSON.stringify(html)}} />`);
    } else if (block.type === 'component') {
      // Handle directive components using registry
      const isDirective = block.name ? supportedDirectives.includes(block.name) : false;
      let componentName = block.name ?? '';
      let effectiveProps = block.props;

      // Separate Fragment-with-slot children from regular children.
      // Fragment VNodes with `slot` props are unwrapped by Astro's renderJSX
      // before slot distribution, losing the slot assignment. We render them
      // as <span style="display:contents" slot="name"> instead.
      const allChildren = block.slotChildren ?? [];
      const regularChildren: Block[] = [];
      const fragmentSlotChildren: { slotName: string; inner: Block[] }[] = [];

      for (const child of allChildren) {
        if (
          child.type === 'component' &&
          child.name === 'Fragment' &&
          child.props
        ) {
          const slotProp = child.props.slot;
          const slotName =
            typeof slotProp === 'object' && slotProp !== null && 'type' in slotProp && 'value' in slotProp
              ? (slotProp as PropValue).value
              : typeof slotProp === 'string'
                ? slotProp
                : undefined;
          if (slotName) {
            fragmentSlotChildren.push({ slotName, inner: child.slotChildren ?? [] });
            continue;
          }
        }
        regularChildren.push(child);
      }

      // Convert regular (non-fragment-slot) children to HTML string for slot processing
      let effectiveSlot = stripParagraphFragmentWrappers(
        slotChildrenToHtml(regularChildren, componentImports, registry ?? undefined, userImportedNames)
      );

      if (isDirective && registry && block.name) {
        const mapping = registry.getDirectiveMapping(block.name);
        if (mapping) {
          componentName = mapping.component;
          // Apply injected props from mapping
          if (mapping.injectProps) {
            const injectedProps: Record<string, PropValue> = {};
            for (const [propKey, propSource] of Object.entries(mapping.injectProps)) {
              if (propSource.source === 'directive_name') {
                injectedProps[propKey] = { type: 'literal', value: block.name };
              } else if (propSource.source === 'literal' && propSource.value) {
                injectedProps[propKey] = { type: 'literal', value: propSource.value };
              }
            }
            effectiveProps = { ...block.props, ...injectedProps };
          }
        }
      }

      // Apply slot normalization from registry (e.g., Steps → wrap_in_ol, FileTree → wrap_in_ul)
      const slotNorm = registry?.getSlotNormalization(componentName);
      if (slotNorm) {
        effectiveSlot = normalizeSlotByStrategy(effectiveSlot, slotNorm.strategy);
      }

      // Skip Fragment (built-in) and user-imported components
      if (componentName !== 'Fragment' && !userImportedNames.has(componentName)) {
        const componentDef = registry?.getComponent(componentName);
        const modulePath = componentDef?.modulePath ?? '@astrojs/starlight/components';
        const exportType = componentDef?.exportType ?? 'default';
        componentImports.set(componentName, { modulePath, exportType });
      }

      const propsStr = effectiveProps
        ? Object.entries(effectiveProps)
            .map(([key, value]) => {
              // Handle PropValue enum from Rust: { type: "literal"|"expression", value: string }
              if (typeof value === 'object' && value !== null && 'type' in value && 'value' in value) {
                const propValue = value as PropValue;
                if (propValue.type === 'literal') {
                  return `${key}="${escapeJsString(propValue.value)}"`;
                } else if (propValue.type === 'expression') {
                  return `${key}={${propValue.value}}`;
                }
              }
              if (typeof value === 'string') {
                return `${key}="${escapeJsString(value)}"`;
              }
              return `${key}={${JSON.stringify(value)}}`;
            })
            .join(' ')
        : '';

      // Handle slot content: use set:html for pure HTML, but embed JSX directly for nested components
      const hasAnyContent = effectiveSlot || fragmentSlotChildren.length > 0;
      if (hasAnyContent) {
        const propsAttr = propsStr ? ` ${propsStr}` : '';
        let children = '';

        // Default slot content (regular children)
        if (effectiveSlot) {
          // Check if slot contains JSX components (true PascalCase tags like <Card, <Aside, etc.)
          // These need to be embedded directly so Astro processes them as components
          // Uses Rust implementation for consistency with codegen
          const hasNestedComponents = hasPascalCaseTag(effectiveSlot);

          // Fragment components should NEVER use set:html wrapper
          // The Fragment itself is the slot container, content should be direct children
          if (componentName === 'Fragment' || hasNestedComponents) {
            // Embed JSX directly so Astro processes slot content correctly
            // Convert HTML entities to JSX expressions so they render as text, not markup
            children += htmlEntitiesToJsx(effectiveSlot);
          } else {
            // Pure HTML content - use set:html for non-Fragment components
            children += `<_Fragment set:html={${JSON.stringify(effectiveSlot)}} />`;
          }
        }

        // Named slot children: render as <span style="display:contents" slot="name">
        // Using a real HTML element (not Fragment) so Astro's slot distribution
        // correctly assigns the content to the named slot.
        for (const { slotName, inner } of fragmentSlotChildren) {
          const innerHtml = slotChildrenToHtml(inner, componentImports, registry ?? undefined, userImportedNames);
          children += `<span style="display:contents" slot="${escapeJsString(slotName)}">`;
          if (innerHtml) {
            if (hasPascalCaseTag(innerHtml)) {
              children += htmlEntitiesToJsx(innerHtml);
            } else {
              children += `<_Fragment set:html={${JSON.stringify(innerHtml)}} />`;
            }
          }
          children += '</span>';
        }

        fragments.push(`<${componentName}${propsAttr}>${children}</${componentName}>`);
      } else {
        fragments.push(propsStr ? `<${componentName} ${propsStr} />` : `<${componentName} />`);
      }
    }
  }

  // Generate imports grouped by module path
  const importsByModule = new Map<string, { named: string[]; default: string[] }>();
  for (const [name, { modulePath, exportType }] of componentImports) {
    if (!importsByModule.has(modulePath)) {
      importsByModule.set(modulePath, { named: [], default: [] });
    }
    const entry = importsByModule.get(modulePath)!;
    if (exportType === 'named') {
      entry.named.push(name);
    } else {
      entry.default.push(name);
    }
  }

  const componentImportLines = Array.from(importsByModule.entries())
    .map(([modulePath, { named, default: defaults }]) => {
      const lines: string[] = [];
      if (named.length > 0) {
        lines.push(`import { ${named.join(', ')} } from '${modulePath}';`);
      }
      for (const name of defaults) {
        lines.push(`import ${name} from '${modulePath}/${name}.astro';`);
      }
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n');

  const frontmatterJson = JSON.stringify(frontmatter);
  const headingsJson = JSON.stringify(headings);
  const jsxContent = fragments.join('\n');

  const runtimeImports = `import { createComponent, renderJSX } from 'astro/runtime/server/index.js';
import { Fragment, Fragment as _Fragment, jsx as _jsx } from 'astro/jsx-runtime';`;

  // User imports (from the original MDX file)
  const userImportLines = userImports.length > 0 ? userImports.join('\n') : '';

  const moduleId = filename ? JSON.stringify(filename) : 'undefined';

  // Include user imports after runtime imports, before registry imports
  const allImports = [runtimeImports, userImportLines, componentImportLines]
    .filter(Boolean)
    .join('\n');

  return `${allImports}
export const frontmatter = ${frontmatterJson};
export function getHeadings() { return ${headingsJson}; }
function _Content() {
  return (
    <_Fragment>
${jsxContent}
    </_Fragment>
  );
}
const XmdxContent = createComponent(
  (result, props, _slots) => renderJSX(result, _jsx(_Content, { ...props })),
  ${moduleId}
);
export const Content = XmdxContent;
export default XmdxContent;
`;
}
