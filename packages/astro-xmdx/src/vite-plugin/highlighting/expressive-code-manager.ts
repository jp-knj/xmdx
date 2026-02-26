/**
 * Manages ExpressiveCode engine lifecycle as a lazy singleton.
 * Pre-renders code blocks at build time to avoid SSG overhead.
 * @module vite-plugin/expressive-code-manager
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { ExpressiveCodeConfig } from '../../utils/config.js';

// Use createRequire to avoid Vite module runner issues during buildStart
const require = createRequire(import.meta.url);

/**
 * ExpressiveCode rendering result with highlighted HTML.
 */
export interface ExpressiveCodeRenderResult {
  /** The rendered HTML string */
  html: string;
  /** CSS styles to inject */
  styles?: string;
}

/**
 * ExpressiveCode engine interface (matches expressive-code package).
 */
interface ExpressiveCodeEngine {
  render(options: {
    code: string;
    language?: string;
    meta?: string;
  }): Promise<{
    renderedGroupContents: Array<{ codeBlock: { code: string }; renderedBlockHtml: string }>;
    styles: string;
  }>;
}

/**
 * Creates a fast hash for cache keys.
 * Uses MD5 for speed (not security-sensitive).
 */
function hashCode(lang: string, code: string): string {
  return createHash('md5').update(`${lang}\0${code}`).digest('hex');
}

/**
 * Manages ExpressiveCode engine initialization and rendering.
 * Similar to ShikiManager, provides lazy initialization and caching.
 */
export class ExpressiveCodeManager {
  private engine: ExpressiveCodeEngine | null = null;
  private initPromise: Promise<ExpressiveCodeEngine | null> | null = null;
  private config: ExpressiveCodeConfig | null;
  private renderCache = new Map<string, string>();
  private collectedStyles = '';
  /**
   * When true, Starlight's own EC integration handles rendering.
   * xmdx still rewrites `<pre><code>` → `<Code>` but skips pre-rendering
   * to avoid theme/config mismatches and double-processing.
   */
  readonly starlightHandlesRendering: boolean;

  constructor(config: ExpressiveCodeConfig | null, starlightHandlesRendering = false) {
    this.config = config;
    this.starlightHandlesRendering = starlightHandlesRendering;
  }

  /**
   * Whether ExpressiveCode is enabled.
   */
  get enabled(): boolean {
    return this.config !== null;
  }

  /**
   * Lazily initializes the ExpressiveCode engine.
   * Returns null if ExpressiveCode is not configured or if Starlight handles rendering.
   */
  async init(): Promise<ExpressiveCodeEngine | null> {
    if (!this.config) return null;
    // Skip engine initialization when Starlight handles rendering.
    // Starlight's EC integration uses its own theme config and plugins;
    // initializing our own engine would waste startup time and risk mismatches.
    if (this.starlightHandlesRendering) return null;
    if (this.engine) return this.engine;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.createEngine();
    this.engine = await this.initPromise;
    return this.engine;
  }

  /**
   * Creates the ExpressiveCode engine with default configuration.
   */
  private async createEngine(): Promise<ExpressiveCodeEngine | null> {
    try {
      // Use require() to avoid Vite module runner issues during buildStart
      // (Vite's module runner may be closed when buildStart runs)
      const { ExpressiveCode } = require('expressive-code') as {
        ExpressiveCode: new (options: {
          useDarkModeMediaQuery?: boolean;
          themeCssSelector?: (theme: { type: string }) => string;
        }) => ExpressiveCodeEngine;
      };

      // Create engine with minimal configuration
      // Themes will be loaded from bundled defaults
      const engine = new ExpressiveCode({
        // Standard defaults - use dark mode media query for theme switching
        useDarkModeMediaQuery: true,
        themeCssSelector: (theme: { type: string }) => `[data-theme="${theme.type}"]`,
      });

      return engine;
    } catch (error) {
      console.warn('[xmdx] Failed to initialize ExpressiveCode engine:', error);
      return null;
    }
  }

  /**
   * Renders a code block and returns highlighted HTML.
   * Uses content-addressable caching for duplicate blocks.
   *
   * @param code - The code content to highlight
   * @param lang - Optional language identifier
   * @returns Rendered HTML or null if engine not available
   */
  async render(code: string, lang?: string): Promise<string | null> {
    const engine = await this.init();
    if (!engine) return null;

    // Check cache first
    const cacheKey = hashCode(lang ?? 'text', code);
    const cached = this.renderCache.get(cacheKey);
    if (cached) return cached;

    try {
      const result = await engine.render({
        code,
        language: lang ?? 'text',
      });

      // Collect styles (only once per unique set)
      if (result.styles && !this.collectedStyles.includes(result.styles)) {
        this.collectedStyles += result.styles;
      }

      // Get the rendered HTML from the first block
      const html = result.renderedGroupContents[0]?.renderedBlockHtml ?? null;
      if (html) {
        this.renderCache.set(cacheKey, html);
      }
      return html;
    } catch (error) {
      console.warn(`[xmdx] ExpressiveCode render failed for ${lang ?? 'text'}:`, error);
      return null;
    }
  }

  /**
   * Gets all collected styles for injection.
   */
  getStyles(): string {
    return this.collectedStyles;
  }

  /**
   * Clears the render cache (useful for watch mode).
   */
  clearCache(): void {
    this.renderCache.clear();
  }
}
