/**
 * Import statement manipulation utilities
 * @module utils/imports
 */

import { stripCodeFences } from './mdx-detection.js';

/**
 * Collect all imported names from JavaScript/JSX code.
 * Handles default imports, namespace imports, and named imports.
 *
 * @example
 * const code = `
 *   import React from 'react';
 *   import { useState, useEffect } from 'react';
 *   import * as utils from './utils';
 * `;
 * const names = collectImportedNames(code);
 * // Set { 'React', 'useState', 'useEffect', 'utils' }
 */
export function collectImportedNames(code: string): Set<string> {
  const imported = new Set<string>();
  if (!code || typeof code !== 'string') {
    return imported;
  }
  // Strip code fences to avoid false positives from code examples
  const codeWithoutFences = stripCodeFences(code);
  const lines = codeWithoutFences.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('import ') || trimmed.startsWith('import(')) {
      continue;
    }

    // Default import: import Foo from 'module'
    const defaultMatch = trimmed.match(
      /^import\s+([A-Za-z$_][\w$]*)\s*(?:,|\s+from\s)/
    );
    if (defaultMatch?.[1]) {
      imported.add(defaultMatch[1]);
    }

    // Namespace import: import * as Foo from 'module'
    const namespaceMatch = trimmed.match(
      /^import\s+\*\s+as\s+([A-Za-z$_][\w$]*)\s+from/
    );
    if (namespaceMatch?.[1]) {
      imported.add(namespaceMatch[1]);
    }

    // Named imports: import { Foo, Bar as Baz } from 'module'
    const namedMatch = trimmed.match(/import\s+{([^}]+)}\s+from/);
    if (namedMatch?.[1]) {
      const parts = namedMatch[1].split(',');
      for (const part of parts) {
        const item = part.trim();
        if (!item) continue;
        const segments = item.split(/\s+as\s+/);
        const name = segments[1] ?? segments[0];
        if (name) {
          imported.add(name.trim());
        }
      }
    }
  }
  return imported;
}

/**
 * Insert import statement after existing imports in code.
 * Finds the position after the last import statement and inserts the new import.
 *
 * @example
 * const code = `
 * import React from 'react';
 *
 * export default function App() {}
 * `;
 * const result = insertAfterImports(code, "import { Aside } from '@astrojs/starlight/components';");
 * // Inserts after the React import
 */
export function insertAfterImports(code: string, importLine: string): string {
  if (!code || typeof code !== 'string') {
    return importLine;
  }
  const lines = code.split(/\r?\n/);
  let idx = 0;
  while (idx < lines.length) {
    const trimmed = lines[idx]?.trim() ?? '';
    if (!trimmed) {
      idx += 1;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      idx += 1;
      continue;
    }
    if (trimmed.startsWith('import ')) {
      idx += 1;
      continue;
    }
    break;
  }

  // MDX requires a blank line between imports and markdown content.
  // Only add blank line if the next line is markdown content, not JavaScript.
  const nextLine = lines[idx]?.trim() ?? '';
  const isJavaScript = nextLine.startsWith('export ') ||
    nextLine.startsWith('const ') ||
    nextLine.startsWith('let ') ||
    nextLine.startsWith('var ') ||
    nextLine.startsWith('function ') ||
    nextLine.startsWith('class ') ||
    nextLine.startsWith('import ') ||
    nextLine.startsWith('//') ||
    nextLine.startsWith('/*');

  if (nextLine && !isJavaScript) {
    // There's markdown content after the insertion point; add blank line after the import
    lines.splice(idx, 0, importLine, '');
  } else {
    lines.splice(idx, 0, importLine);
  }
  return lines.join('\n');
}

/**
 * Extract import statements from MDX/JSX code.
 * Returns the full import statement strings, preserving their original form.
 *
 * Import statements end when:
 * 1. A semicolon is found
 * 2. The import completes (has 'from' + module path)
 * 3. The next line starts with a different statement type
 *
 * @example
 * const code = `
 * import Card from '~/components/Landing/Card.astro'
 * import { useState } from 'react';
 *
 * # Hello World
 * `;
 * const imports = extractImportStatements(code);
 * // ["import Card from '~/components/Landing/Card.astro'", "import { useState } from 'react';"]
 */
export function extractImportStatements(code: string): string[] {
  const imports: string[] = [];
  if (!code || typeof code !== 'string') {
    return imports;
  }
  // Strip code fences to avoid false positives from code examples
  const codeWithoutFences = stripCodeFences(code);
  const lines = codeWithoutFences.split(/\r?\n/);

  let currentImport = '';
  let inImport = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inImport) {
      // Start of new import statement
      if (trimmed.startsWith('import ') && !trimmed.startsWith('import(')) {
        // Check if import is complete on this line
        // Side-effect import: import './file.js' or import "styles.css" (no 'from' keyword)
        const isSideEffectImport = /^import\s+['"][^'"]+['"]/.test(trimmed);
        // Complete import has: import ... from '...' or import ... from "..."
        const hasFromClause = /from\s+['"][^'"]+['"]/.test(trimmed);
        if (isSideEffectImport || hasFromClause || trimmed.includes(';')) {
          // Complete single-line import (with or without semicolon)
          imports.push(trimmed);
        } else {
          // Start of multi-line import (e.g., multi-line named imports)
          inImport = true;
          currentImport = trimmed;
        }
      }
    } else {
      // Continue accumulating multi-line import
      // Strip inline // comments, but only outside of quoted strings
      const lineWithoutComment = trimmed.replace(/\s*\/\/.*$/, (match, offset) => {
        const before = trimmed.slice(0, offset);
        const singleQuotes = (before.match(/'/g) || []).length;
        const doubleQuotes = (before.match(/"/g) || []).length;
        // If inside a string (odd number of unescaped quotes), keep the match
        if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) return match;
        return '';
      });
      currentImport += ' ' + lineWithoutComment;
      const hasFromClause = /from\s+['"][^'"]+['"]/.test(currentImport);
      if (hasFromClause || trimmed.includes(';')) {
        // End of multi-line import
        imports.push(currentImport);
        currentImport = '';
        inImport = false;
      }
    }
  }

  return imports;
}
