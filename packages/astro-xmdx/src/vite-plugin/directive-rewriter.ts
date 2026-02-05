/**
 * Directive rewriting utilities for fallback MDX compilation
 * @module vite-plugin/directive-rewriter
 */

import type { Registry } from 'xmdx/registry';
import { starlightLibrary } from 'xmdx/registry';
import { collectImportedNames, insertAfterImports } from '../utils/imports.js';

/**
 * Opening directive state for stack tracking.
 */
type DirectiveOpening = {
  name: string;
  bracketTitle: string | null;
  rawAttrs: string;
  prefix: string;  // Leading whitespace and blockquote markers (e.g., "  ", "> ", "  > > ")
  componentName: string;
};

/**
 * Escapes a value for use in an HTML/JSX attribute.
 */
function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Normalizes directive attributes, stripping outer braces and filtering out reserved attrs.
 */
function normalizeDirectiveAttrs(attrs: string, hasBracketTitle: boolean): string {
  if (!attrs) {
    return '';
  }

  // Strip outer braces from remark-directive syntax: {key="value"} → key="value"
  let normalized = attrs.trim();
  if (normalized.startsWith('{') && normalized.endsWith('}')) {
    normalized = normalized.slice(1, -1).trim();
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const cleaned: string[] = [];
  for (const tok of tokens) {
    const key = tok.split('=')[0]?.trim() ?? '';
    if (!key) continue;
    const lower = key.toLowerCase();
    if (lower === 'type') continue;
    if (hasBracketTitle && lower === 'title') continue;
    cleaned.push(tok);
  }
  return cleaned.join(' ');
}

/**
 * Parses an opening directive line (e.g., ":::note[Title]").
 */
function parseOpeningDirective(
  afterPrefix: string,
  supported: Set<string>,
  prefix: string
): { name: string; bracketTitle: string | null; rawAttrs: string; prefix: string } | null {
  // Content is already after the prefix; check for directive start
  if (!afterPrefix.startsWith(':::')) {
    return null;
  }

  let rest = afterPrefix.slice(3);
  let name = '';
  while (rest.length > 0 && /[A-Za-z]/.test(rest[0] ?? '')) {
    name += (rest[0] ?? '').toLowerCase();
    rest = rest.slice(1);
  }

  if (!name || !supported.has(name)) {
    return null;
  }

  let bracketTitle: string | null = null;
  if (rest.startsWith('[')) {
    rest = rest.slice(1);
    let title = '';
    while (rest.length > 0) {
      const ch = rest[0] ?? '';
      rest = rest.slice(1);
      if (ch === ']') {
        bracketTitle = title;
        break;
      }
      title += ch;
    }
  }

  const rawAttrs = normalizeDirectiveAttrs(rest.trim(), Boolean(bracketTitle));
  return { name, bracketTitle, rawAttrs, prefix };
}

/**
 * Parses a closing directive line (":::").
 */
function parseDirectiveCloser(afterPrefix: string, prefix: string): { prefix: string } | null {
  // Check if the content after prefix is exactly `:::`
  if (afterPrefix.trim() === ':::') {
    return { prefix };
  }
  return null;
}

/**
 * Rewrites directive syntax (:::note, :::tip, etc.) to JSX component syntax.
 * Used for fallback MDX compilation when xmdx-core can't handle the file.
 */
export function rewriteFallbackDirectives(
  source: string,
  registry: Registry | null,
  hasStarlightConfigured: boolean
): { code: string; usedComponents: Set<string>; changed: boolean } {
  if (!source) {
    return { code: source, usedComponents: new Set(), changed: false };
  }

  // Get directives from registry, fall back to starlightLibrary defaults
  const registryDirectives = registry?.getSupportedDirectives().map((name) => name.toLowerCase()) ?? [];
  const supportedSet = new Set(registryDirectives);

  // Add Starlight directives only if registry is empty AND Starlight is configured
  const useDefaultDirectives = supportedSet.size === 0 && hasStarlightConfigured;
  if (useDefaultDirectives) {
    const starlightDirectives = starlightLibrary.directiveMappings ?? [];
    for (const mapping of starlightDirectives) {
      supportedSet.add(mapping.directive.toLowerCase());
    }
  }

  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  const stack: DirectiveOpening[] = [];
  const usedComponents = new Set<string>();
  let changed = false;
  let inFence = false;
  let fenceChar: string | null = null;

  for (const line of lines) {
    // Extract prefix (whitespace + blockquote markers) like we do for directives
    const prefixMatch = line.match(/^(\s*(?:>\s*)*)/);
    const prefix = prefixMatch?.[1] ?? '';
    const afterPrefix = line.slice(prefix.length);

    // Check for code fence after stripping prefix (handles blockquoted code fences)
    const fenceMatch = afterPrefix.match(/^([`~]{3,})/);
    if (fenceMatch) {
      const char = fenceMatch[1]?.[0] ?? null;
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char && fenceChar === char) {
        inFence = false;
        fenceChar = null;
      }
      output.push(line);
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    const opening = parseOpeningDirective(afterPrefix, supportedSet, prefix);
    if (opening) {
      // Try registry first, then fall back to starlightLibrary
      const mapping = registry?.getDirectiveMapping(opening.name)
        ?? (useDefaultDirectives
          ? starlightLibrary.directiveMappings?.find(m => m.directive.toLowerCase() === opening.name)
          : null);
      if (!mapping) {
        output.push(line);
        continue;
      }

      const componentName = mapping.component;
      const props: string[] = ['data-mf-source="directive"'];
      if (mapping.injectProps) {
        for (const [propKey, propSource] of Object.entries(mapping.injectProps)) {
          if (propSource.source === 'directive_name') {
            props.push(`${propKey}="${escapeAttributeValue(opening.name)}"`);
          } else if (propSource.source === 'bracket_title' && opening.bracketTitle) {
            props.push(`${propKey}="${escapeAttributeValue(opening.bracketTitle)}"`);
          } else if (propSource.source === 'literal' && propSource.value) {
            props.push(`${propKey}="${escapeAttributeValue(propSource.value)}"`);
          }
        }
      }

      if (opening.bracketTitle) {
        props.push(`title="${escapeAttributeValue(opening.bracketTitle)}"`);
      }
      if (opening.rawAttrs) {
        props.push(opening.rawAttrs);
      }

      const propsStr = props.length > 0 ? ` ${props.join(' ')}` : '';
      output.push(`${opening.prefix}<${componentName}${propsStr}>`);
      stack.push({ ...opening, componentName });
      usedComponents.add(componentName);
      changed = true;
      continue;
    }

    const closer = parseDirectiveCloser(afterPrefix, prefix);
    if (closer && stack.length > 0) {
      const opened = stack.pop();
      if (opened) {
        output.push(`${opened.prefix}</${opened.componentName}>`);
        changed = true;
        continue;
      }
    }

    output.push(line);
  }

  while (stack.length > 0) {
    const opened = stack.pop();
    if (opened) {
      output.push(`${opened.prefix}</${opened.componentName}>`);
    }
  }

  return { code: output.join('\n'), usedComponents, changed };
}

/**
 * Injects component imports for components used in rewritten directives.
 */
export function injectFallbackImports(
  source: string,
  usedComponents: Set<string>,
  registry: Registry | null,
  hasStarlightConfigured: boolean
): string {
  if (!source || usedComponents.size === 0) {
    return source;
  }

  const imported = collectImportedNames(source);
  const importLines: string[] = [];

  for (const componentName of usedComponents) {
    if (imported.has(componentName)) {
      continue;
    }
    const def = registry?.getComponent(componentName);
    if (def) {
      if (def.exportType === 'named') {
        importLines.push(`import { ${componentName} } from '${def.modulePath}';`);
      } else {
        importLines.push(`import ${componentName} from '${def.modulePath}/${componentName}.astro';`);
      }
    } else if (componentName === 'Aside' && hasStarlightConfigured) {
      // Fallback for Starlight Aside component when using default directives
      // Only inject if Starlight is actually configured to avoid module-not-found errors
      importLines.push(`import { Aside } from '@astrojs/starlight/components';`);
    }
  }

  if (importLines.length === 0) {
    return source;
  }

  return insertAfterImports(source, importLines.join('\n'));
}
