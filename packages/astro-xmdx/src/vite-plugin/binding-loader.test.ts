import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  getNativeBinaryCandidates,
  loadXmdxBinding,
  resetBindingPromise,
  selectCompatibleNodeFile,
} from './binding-loader.js';

describe('getNativeBinaryCandidates', () => {
  test('prefers gnu before musl for linux x64 when libc is gnu', () => {
    const candidates = getNativeBinaryCandidates('linux', 'x64', 'gnu');
    expect(candidates[0]).toBe('xmdx.linux-x64-gnu.node');
    expect(candidates[1]).toBe('xmdx-linux-x64-gnu.node');
    expect(candidates.indexOf('xmdx.linux-x64-gnu.node')).toBeLessThan(candidates.indexOf('xmdx.linux-x64-musl.node'));
  });

  test('prefers musl before gnu for linux arm64 when libc is musl', () => {
    const candidates = getNativeBinaryCandidates('linux', 'arm64', 'musl');
    expect(candidates[0]).toBe('xmdx.linux-arm64-musl.node');
    expect(candidates[1]).toBe('xmdx-linux-arm64-musl.node');
    expect(candidates.indexOf('xmdx.linux-arm64-musl.node')).toBeLessThan(candidates.indexOf('xmdx.linux-arm64-gnu.node'));
  });

  test('uses gnu-first order when linux libc is unknown', () => {
    const candidates = getNativeBinaryCandidates('linux', 'x64', null);
    expect(candidates.indexOf('xmdx.linux-x64-gnu.node')).toBeLessThan(candidates.indexOf('xmdx.linux-x64-musl.node'));
  });
});

describe('selectCompatibleNodeFile', () => {
  test('does not choose darwin binary on linux fallback', () => {
    const selected = selectCompatibleNodeFile(
      ['xmdx.darwin-arm64.node', 'xmdx.darwin-x64.node'],
      'linux',
      'x64',
      'gnu',
    );
    expect(selected).toBeNull();
  });

  test('selects linux binary over darwin entries', () => {
    const selected = selectCompatibleNodeFile(
      ['xmdx.darwin-arm64.node', 'xmdx.linux-x64-gnu.node'],
      'linux',
      'x64',
      'gnu',
    );
    expect(selected).toBe('xmdx.linux-x64-gnu.node');
  });

  test('prefers musl when libc is musl', () => {
    const selected = selectCompatibleNodeFile(
      ['xmdx.linux-x64-gnu.node', 'xmdx.linux-x64-musl.node'],
      'linux',
      'x64',
      'musl',
    );
    expect(selected).toBe('xmdx.linux-x64-musl.node');
  });
});

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
