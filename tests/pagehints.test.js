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

test('reads a token name out of a chart legend', async () => {
  const h = await hintsFor('Axiom', null, {
    hostname: 'axiom.trade',
    bodyText: 'Discover Pulse Trackers\nNuts/USD on Pump AMM \u00b7 1s \u00b7 axiom.trade\nPrice $0.047',
  });
  assert.equal(h.nameHint, 'Nuts');
  assert.equal(h.symbolSource, 'chart legend');
});

test('a multi-word name is kept whole', async () => {
  const h = await hintsFor('Axiom', null, {
    hostname: 'axiom.trade',
    bodyText: '$172K\nVERY Looong Cat/USD on Pump AMM \u00b7 1s \u00b7 axiom.trade\nO173K H173K',
  });
  assert.equal(h.nameHint, 'VERY Looong Cat', 'must not truncate to the last word');
});

/**
 * Both regressions seen on a live Axiom page. A bare "X/QUOTE" scan matched the
 * "USD/SOL" display toggle and a market-cap figure beside a slash, so the popup
 * reported a token called "139K". The legend pattern is anchored to the start
 * of a line and requires the " on <venue>" tail for exactly this reason.
 */
test('display toggles and price figures are never read as a name', async () => {
  const junk = [
    'USD/SOL  MarketCap/Price',
    '139K/USD',
    'Market Cap $245.8K\n139K/USD\nSupply 985M',
    'MarketCap/Price',
    'Liquidity/USD on hand',
  ];
  for (const bodyText of junk) {
    const h = await hintsFor('Axiom', null, { hostname: 'axiom.trade', bodyText });
    assert.equal(h.nameHint, null, `${JSON.stringify(bodyText)} must not yield a name`);
  }
});

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

test('reads a $-prefixed ticker from the title', async () => {
  const h = await hintsFor('$BONK price and chart', null, { hostname: 'example.com' });
  assert.equal(h.symbolHint, 'BONK');
});

test('a legend in the document title is used too', async () => {
  const h = await hintsFor('Nuts/USD on Pump AMM \u00b7 axiom.trade', null, { hostname: 'axiom.trade' });
  assert.equal(h.nameHint, 'Nuts');
});

test('a title with no ticker evidence yields nothing rather than a guess', async () => {
  const h = await hintsFor('Pep Doge | Axiom', null, { hostname: 'axiom.trade' });
  assert.equal(h.symbolHint, null);
  assert.equal(h.nameHint, null, 'names are never guessed from branding');
});

test('og:title wins over document.title', async () => {
  const h = await hintsFor('Some Aggregator', '$WIF on Raydium', { hostname: 'example.com' });
  assert.equal(h.symbolHint, 'WIF');
});

test('an unhelpful page yields nulls rather than junk', async () => {
  const h = await hintsFor('', null, { hostname: 'example.com' });
  assert.equal(h.symbolHint, null);
  assert.equal(h.nameHint, null);
});

test('an overlong candidate is rejected', async () => {
  const h = await hintsFor('x'.repeat(80), null, { hostname: 'example.com' });
  assert.equal(h.nameHint, null);
  assert.equal(h.symbolHint, null);
});
