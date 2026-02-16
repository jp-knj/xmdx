import { test, expect } from 'bun:test';
import { createCompiler, compileBatchToModule, compileMdxBatch } from '../index.js';

test('createCompiler().compile() renders MDX task lists as checklist HTML', () => {
  const compiler = createCompiler();
  const source = `import Checklist from './Checklist.astro';

<Checklist>
- [ ] Looks great!
- [x] Already done!
</Checklist>`;

  const result = compiler.compile(source, '/virtual.mdx');

  expect(result.code.includes('[ ] Looks great!')).toBe(false);
  expect(result.code.includes('[x] Already done!')).toBe(false);
  expect(result.code.includes('task-list-item')).toBe(true);
  expect(result.code.includes('type=\\"checkbox\\"')).toBe(true);
  expect(result.code.includes('<label><input')).toBe(true);
  expect(result.code.includes('disabled checked')).toBe(true);
});

test('compileBatchToModule() uses same checklist output for .mdx files', () => {
  const source = `import Checklist from './Checklist.astro';

<Checklist>
- [ ] Looks great!
- [x] Already done!
</Checklist>`;

  const batchResult = compileBatchToModule(
    [{ id: '/virtual.mdx', filepath: '/virtual.mdx', source }],
    { continueOnError: false, config: {} }
  );

  const compiled = batchResult.results[0]?.result?.code ?? '';
  expect(compiled.length > 0).toBe(true);
  expect(compiled.includes('[ ] Looks great!')).toBe(false);
  expect(compiled.includes('[x] Already done!')).toBe(false);
  expect(compiled.includes('task-list-item')).toBe(true);
  expect(compiled.includes('type=\\"checkbox\\"')).toBe(true);
  expect(compiled.includes('<label><input')).toBe(true);
  expect(compiled.includes('disabled checked')).toBe(true);
});

test('compileMdxBatch() produces task list checkboxes in MDX output', () => {
  const source = `import Checklist from './Checklist.astro';

<Checklist>
- [ ] Looks great!
- [x] Already done!
</Checklist>`;

  const batchResult = compileMdxBatch(
    [{ id: '/virtual.mdx', filepath: '/virtual.mdx', source }],
    { continueOnError: false }
  );

  const compiled = batchResult.results[0]?.result?.code ?? '';
  expect(compiled.length > 0).toBe(true);
  // Should NOT contain raw bracket text
  expect(compiled.includes('[ ] Looks great!')).toBe(false);
  expect(compiled.includes('[x] Already done!')).toBe(false);
  // Should contain GFM task list output with label/span wrapping
  expect(compiled.includes('task-list-item')).toBe(true);
  expect(compiled.includes('checkbox')).toBe(true);
  expect(compiled.includes('"label"')).toBe(true);
  expect(compiled.includes('"span"')).toBe(true);
});

test('createCompiler().compile() renders checked [x] checkbox with checked attribute', () => {
  const compiler = createCompiler();
  const source = `import Checklist from './Checklist.astro';

<Checklist>
- [x] Already done!
</Checklist>`;

  const result = compiler.compile(source, '/virtual.mdx');

  expect(result.code.includes('task-list-item')).toBe(true);
  expect(result.code.includes('disabled checked')).toBe(true);
  expect(result.code.includes('<label><input')).toBe(true);
});

test('createCompiler().compile() renders unchecked [ ] checkbox without checked attribute', () => {
  const compiler = createCompiler();
  const source = `import Checklist from './Checklist.astro';

<Checklist>
- [ ] Not yet!
</Checklist>`;

  const result = compiler.compile(source, '/virtual.mdx');

  expect(result.code.includes('task-list-item')).toBe(true);
  expect(result.code.includes('disabled/')).toBe(true);
  expect(result.code.includes('disabled checked')).toBe(false);
  expect(result.code.includes('<label><input')).toBe(true);
});
