import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The page-title heuristic is what puts the token you are actually looking at
 * into the header when no metadata provider is registered. It is guesswork, so
 * it is pinned against real title shapes taken from live trading sites.
 */
async function hintsFor(title, ogTitle = null, { bodyText = '', hostname = 'example.com' } = {}) {
  globalThis.location = { hostname, href: `https://${hostname}/` };
  globalThis.document = {
    title,
    body: { innerText: bodyText },
    querySelector: (sel) => (ogTitle && sel.includes('og:title') ? { getAttribute: () => ogTitle } : null),
    querySelectorAll: () => [],
  };
  delete globalThis.ScanDomAdapter;
  const mod = `../src/content/adapters/domAdapter.js?v=${encodeURIComponent(title + bodyText + hostname)}`;
  await import(mod);
  return globalThis.ScanDomAdapter.extractIdentityHints();
}

test('reads a mixed-case ticker out of a trading-pair title', async () => {
  const h = await hintsFor('Nuts/USD on Pump AMM \u00b7 1s \u00b7 axiom.trade', null, { hostname: 'axiom.trade' });
  assert.equal(h.symbolHint, 'Nuts');
});

/**
 * The regression: on axiom.trade the document title is just the site's name,
 * and the previous "leading title segment" fallback reported the token as
 * being called "Axiom".
 */
test('the site\'s own branding is never reported as the token', async () => {
  for (const [title, hostname] of [
    ['Axiom', 'axiom.trade'],
    ['Axiom | Trade', 'axiom.trade'],
    ['DEX Screener', 'dexscreener.com'],
    ['Photon', 'photon-sol.tinyastro.io'],
  ]) {
    const h = await hintsFor(title, null, { hostname });
    assert.equal(h.symbolHint, null, `${title} on ${hostname} must not yield a ticker`);
    assert.equal(h.nameHint, null);
  }
});

test('a ticker in the chart legend is found when the title has none', async () => {
  const h = await hintsFor('Axiom', null, {
    hostname: 'axiom.trade',
    bodyText: 'Discover Pulse Trackers\nNuts/USD on Pump AMM \u00b7 1s \u00b7 axiom.trade\nPrice $0.047',
  });
  assert.equal(h.symbolHint, 'Nuts');
  assert.equal(h.symbolSource, 'page text');
});

test('generic words are never treated as a ticker', async () => {
  for (const title of ['Price/USD', 'Chart/USD', 'Market/USD']) {
    const h = await hintsFor(title, null, { hostname: 'example.com' });
    assert.equal(h.symbolHint, null, `${title} must be rejected`);
  }
});

test('reads a $-prefixed ticker', async () => {
  const h = await hintsFor('$BONK price and chart');
  assert.equal(h.symbolHint, 'BONK');
});

test('a title with no ticker evidence yields nothing rather than a guess', async () => {
  const h = await hintsFor('Pep Doge | Axiom', null, { hostname: 'axiom.trade' });
  assert.equal(h.symbolHint, null);
  assert.equal(h.nameHint, null, 'names are never guessed from page text');
});

test('uppercase pair titles still work', async () => {
  const h = await hintsFor('BONK/SOL - DEX Screener', null, { hostname: 'dexscreener.com' });
  assert.equal(h.symbolHint, 'BONK');
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
  assert.equal(h.symbolHint, null);
});
