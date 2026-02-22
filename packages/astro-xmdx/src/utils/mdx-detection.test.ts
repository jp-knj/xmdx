import { describe, it, expect } from 'bun:test';
import { stripCodeFences, detectProblematicMdxPatterns } from './mdx-detection.js';
import { STARLIGHT_DEFAULT_ALLOW_IMPORTS } from '../presets/index.js';

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

describe('detectProblematicMdxPatterns with STARLIGHT_DEFAULT_ALLOW_IMPORTS', () => {
  const opts = { allowImports: [...STARLIGHT_DEFAULT_ALLOW_IMPORTS], ignoreCodeFences: true };

  it('should allow @astrojs/starlight/components import', () => {
    const source = `import { Aside } from '@astrojs/starlight/components';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow @astrojs/starlight subpackage imports', () => {
    const source = `import something from '@astrojs/starlight/utils';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow astro:* virtual module imports', () => {
    const source = `import { getCollection } from 'astro:content';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow ~/components/* imports', () => {
    const source = `import MyChart from '~/components/MyChart.astro';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow relative imports starting with ./', () => {
    const source = `import MyWidget from './MyWidget.astro';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow relative imports starting with ../', () => {
    const source = `import MyComponent from '../components/MyComponent.astro';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow @/* alias imports', () => {
    const source = `import Header from '@/components/Header.astro';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow .astro file imports', () => {
    const source = `import Card from 'some-package/Card.astro';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow .tsx and .jsx file imports', () => {
    const source = `import Chart from './Chart.tsx';\nimport Graph from './Graph.jsx';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should allow image imports', () => {
    const source = `import logo from './logo.svg';\nimport photo from '../assets/photo.png';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should flag unknown npm package imports', () => {
    const source = `import { something } from 'unknown-package';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(true);
    expect(result.disallowedImports).toContain('unknown-package');
  });

  it('should not flag imports inside code fences', () => {
    const source = "# Hello\n\n```js\nimport { something } from 'unknown-package';\n```\n";
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(false);
  });

  it('should handle mixed allowed and disallowed imports', () => {
    const source = `import { Aside } from '@astrojs/starlight/components';\nimport { something } from 'unknown-package';\n\n# Hello`;
    const result = detectProblematicMdxPatterns(source, opts);
    expect(result.hasProblematicPatterns).toBe(true);
    expect(result.disallowedImports).toContain('unknown-package');
    expect(result.disallowedImports).not.toContain('@astrojs/starlight/components');
  });
});
