import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ShikiManager } from './shiki-manager.js';

// Mock the shiki-highlighter module
const mockHighlighter = mock(async (code: string, lang?: string) => {
  return `<pre class="shiki"><code class="language-${lang || 'text'}">${code}</code></pre>`;
});

let createShikiHighlighterMock: ReturnType<typeof mock>;

beforeEach(() => {
  createShikiHighlighterMock = mock(() => Promise.resolve(mockHighlighter));
  mock.module('./shiki-highlighter.js', () => ({
    createShikiHighlighter: createShikiHighlighterMock,
  }));
});

afterEach(() => {
  mock.restore();
});

describe('ShikiManager', () => {
  describe('constructor', () => {
    test('creates manager with enabled=true', () => {
      const manager = new ShikiManager(true);
      expect(manager).toBeInstanceOf(ShikiManager);
    });

    test('creates manager with enabled=false', () => {
      const manager = new ShikiManager(false);
      expect(manager).toBeInstanceOf(ShikiManager);
    });
  });

  describe('getFor', () => {
    test('returns null when disabled', async () => {
      const manager = new ShikiManager(false);
      const result = await manager.getFor('<pre><code>const x = 1;</code></pre>');
      expect(result).toBeNull();
    });

    test('returns null when code has no <pre> tags', async () => {
      const manager = new ShikiManager(true);
      const result = await manager.getFor('<div>No code blocks here</div>');
      expect(result).toBeNull();
    });

    test('returns highlighter when enabled and code has <pre>', async () => {
      const manager = new ShikiManager(true);
      const result = await manager.getFor('<pre><code>const x = 1;</code></pre>');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('function');
    });

    test('initializes highlighter lazily on first call', async () => {
      const manager = new ShikiManager(true);

      // First call with code that has <pre>
      const result1 = await manager.getFor('<pre><code>first</code></pre>');
      expect(result1).not.toBeNull();

      // Second call should return same instance
      const result2 = await manager.getFor('<pre><code>second</code></pre>');
      expect(result2).toBe(result1);
    });

    test('handles highlighter initialization failure gracefully', async () => {
      // Create a manager where initialization will fail
      mock.module('./shiki-highlighter.js', () => ({
        createShikiHighlighter: () => Promise.reject(new Error('Shiki init failed')),
      }));

      const manager = new ShikiManager(true);
      const result = await manager.getFor('<pre><code>code</code></pre>');
      expect(result).toBeNull();
    });
  });

  describe('init', () => {
    test('returns null when disabled', async () => {
      const manager = new ShikiManager(false);
      const result = await manager.init();
      expect(result).toBeNull();
    });

    test('returns highlighter when enabled', async () => {
      const manager = new ShikiManager(true);
      const result = await manager.init();
      expect(result).not.toBeNull();
      expect(typeof result).toBe('function');
    });

    test('initializes only once on multiple calls', async () => {
      const manager = new ShikiManager(true);

      const result1 = await manager.init();
      const result2 = await manager.init();

      expect(result1).toBe(result2);
    });

    test('handles initialization failure gracefully', async () => {
      mock.module('./shiki-highlighter.js', () => ({
        createShikiHighlighter: () => Promise.reject(new Error('Init failed')),
      }));

      const manager = new ShikiManager(true);
      const result = await manager.init();
      expect(result).toBeNull();
    });
  });

  describe('forCode', () => {
    test('returns null when disabled', () => {
      const manager = new ShikiManager(false);
      const resolved = mockHighlighter as unknown as Awaited<ReturnType<typeof mockHighlighter>>;
      const result = manager.forCode('<pre><code>code</code></pre>', resolved);
      expect(result).toBeNull();
    });

    test('returns null when resolved is null', () => {
      const manager = new ShikiManager(true);
      const result = manager.forCode('<pre><code>code</code></pre>', null);
      expect(result).toBeNull();
    });

    test('returns null when code has no <pre> tags', () => {
      const manager = new ShikiManager(true);
      const resolved = mockHighlighter as unknown as Awaited<ReturnType<typeof mockHighlighter>>;
      const result = manager.forCode('<div>no pre</div>', resolved);
      expect(result).toBeNull();
    });

    test('returns resolved highlighter when all conditions met', () => {
      const manager = new ShikiManager(true);
      const resolved = mockHighlighter as unknown as Awaited<ReturnType<typeof mockHighlighter>>;
      const result = manager.forCode('<pre><code>code</code></pre>', resolved);
      expect(result).toBe(resolved);
    });
  });

  describe('hasCodeBlocks (static)', () => {
    test('returns true for code with <pre>', () => {
      expect(ShikiManager.hasCodeBlocks('<pre><code>code</code></pre>')).toBe(true);
    });

    test('returns true for code with <pre and space', () => {
      expect(ShikiManager.hasCodeBlocks('<pre class="foo"><code>code</code></pre>')).toBe(true);
    });

    test('returns true for code with <pre>', () => {
      expect(ShikiManager.hasCodeBlocks('<pre>')).toBe(true);
    });

    test('returns false for code without <pre', () => {
      expect(ShikiManager.hasCodeBlocks('<div>no pre here</div>')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(ShikiManager.hasCodeBlocks('')).toBe(false);
    });

    test('returns false for text containing "pre" without tag', () => {
      expect(ShikiManager.hasCodeBlocks('This is a preview of the content')).toBe(false);
    });

    test('returns true for pre tag at start of string', () => {
      expect(ShikiManager.hasCodeBlocks('<pre>code</pre>')).toBe(true);
    });

    test('returns true for pre tag with attributes', () => {
      expect(ShikiManager.hasCodeBlocks('<pre data-language="js"><code>code</code></pre>')).toBe(true);
    });
  });
});
