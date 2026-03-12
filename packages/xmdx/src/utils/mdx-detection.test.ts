import { describe, it, expect } from 'bun:test';
import { stripCodeFences, detectProblematicMdxPatterns } from './mdx-detection.js';

describe('stripCodeFences', () => {
  it('should strip basic 3-backtick fence', () => {
    const input = 'before\n```js\nconst x = 1;\n```\nafter';
    const result = stripCodeFences(input);
    expect(result).toBe('before\nafter');
  });

  it('should strip tilde fences', () => {
    const input = 'before\n~~~\ncode\n~~~\nafter';
    const result = stripCodeFences(input);
    expect(result).toBe('before\nafter');
  });

  it('should handle 4-backtick fence containing 3-backtick content', () => {
    const input = 'before\n````md\n```\nnested\n```\n````\nafter';
    const result = stripCodeFences(input);
    expect(result).toBe('before\nafter');
  });

  it('should not close fence with shorter marker', () => {
    const input = 'before\n````\n```\nstill inside\n````\nafter';
    const result = stripCodeFences(input);
    expect(result).toBe('before\nafter');
  });

  it('should not close fence with different marker type', () => {
    const input = 'before\n```\n~~~\nstill inside\n```\nafter';
    const result = stripCodeFences(input);
    expect(result).toBe('before\nafter');
  });

  it('should not treat closing fence with info string as closer', () => {
    const input = 'before\n```\n```js\nstill inside\n```\nafter';
    const result = stripCodeFences(input);
    // ```js has an info string so it's not a valid closer; the next ``` closes it
    expect(result).toBe('before\nafter');
  });
});

describe('detectProblematicMdxPatterns', () => {
  it('should detect no patterns in plain markdown', () => {
    const source = `# Hello\n\nThis is plain markdown.`;
    const result = detectProblematicMdxPatterns(source);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should detect import statements', () => {
    const source = `import { something } from 'unknown-package';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source);
    expect(result.hasProblematicPatterns).toBe(true);
  });

  it('should not detect imports inside code fences', () => {
    const source = "# Hello\n\n```js\nimport { something } from 'unknown-package';\n```\n";
    const result = detectProblematicMdxPatterns(source, { ignoreCodeFences: true });
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow imports matching allowImports patterns', () => {
    const source = `import Foo from './Foo.astro';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, { allowImports: ['./*'] });
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should flag imports not matching allowImports patterns', () => {
    const source = `import { something } from 'unknown-package';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, { allowImports: ['./*'] });
    expect(result.hasProblematicPatterns).toBe(true);
    expect(result.disallowedImports).toContain('unknown-package');
  });
});
