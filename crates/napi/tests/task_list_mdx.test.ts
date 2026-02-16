import { test, expect } from 'bun:test';
import { createCompiler, compileBatchToModule } from '../index.js';

test('createCompiler().compile() renders MDX task lists as checklist HTML', () => {
  const compiler = createCompiler();
  const source = `import Checklist from './Checklist.astro';

<Checklist>
- [ ] Looks great!
</Checklist>`;

  const result = compiler.compile(source, '/virtual.mdx');

  expect(result.code.includes('[ ] Looks great!')).toBe(false);
  expect(result.code.includes('task-list-item')).toBe(true);
  expect(result.code.includes('type=\\"checkbox\\"')).toBe(true);
  expect(result.code.includes('<label><input')).toBe(true);
});

test('compileBatchToModule() uses same checklist output for .mdx files', () => {
  const source = `import Checklist from './Checklist.astro';

<Checklist>
- [ ] Looks great!
</Checklist>`;

  const batchResult = compileBatchToModule(
    [{ id: '/virtual.mdx', filepath: '/virtual.mdx', source }],
    { continueOnError: false, config: {} }
  );

  const compiled = batchResult.results[0]?.result?.code ?? '';
  expect(compiled.length > 0).toBe(true);
  expect(compiled.includes('[ ] Looks great!')).toBe(false);
  expect(compiled.includes('task-list-item')).toBe(true);
  expect(compiled.includes('type=\\"checkbox\\"')).toBe(true);
  expect(compiled.includes('<label><input')).toBe(true);
});
