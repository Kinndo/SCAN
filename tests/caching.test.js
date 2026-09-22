import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache, cacheKey, TTL } from '../src/utils/caching.js';

function fakeStore() {
  const map = new Map();
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async set(k, v) { map.set(k, v); },
    async remove(k) { map.delete(k); },
  };
}

test('cache keys are namespaced per chain and address', () => {
  assert.equal(cacheKey('market', 'solana', 'ABC'), 'market:solana:ABC');
  assert.equal(cacheKey('market', null, 'ABC'), 'market:unknown:ABC');
});

test('values expire on the injected clock', async () => {
  let now = 1000;
  const cache = new TtlCache(null, () => now);
  await cache.set('k', { a: 1 }, 500);
  assert.deepEqual(await cache.get('k'), { a: 1 });
  now = 1600;
  assert.equal(await cache.get('k'), null);
});

test('the persistent tier repopulates memory and expired entries are evicted', async () => {
  let now = 1000;
  const store = fakeStore();
  const cache = new TtlCache(store, () => now);
  await cache.set('k', 'v', 500);
  cache.clearMemory();
  assert.equal(await cache.get('k'), 'v', 'should come back from the store');
  now = 2000;
  assert.equal(await cache.get('k'), null);
  assert.equal(store.map.has('k'), false, 'expired entry should be removed');
});

test('wrap only calls the producer on a miss', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const produce = async () => { calls += 1; return 'value'; };
  const first = await cache.wrap('k', 1000, produce);
  const second = await cache.wrap('k', 1000, produce);
  assert.deepEqual([first.cached, second.cached], [false, true]);
  assert.equal(calls, 1);
});

test('a broken persistent store never breaks a read', async () => {
  const broken = { get: async () => { throw new Error('nope'); }, set: async () => { throw new Error('nope'); }, remove: async () => {} };
  const cache = new TtlCache(broken);
  await cache.set('k', 'v', 1000);
  assert.equal(await cache.get('k'), 'v', 'memory tier still answers');
});

test('market data has a much shorter TTL than contract metadata', () => {
  assert.ok(TTL.market < TTL.holders);
  assert.ok(TTL.holders < TTL.contract);
  assert.ok(TTL.contract < TTL.identity);
});
