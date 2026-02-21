import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { loadXmdxBinding, resetBindingPromise } from './binding-loader.js';

describe('loadXmdxBinding', () => {
  beforeEach(() => {
    resetBindingPromise();
    mock.restore();
  });

  test('loads binding from @xmdx/napi', async () => {
    const fakeBinding = { compileBatch: mock(() => ({})) };
    mock.module('@xmdx/napi', () => fakeBinding);

    const binding = await loadXmdxBinding();
    expect(typeof binding).toBe('object');
    expect('compileBatch' in binding).toBe(true);
  });

  test('caches the loaded binding promise', async () => {
    const fakeBinding = { compileBatch: mock(() => ({})) };
    mock.module('@xmdx/napi', () => fakeBinding);

    const a = await loadXmdxBinding();
    const b = await loadXmdxBinding();
    expect(a).toBe(b);
  });

});
