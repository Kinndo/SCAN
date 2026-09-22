import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * boostNearTicker walks up from each candidate's element looking for the
 * page's ticker in a small surrounding container. Modelled on a feed page:
 * many rows, each linking to its own token, only one mentioning PUMPPHIL.
 */
let seq = 0;
async function adapter() {
  globalThis.location = { hostname: 'axiom.trade', href: 'https://axiom.trade/pulse' };
  globalThis.document = { title: '', body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
  delete globalThis.ScanContentBase;
  delete globalThis.ScanDomAdapter;
  seq += 1;
  await import(`../src/content/adapters/base.js?v=${seq}`);
  await import(`../src/content/adapters/domAdapter.js?v=${seq}`);
  return globalThis.ScanDomAdapter;
}

function node(textContent, parentElement = null) {
  return { textContent, parentElement };
}

const A = 'A1zXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB26';
const B = 'B1zXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB26';
const C = 'C1zXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB26';

test('only the candidate whose row mentions the ticker is boosted', async () => {
  const { boostNearTicker } = await adapter();
  const page = node('x'.repeat(5000)); // whole page: far too big to count as adjacent
  const rowA = node('DOGGO Doggo Coin $12K', page);
  const rowB = node('PUMPPHIL Pump Jean Phil $11.9K', page);
  const rowC = node('CATZ Catz $8K', page);
  const cands = [
    { address: A, origin: 'link', el: node('', rowA) },
    { address: B, origin: 'link', el: node('', rowB) },
    { address: C, origin: 'link', el: node('', rowC) },
  ];
  const boosted = boostNearTicker(cands, 'PUMPPHIL');
  assert.deepEqual(boosted.map((c) => c.address), [B]);
  assert.equal(boosted[0].origin, 'near-ticker');
});

test('a ticker match inside a huge container is not "adjacent"', async () => {
  const { boostNearTicker } = await adapter();
  const page = node('PUMPPHIL ' + 'x'.repeat(5000));
  const cands = [{ address: A, origin: 'link', el: node('', page) }];
  assert.deepEqual(boostNearTicker(cands, 'PUMPPHIL'), []);
});

test('partial ticker matches and candidates without elements are ignored', async () => {
  const { boostNearTicker } = await adapter();
  const row = node('PUMP Pump Token');
  const cands = [
    { address: A, origin: 'link', el: node('', row) },
    { address: B, origin: 'text', el: null },
  ];
  assert.deepEqual(boostNearTicker(cands, 'PUMPPHIL'), []);
  assert.deepEqual(boostNearTicker(cands, ''), []);
  assert.deepEqual(boostNearTicker(cands, null), []);
});

test('a ticker with regex metacharacters is matched literally', async () => {
  const { boostNearTicker } = await adapter();
  const row = node('C++ Coin (C++)');
  const cands = [{ address: A, origin: 'link', el: node('', row) }];
  assert.equal(boostNearTicker(cands, 'C++').length, 1);
});

test('stripElements drops element references before results leave the page', async () => {
  const { stripElements } = await adapter();
  const out = stripElements([{ address: A, origin: 'link', chain: null, el: node('x') }]);
  assert.deepEqual(out, [{ address: A, origin: 'link', chain: null }]);
});
