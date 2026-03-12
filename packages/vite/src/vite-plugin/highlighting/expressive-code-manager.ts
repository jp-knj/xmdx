/**
 * Manages ExpressiveCode engine lifecycle as a lazy singleton.
 * Pre-renders code blocks at build time to avoid SSG overhead.
 * @module vite-plugin/expressive-code-manager
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ExpressiveCodeConfig } from 'xmdx/utils/config';
import { asBinding } from 'xmdx/ops';

// Use createRequire to avoid Vite module runner issues during buildStart
const require = createRequire(import.meta.url);
export const DEFAULT_EXPRESSIVE_CODE_MODULE_ID = 'astro-expressive-code/components';

export interface ExpressiveCodeSupport {
  canRewriteRuntime: boolean;
  canPreRenderEngine: boolean;
}

function isBareSpecifier(moduleId: string): boolean {
  return !moduleId.startsWith('.') && !path.isAbsolute(moduleId) && !moduleId.startsWith('\0');
}

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
   * Whether the configured runtime module is available for `<Code />` rewrites,
   * and whether the local ExpressiveCode engine can pre-render code blocks.
   */
  async getSupport(moduleId: string, projectRoot?: string): Promise<ExpressiveCodeSupport> {
    if (!this.config) {
      return { canRewriteRuntime: false, canPreRenderEngine: false };
    }
    if (this.starlightHandlesRendering) {
      return { canRewriteRuntime: true, canPreRenderEngine: false };
    }

    const canRewriteRuntime = this.canResolveRuntime(moduleId, projectRoot);
    const canPreRenderEngine = (await this.init()) !== null;
    return { canRewriteRuntime, canPreRenderEngine };
  }

  /**
   * Whether it is safe to rewrite code blocks to temporary `<Code />` components.
   * Rewriting is safe when the runtime import can survive to output, or when
   * the local engine can pre-render and strip the temporary import before emit.
   */
  async canRewrite(moduleId: string, projectRoot?: string): Promise<boolean> {
    const support = await this.getSupport(moduleId, projectRoot);
    return support.canRewriteRuntime || support.canPreRenderEngine;
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

    this.engine = this.createEngine();
    this.initPromise = Promise.resolve(this.engine);
    return this.engine;
  }

  /**
   * Creates the ExpressiveCode engine with default configuration.
   */
  private createEngine(): ExpressiveCodeEngine | null {
    try {
      // Use require() to avoid Vite module runner issues during buildStart
      // (Vite's module runner may be closed when buildStart runs)
      const { ExpressiveCode } = asBinding<{
        ExpressiveCode: new (options: {
          useDarkModeMediaQuery?: boolean;
          themeCssSelector?: (theme: { type: string }) => string;
        }) => ExpressiveCodeEngine;
      }>(require('expressive-code'));

      // Create engine with minimal configuration
      // Themes will be loaded from bundled defaults
      const engine = new ExpressiveCode({
        // Standard defaults - use dark mode media query for theme switching
        useDarkModeMediaQuery: true,
        themeCssSelector: (theme: { type: string }) => `[data-theme="${theme.type}"]`,
      });

      return engine;
    } catch {
      console.warn(
        '[xmdx] expressiveCode is enabled but the "expressive-code" package is not installed.\n' +
        'Install it with: npm install expressive-code\n' +
        'Or disable it: xmdx({ expressiveCode: false })'
      );
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

  private canResolveRuntime(moduleId: string, projectRoot?: string): boolean {
    if (!isBareSpecifier(moduleId)) {
      return true;
    }

    try {
      const projectRequire = createRequire(path.join(projectRoot ?? process.cwd(), 'package.json'));
      projectRequire.resolve(moduleId);
      return true;
    } catch {
      return false;
    }
  }
}
