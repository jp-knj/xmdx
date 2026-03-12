/**
 * Server-side renderer for MDX components.
 * Provides compatibility with @astrojs/mdx server.js interface.
 * @module server
 */

import { AstroError } from 'astro/errors';
import { AstroJSX, jsx } from 'astro/jsx-runtime';
import { renderJSX } from 'astro/runtime/server/index.js';
import type { SSRResult } from 'astro';
import { toError, hasAstroJsxMarker, hasMdxComponentSymbol, addErrorHint, asString } from './ops/type-narrowing.js';

const slotName = (str: string): string =>
  str.trim().replace(/[-_]([a-z])/g, (_, w) => w.toUpperCase());

type ComponentType = (props: Record<string, unknown>) => unknown;
type Slots = { default?: unknown; [key: string]: unknown };

async function check(
  Component: ComponentType,
  props: Record<string, unknown>,
  { default: children = null, ...slotted }: Slots = {}
): Promise<boolean> {
  if (typeof Component !== 'function') return false;

  const slots: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(slotted)) {
    const name = slotName(key);
    slots[name] = value;
  }

  try {
    const result = await Component({ ...props, ...slots, children });
    return hasAstroJsxMarker(result, AstroJSX);
  } catch (e) {
    throwEnhancedErrorIfMdxComponent(toError(e), Component);
  }
  return false;
}

async function renderToStaticMarkup(
  this: { result: SSRResult },
  Component: ComponentType,
  props: Record<string, unknown> = {},
  { default: children = null, ...slotted }: Slots = {}
): Promise<{ html: string }> {
  const slots: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(slotted)) {
    const name = slotName(key);
    slots[name] = value;
  }

  const { result } = this;
  try {
    const html = await renderJSX(result, jsx(Component, { ...props, ...slots, children }));
    return { html: asString(html) };
  } catch (e) {
    throwEnhancedErrorIfMdxComponent(toError(e), Component);
    throw e;
  }
}

function throwEnhancedErrorIfMdxComponent(error: Error, Component: ComponentType): void {
  if (hasMdxComponentSymbol(Component)) {
    if (AstroError.is(error)) return;
    addErrorHint(error, error.name, 'This issue often occurs when your MDX component encounters runtime errors.');
    throw error;
  }
}

const renderer = {
  name: 'astro:jsx',
  check,
  renderToStaticMarkup,
};

export default renderer;
export { check, renderToStaticMarkup };
