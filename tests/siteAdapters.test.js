import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Site-specific identity extraction, pinned against a debug report copied from
 * a live Axiom page. Unlike the generic heuristics, these are built from
 * observed markup and must keep matching it exactly.
 */
let importSeq = 0;

async function identityOn(hostname, title, lines = []) {
  globalThis.location = { hostname, href: `https://${hostname}/` };
  globalThis.document = {
    title,
    body: { innerText: lines.join('\n') },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  delete globalThis.ScanSiteAdapters;
  // Each import must re-execute the classic script; a repeated URL would be
  // served from the module cache and leave the global undefined.
  importSeq += 1;
  await import(`../src/content/adapters/siteAdapters.js?v=${importSeq}`);
  return globalThis.ScanSiteAdapters.identityFor(hostname);
}

// Verbatim from the report: "pageTitle" and "firstLines".
const REPORT_TITLE = 'CASHTAG ↑ $92.3K | Axiom SOL';
const REPORT_LINES = [
  'Discover', 'Pulse', 'Trackers', 'Perpetuals', 'Predictions', 'Vision', 'Portfolio',
  'Rewards', 'SOL', 'Deposit', '1.918', '0', '9', 'CASHTAG', 'Cashtag',
];

test('Axiom: ticker from the title, name from the header line after it', async () => {
  const id = await identityOn('axiom.trade', REPORT_TITLE, REPORT_LINES);
  assert.deepEqual(id, { symbol: 'CASHTAG', name: 'Cashtag', source: 'axiom title', site: 'axiom' });
});

test('Axiom: the earlier tokens from screenshots resolve the same way', async () => {
  const nuts = await identityOn('axiom.trade', 'Nuts ↑ $47.2K | Axiom SOL', ['SOL', 'Nuts', 'Nuts', '20m']);
  assert.equal(nuts.symbol, 'Nuts');
  assert.equal(nuts.name, 'Nuts');

  const cat = await identityOn('axiom.trade', 'VLOOONG ↓ $172K | Axiom SOL', ['VLOOONG', 'VERY Looong Cat', '3m']);
  assert.equal(cat.symbol, 'VLOOONG');
  assert.equal(cat.name, 'VERY Looong Cat', 'multi-word name kept whole');
});

test('Axiom: arrow direction and market-cap magnitude do not matter', async () => {
  for (const title of ['ABC ↓ $1.2M | Axiom SOL', 'ABC $950 | Axiom BNB', 'ABC → $12.5B | Axiom ETH']) {
    const id = await identityOn('axiom.trade', title);
    assert.equal(id && id.symbol, 'ABC', title);
  }
});

test('Axiom: the ticker is returned even when no name line is found', async () => {
  const id = await identityOn('axiom.trade', REPORT_TITLE, ['CASHTAG', '$92.3K']);
  assert.equal(id.symbol, 'CASHTAG');
  assert.equal(id.name, null, 'a price is not a name');
});

test('Axiom: a bare "Axiom" title (page still loading) yields nothing', async () => {
  assert.equal(await identityOn('axiom.trade', 'Axiom'), null);
  assert.equal(await identityOn('axiom.trade', 'Axiom | Trade'), null);
  assert.equal(await identityOn('axiom.trade', ''), null);
});

test('Axiom: a numeric "ticker" is rejected', async () => {
  assert.equal(await identityOn('axiom.trade', '92.3K ↑ $92.3K | Axiom SOL'), null);
});

test('no adapter for other hosts, even with an Axiom-shaped title', async () => {
  assert.equal(await identityOn('example.com', REPORT_TITLE, REPORT_LINES), null);
  assert.equal(await identityOn('dexscreener.com', REPORT_TITLE, REPORT_LINES), null);
});

test('nameAfterTicker takes the first exact line match, not a substring', async () => {
  await identityOn('axiom.trade', 'Axiom');
  const { nameAfterTicker } = globalThis.ScanSiteAdapters;
  assert.equal(nameAfterTicker('NUTS', ['Buy NUTS', 'Wrong', 'NUTS', 'Right']), 'Right');
  assert.equal(nameAfterTicker('NUTS', ['NUTS']), null);
  assert.equal(nameAfterTicker('NUTS', ['NUTS', '12.5%']), null);
});

/**
 * Verbatim from a debug report on Axiom's Pulse feed: the title carries no
 * ticker, but the selected token's buy button does.
 */
test('Axiom feed page: ticker from the "Buy <TICKER>" button, name from the header', async () => {
  const id = await identityOn('axiom.trade', 'Axiom SOL | Pulse', [
    'Discover', 'Pulse', 'Trackers', 'SOL', 'Deposit', '9', 'Pulse', 'Create a wallet group',
    'PUMPPHIL', 'Pump Jean Phil', '1.25%', '2m',
    'Buy', 'Sell', 'Market', 'Limit', 'Buy PUMPPHIL', 'Bought', 'Sold',
  ]);
  assert.deepEqual(id, { symbol: 'PUMPPHIL', name: 'Pump Jean Phil', source: 'axiom buy button', site: 'axiom' });
});

test('Axiom: the bare "Buy" tab and "Buy SOL" never count as a ticker', async () => {
  assert.equal(await identityOn('axiom.trade', 'Axiom SOL | Pulse', ['Buy', 'Sell', 'Buy SOL', 'Buy now']), null);
});

/**
 * Verbatim from a debug report: the title truncates the ticker to seven
 * characters ("CashFro") while the button has it whole ("Buy CashFrog"). The
 * button therefore wins whenever it is present.
 */
test('Axiom: the buy button beats the title, which truncates tickers', async () => {
  const id = await identityOn('axiom.trade', 'CashFro $92.9K | Axiom SOL',
    ['Discover', 'Pulse', 'SOL', 'Deposit', '9', 'CashFrog', 'CashFrog', '1.2%', '2h', 'Buy CashFrog']);
  assert.deepEqual(id, { symbol: 'CashFrog', name: 'CashFrog', source: 'axiom buy button', site: 'axiom' });
});

test('Axiom: the title is still the fallback when no buy button is on the page', async () => {
  const id = await identityOn('axiom.trade', 'CASHTAG \u2191 $92.3K | Axiom SOL', ['CASHTAG', 'Cashtag']);
  assert.equal(id.source, 'axiom title');
  assert.equal(id.symbol, 'CASHTAG');
});
