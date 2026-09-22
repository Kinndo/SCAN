import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The page-title heuristic is what puts the token you are actually looking at
 * into the header when no metadata provider is registered. It is guesswork, so
 * it is pinned against real title shapes taken from live trading sites.
 */
async function hintsFor(title, ogTitle = null) {
  globalThis.document = {
    title,
    querySelector: (sel) => (ogTitle && sel.includes('og:title') ? { getAttribute: () => ogTitle } : null),
    querySelectorAll: () => [],
  };
  delete globalThis.ScanDomAdapter;
  const mod = `../src/content/adapters/domAdapter.js?v=${encodeURIComponent(title)}`;
  await import(mod);
  return globalThis.ScanDomAdapter.extractIdentityHints();
}

test('reads a mixed-case ticker out of a trading-pair title', async () => {
  const h = await hintsFor('Nuts/USD on Pump AMM · 1s · axiom.trade');
  assert.equal(h.symbolHint, 'Nuts');
  assert.equal(h.nameHint, 'Nuts', 'the pair tail must be stripped from the name');
});

test('reads a $-prefixed ticker', async () => {
  const h = await hintsFor('$BONK price and chart');
  assert.equal(h.symbolHint, 'BONK');
});

test('falls back to the leading title segment', async () => {
  const h = await hintsFor('Pep Doge | Axiom');
  assert.equal(h.nameHint, 'Pep Doge');
  assert.equal(h.symbolHint, null, 'no ticker present, so none is claimed');
});

test('uppercase pair titles still work', async () => {
  const h = await hintsFor('BONK/SOL - DEX Screener');
  assert.equal(h.symbolHint, 'BONK');
  assert.equal(h.nameHint, 'BONK');
});

test('og:title wins over document.title', async () => {
  const h = await hintsFor('Some Aggregator', '$WIF on Raydium');
  assert.equal(h.symbolHint, 'WIF');
});

test('an unhelpful title yields nulls rather than junk', async () => {
  const h = await hintsFor('');
  assert.equal(h.symbolHint, null);
  assert.equal(h.nameHint, null);
});

test('an overlong title is not used as a name', async () => {
  const h = await hintsFor('x'.repeat(80));
  assert.equal(h.nameHint, null);
});
