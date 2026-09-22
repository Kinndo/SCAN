import { test } from 'node:test';
import assert from 'node:assert/strict';
import { field, val, pick, emptySnapshot, mergeSnapshot, markStageComplete, recordError, dataCompleteness } from '../src/core/model.js';

test('field() rejects unusable values instead of wrapping them', () => {
  assert.equal(field(null, 's'), null);
  assert.equal(field(undefined, 's'), null);
  assert.equal(field(NaN, 's'), null);
  assert.equal(field(Infinity, 's'), null);
  // Zero and false are legitimate measurements.
  assert.equal(val(field(0, 's')), 0);
  assert.equal(val(field(false, 's')), false);
});

test('pick walks nested paths and returns null for gaps', () => {
  const s = emptySnapshot({ chain: 'solana', address: 'A' });
  s.market.volume.h24 = field(1000, 's');
  assert.equal(pick(s, 'market.volume.h24'), 1000);
  assert.equal(pick(s, 'market.volume.h6'), null);
  assert.equal(pick(s, 'nope.nothing.here'), null);
});

test('merging a later stage never overwrites known data with unknown', () => {
  let s = emptySnapshot({ chain: 'solana', address: 'A' });
  s = mergeSnapshot(s, { market: { priceUsd: field(1.5, 'p1') } });
  s = mergeSnapshot(s, { market: { priceUsd: null, liquidityUsd: field(1000, 'p2') } });
  assert.equal(pick(s, 'market.priceUsd'), 1.5, 'null must not clobber a real value');
  assert.equal(pick(s, 'market.liquidityUsd'), 1000);
});

test('merging returns a new object and leaves the original untouched', () => {
  const s = emptySnapshot({ chain: 'solana', address: 'A' });
  const next = mergeSnapshot(s, { market: { priceUsd: field(2, 'p') } });
  assert.notEqual(s, next);
  assert.equal(pick(s, 'market.priceUsd'), null);
  assert.equal(pick(next, 'market.priceUsd'), 2);
});

test('stage bookkeeping tracks completion, sources and errors', () => {
  const s = emptySnapshot({ chain: 'solana', address: 'A' });
  assert.equal(s.meta.partial, true);
  markStageComplete(s, 'market', 'mock');
  assert.deepEqual(s.meta.stagesComplete, ['market']);
  assert.ok(!s.meta.stagesPending.includes('market'));
  assert.deepEqual(s.meta.sources, ['mock']);
  recordError(s, 'holders', 'boom');
  assert.deepEqual(s.meta.errors, [{ stage: 'holders', message: 'boom' }]);
  assert.ok(!s.meta.stagesPending.includes('holders'));
});

test('data completeness counts populated groups', () => {
  const s = emptySnapshot({ chain: 'solana', address: 'A' });
  assert.equal(dataCompleteness(s), 0);
  s.market.priceUsd = field(1, 's');
  assert.equal(dataCompleteness(s), 0.2);
  s.holders.count = field(10, 's');
  s.contract.mintAuthorityActive = field(false, 's');
  assert.equal(dataCompleteness(s), 0.6);
});
