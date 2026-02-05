/**
 * Manages Shiki highlighter lifecycle as a lazy singleton.
 * @module vite-plugin/shiki-manager
 */

import { createShikiHighlighter } from './shiki-highlighter.js';
import type { ShikiHighlighter } from '../transforms/shiki.js';

export class ShikiManager {
  private instance: Promise<ShikiHighlighter> | undefined;
  private enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Returns the Shiki highlighter promise, initializing on first call.
   * Returns null if Shiki is disabled or code has no `<pre>` tags.
   */
  async getFor(code: string): Promise<ShikiHighlighter | null> {
    if (!this.enabled || !ShikiManager.hasCodeBlocks(code)) return null;
    if (!this.instance) {
      this.instance = createShikiHighlighter();
    }
    return this.instance.catch(() => null);
  }

  /**
   * Eagerly initializes the highlighter (e.g. in buildStart).
   * Returns the resolved highlighter or null.
   */
  async init(): Promise<ShikiHighlighter | null> {
    if (!this.enabled) return null;
    if (!this.instance) {
      this.instance = createShikiHighlighter();
    }
    return this.instance.catch(() => null);
  }

  /**
   * Returns the already-resolved highlighter for code with pre tags,
   * using a pre-resolved instance to avoid extra awaits in hot paths.
   */
  forCode(code: string, resolved: ShikiHighlighter | null): ShikiHighlighter | null {
    if (!this.enabled || !resolved || !ShikiManager.hasCodeBlocks(code)) return null;
    return resolved;
  }

  static hasCodeBlocks(code: string): boolean {
    return /<pre[\s>]/.test(code);
  }
}
