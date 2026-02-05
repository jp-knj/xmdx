import { describe, it, expect } from 'bun:test';
import { stripCodeFences } from './mdx-detection.js';

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
