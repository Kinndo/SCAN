import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSidebarView, shouldRescan, isNavigationUpdate, debounce } from '../src/popup/sidebar.js';

const win = (search = '', hash = '') => ({ location: { search, hash } });

test('a window listed among the sidebar views is the sidebar', () => {
  const w = win();
  const ext = { extension: { getViews: ({ type }) => (type === 'sidebar' ? [w] : []) } };
  assert.equal(isSidebarView(ext, w), true);
  assert.equal(isSidebarView(ext, win()), false, 'a different window is not');
});

test('falls back to a URL marker when getViews is unavailable or throws', () => {
  assert.equal(isSidebarView({}, win('?mode=sidebar')), true);
  assert.equal(isSidebarView({}, win('', '#sidebar')), true);
  assert.equal(isSidebarView({}, win()), false);
  const throwing = { extension: { getViews: () => { throw new Error('no'); } } };
  assert.equal(isSidebarView(throwing, win('?mode=sidebar')), true);
  assert.equal(isSidebarView(throwing, win()), false);
});

test('rescans only for a new, valid detection with auto-scan on', () => {
  const on = { autoScanInSidebar: true };
  const off = { autoScanInSidebar: false };
  const det = { ok: true, address: 'A' };
  assert.equal(shouldRescan(null, det, on), true);
  assert.equal(shouldRescan('B', det, on), true);
  assert.equal(shouldRescan('A', det, on), false, 'same token: leave the result alone');
  assert.equal(shouldRescan(null, det, off), false, 'user turned auto-scan off');
  assert.equal(shouldRescan(null, { ok: false }, on), false);
  assert.equal(shouldRescan(null, null, on), false);
});

test('title churn from a live price ticker is not navigation', () => {
  assert.equal(isNavigationUpdate({ title: 'CASHTAG ↑ $92.4K | Axiom SOL' }), false);
  assert.equal(isNavigationUpdate({ favIconUrl: 'x' }), false);
  assert.equal(isNavigationUpdate({ url: 'https://axiom.trade/meme/abc' }), true);
  assert.equal(isNavigationUpdate({ status: 'complete' }), true);
  assert.equal(isNavigationUpdate({ status: 'loading' }), false);
  assert.equal(isNavigationUpdate(null), false);
});

test('debounce collapses a burst into one trailing call', () => {
  const pending = [];
  const timers = {
    set: (fn) => { pending.push(fn); return pending.length; },
    clear: (id) => { pending[id - 1] = null; },
  };
  const calls = [];
  const fn = debounce((x) => calls.push(x), 100, timers);
  fn(1); fn(2); fn(3);
  for (const f of pending) if (f) f();
  assert.deepEqual(calls, [3]);
});
