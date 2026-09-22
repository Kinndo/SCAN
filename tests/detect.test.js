import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFromUrl, rankCandidates, isSupportedSite, normalizeChainSlug } from '../src/core/detect.js';

const SOL = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM = '0x6982508145454Ce325dDbE47a25d4ec3d2311933';

test('chain slugs normalise across site vocabularies', () => {
  assert.equal(normalizeChainSlug('eth'), 'ethereum');
  assert.equal(normalizeChainSlug('BNB'), 'bsc');
  assert.equal(normalizeChainSlug('nonsense'), null);
});

test('site URL adapters extract chain, address and address kind', () => {
  const cases = [
    [`https://dexscreener.com/solana/${SOL}`, { chain: 'solana', address: SOL, addressKind: 'pair', site: 'dexscreener' }],
    [`https://www.geckoterminal.com/base/pools/${EVM}`, { chain: 'base', address: EVM.toLowerCase(), addressKind: 'pool', site: 'geckoterminal' }],
    [`https://birdeye.so/token/${SOL}?chain=solana`, { chain: 'solana', address: SOL, addressKind: 'token', site: 'birdeye' }],
    [`https://pump.fun/coin/${SOL}`, { chain: 'solana', address: SOL, addressKind: 'token', site: 'pumpfun' }],
    [`https://gmgn.ai/sol/token/${SOL}`, { chain: 'solana', address: SOL, addressKind: 'token', site: 'gmgn' }],
    [`https://www.dextools.io/app/en/ether/pair-explorer/${EVM}`, { chain: 'ethereum', address: EVM.toLowerCase(), addressKind: 'pair', site: 'dextools' }],
    [`https://photon-sol.tinyastro.io/en/lp/${SOL}`, { chain: 'solana', address: SOL, addressKind: 'pool', site: 'photon' }],
    [`https://axiom.trade/meme/${SOL}`, { chain: 'solana', address: SOL, addressKind: 'pair', site: 'axiom' }],
    [`https://solscan.io/token/${SOL}`, { chain: 'solana', address: SOL, addressKind: 'token', site: 'solscan' }],
    [`https://etherscan.io/token/${EVM}`, { chain: 'ethereum', address: EVM.toLowerCase(), addressKind: 'token', site: 'evm-explorer' }],
    [`https://basescan.org/token/${EVM}`, { chain: 'base', address: EVM.toLowerCase(), addressKind: 'token', site: 'evm-explorer' }],
    [`https://jup.ag/swap/SOL-${SOL}`, { chain: 'solana', address: SOL, addressKind: 'token', site: 'jupiter' }],
  ];
  for (const [url, expected] of cases) {
    const got = detectFromUrl(url);
    assert.ok(got, `expected a match for ${url}`);
    assert.equal(got.chain, expected.chain, url);
    assert.equal(got.address, expected.address, url);
    assert.equal(got.addressKind, expected.addressKind, url);
    assert.equal(got.site, expected.site, url);
    assert.equal(got.method, 'url');
  }
});

test('a Solana route carrying an EVM address is rejected rather than guessed', () => {
  assert.equal(detectFromUrl(`https://dexscreener.com/solana/${EVM}`), null);
  assert.equal(detectFromUrl(`https://dexscreener.com/ethereum/${SOL}`), null);
});

test('unsupported sites, bad protocols and wrapped assets return nothing', () => {
  assert.equal(detectFromUrl('https://example.com/token/whatever'), null);
  assert.equal(detectFromUrl('about:blank'), null);
  assert.equal(detectFromUrl('not a url'), null);
  assert.equal(detectFromUrl('https://solscan.io/token/So11111111111111111111111111111111111111112'), null);
});

test('isSupportedSite reports adapter coverage regardless of extraction', () => {
  assert.equal(isSupportedSite('https://dexscreener.com/'), true);
  assert.equal(isSupportedSite('https://example.com/'), false);
});

test('DOM candidates rank URL above body text and drop junk', () => {
  const ranked = rankCandidates([
    { address: SOL, origin: 'text' },
    { address: EVM, origin: 'url' },
    { address: 'So11111111111111111111111111111111111111112', origin: 'url' },
    { address: 'garbage', origin: 'canonical' },
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].address, EVM.toLowerCase());
  assert.equal(ranked[1].address, SOL);
});

test('an address seen in several places outranks one seen once', () => {
  const ranked = rankCandidates([
    { address: SOL, origin: 'text' },
    { address: SOL, origin: 'meta' },
    { address: SOL, origin: 'attribute' },
    { address: EVM, origin: 'meta' },
  ]);
  assert.equal(ranked[0].address, SOL);
  assert.deepEqual(ranked[0].origins.sort(), ['attribute', 'meta', 'text']);
});


/**
 * Pinned against real URLs copied from the browser. Axiom carries the chain in
 * the query string and is multi-chain. Its /meme/ route carries the POOL: a
 * live DexScreener lookup resolved /meme/FAKr6z... to mint 2k1g...pump with
 * pairAddress equal to the URL address.
 */
test('the real Axiom URL is parsed exactly, as a pair', () => {
  const url = 'https://axiom.trade/meme/FAKr6zhYTLAqpUowErobB1mvJr2xmtaANxYNLszGHhrg'
    + '?chain=sol&chains=sol&pulseChains=sol&trackerChains=sol,robinhood,bnb,eth&discoverChains=sol';
  const got = detectFromUrl(url);
  assert.deepEqual(got, {
    address: 'FAKr6zhYTLAqpUowErobB1mvJr2xmtaANxYNLszGHhrg',
    chain: 'solana',
    addressKind: 'pair',
    site: 'axiom',
    method: 'url',
  });
});

test('Axiom reads its chain from the query string rather than assuming Solana', () => {
  const evm = '0x6982508145454ce325ddbe47a25d4ec3d2311933';
  assert.equal(detectFromUrl(`https://axiom.trade/meme/${evm}?chain=eth`).chain, 'ethereum');
  assert.equal(detectFromUrl(`https://axiom.trade/meme/${evm}?chain=bnb`).chain, 'bsc');
  // Chain and address family must agree or the match is discarded.
  assert.equal(detectFromUrl(`https://axiom.trade/meme/${evm}?chain=sol`), null);
  assert.equal(detectFromUrl(`https://axiom.trade/meme/${SOL}?chain=eth`), null);
});

test('an address found next to the page\'s ticker outranks any number of feed rows', () => {
  const feed = ['A1zXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB26', 'B1zXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB26', 'C1zXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB26'];
  // Every feed row is a link plus a data attribute plus body text - a three-way tie.
  const tied = feed.flatMap((a) => [{ address: a, origin: 'link' }, { address: a, origin: 'attribute' }, { address: a, origin: 'text' }]);
  const before = rankCandidates(tied);
  assert.ok(before[1].score >= before[0].score, 'without a ticker match the feed is a tie');

  const after = rankCandidates([...tied, { address: feed[1], origin: 'near-ticker' }]);
  assert.equal(after[0].address, feed[1]);
  assert.ok(after[0].score > after[1].score, 'the ticker-adjacent address must win outright');
});
