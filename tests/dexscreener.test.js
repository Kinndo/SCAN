import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDexScreenerProvider, pairsFrom, bestPairFor, translateMarket, translateSocial, translateIdentity,
} from '../src/services/providers/dexscreenerProvider.js';
import { val } from '../src/core/model.js';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WSOL = 'So11111111111111111111111111111111111111112';
const PAIR = 'HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv';

/** A pair as the documentation describes it. Field names are what the live Test verifies. */
function fullPair(over = {}) {
  return {
    chainId: 'solana', dexId: 'raydium', url: 'https://dexscreener.com/solana/' + PAIR, pairAddress: PAIR,
    baseToken: { address: BONK, name: 'Bonk', symbol: 'BONK' },
    quoteToken: { address: WSOL, name: 'Wrapped SOL', symbol: 'SOL' },
    priceNative: '0.0000001', priceUsd: '0.00002105',
    txns: { m5: { buys: 12, sells: 8 }, h1: { buys: 120, sells: 80 }, h6: { buys: 500, sells: 400 }, h24: { buys: 2000, sells: 1800 } },
    volume: { m5: 3000, h1: 30000, h6: 120000, h24: 190000 },
    priceChange: { m5: 1.2, h1: 12, h6: 28, h24: 60 },
    liquidity: { usd: 84000, base: 1, quote: 2 },
    fdv: 430000, marketCap: 420000, pairCreatedAt: 1_700_000_000_000,
    info: { imageUrl: 'x', websites: [{ label: 'Website', url: 'https://bonk' }], socials: [{ type: 'twitter', url: 'x' }, { type: 'telegram', url: 'y' }] },
    boosts: { active: 2 },
    ...over,
  };
}

test('accepts every response envelope the API has used', () => {
  const p = fullPair();
  assert.equal(pairsFrom({ pairs: [p] }).length, 1);
  assert.equal(pairsFrom({ pair: p }).length, 1);
  assert.equal(pairsFrom([p, null]).length, 1);
  assert.equal(pairsFrom({ pairs: null }).length, 0);
  assert.equal(pairsFrom(null).length, 0);
});

test('picks the most liquid pair where the address is the BASE token', () => {
  const asQuote = fullPair({ baseToken: { address: 'Other', symbol: 'X' }, quoteToken: { address: BONK }, liquidity: { usd: 9_999_999 } });
  const thin = fullPair({ pairAddress: 'thin', liquidity: { usd: 1000 } });
  const deep = fullPair({ pairAddress: 'deep', liquidity: { usd: 84000 } });
  const best = bestPairFor([asQuote, thin, deep], BONK, 'solana');
  assert.equal(best.pairAddress, 'deep', 'quote-side matches must not count');
  assert.equal(bestPairFor([fullPair({ chainId: 'ethereum' })], BONK, 'solana'), null, 'wrong chain is not a match');
  assert.equal(bestPairFor([fullPair({ chainId: 'ethereum' })], BONK, 'unknown').chainId, 'ethereum', 'unknown chain accepts any');
  assert.equal(bestPairFor([], BONK), null);
});

test('EVM addresses match case-insensitively', () => {
  const evm = '0x6982508145454Ce325dDbE47a25d4ec3d2311933';
  const p = fullPair({ chainId: 'ethereum', baseToken: { address: evm.toLowerCase(), symbol: 'PEPE' } });
  assert.ok(bestPairFor([p], evm, 'ethereum'));
});

test('a full pair translates into sourced market fields', () => {
  const { market } = translateMarket(fullPair());
  assert.equal(val(market.priceUsd), 0.00002105);
  assert.equal(val(market.marketCapUsd), 420000);
  assert.equal(market.marketCapUsd.confidence, 'measured');
  assert.equal(val(market.liquidityUsd), 84000);
  assert.equal(val(market.volume.h24), 190000);
  assert.deepEqual(val(market.txns.h1), { buys: 120, sells: 80 });
  assert.equal(val(market.priceChange.h1), 12);
  assert.equal(val(market.createdAt), 1_700_000_000_000);
  assert.equal(market.priceUsd.source, 'dexscreener');
});

test('a sparse new listing yields nulls, never zeros', () => {
  // What a ten-minute-old pool commonly looks like: several fields absent.
  const { market } = translateMarket({
    chainId: 'solana', pairAddress: 'p', baseToken: { address: 'A' }, priceUsd: '0.000001',
    volume: { h24: 0 }, txns: { h24: { buys: 3 } },
  });
  assert.equal(val(market.priceUsd), 0.000001);
  assert.equal(market.marketCapUsd, null);
  assert.equal(market.liquidityUsd, null);
  assert.equal(market.createdAt, null);
  assert.equal(market.volume.h1, null);
  assert.equal(val(market.volume.h24), 0, 'an explicit zero is a real measurement');
  assert.equal(market.txns.h24, null, 'half a txn object is not a measurement');
  assert.equal(market.priceChange.h1, null);
});

test('fdv stands in for a missing market cap, labelled as derived', () => {
  const { market } = translateMarket(fullPair({ marketCap: undefined, fdv: 99000 }));
  assert.equal(val(market.marketCapUsd), 99000);
  assert.equal(market.marketCapUsd.confidence, 'derived');
});

test('social links come from the info block; no info means unknown, not false', () => {
  const full = translateSocial(fullPair()).social;
  assert.equal(val(full.hasWebsite), true);
  assert.equal(val(full.hasTwitter), true);
  assert.equal(val(full.hasTelegram), true);
  assert.equal(val(full.linkCount), 3);
  assert.equal(val(full.boosted), true);

  const none = translateSocial(fullPair({ info: undefined, boosts: undefined }));
  assert.equal(none, null);

  const boostOnly = translateSocial(fullPair({ info: undefined, boosts: { active: 0 } })).social;
  assert.equal(boostOnly.hasWebsite, undefined);
  assert.equal(val(boostOnly.boosted), false);

  const xType = translateSocial(fullPair({ info: { socials: [{ type: 'X', url: 'u' }] } })).social;
  assert.equal(val(xType.hasTwitter), true);
});

test('identity takes the chain from the pair, so an unknown EVM chain is settled', () => {
  const { identity } = translateIdentity(fullPair({ chainId: 'base' }), { chain: 'unknown', address: BONK });
  assert.equal(identity.chain, 'base');
  assert.equal(identity.symbol, 'BONK');
  assert.equal(identity.name, 'Bonk');
  assert.equal(identity.pairAddress, PAIR);
  assert.equal(identity.identitySource, 'dexscreener');
});

// --- the provider itself, with a scripted fetch ---------------------------

function scripted(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    for (const [match, body] of routes) {
      if (url.includes(match)) {
        if (body instanceof Error) throw body;
        if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

test('three concurrent stages share one request', async () => {
  const { fetchImpl, calls } = scripted([[`/latest/dex/tokens/${BONK}`, { pairs: [fullPair()] }]]);
  const p = createDexScreenerProvider({ fetchImpl });
  const target = { chain: 'solana', address: BONK, addressKind: 'token' };
  const [id, market, social] = await Promise.all([p.fetch('identity', target), p.fetch('market', target), p.fetch('social', target)]);
  assert.equal(calls.length, 1, 'identity, market and social must not each hit the API');
  assert.equal(id.identity.symbol, 'BONK');
  assert.equal(val(market.market.liquidityUsd), 84000);
  assert.equal(val(social.social.hasTwitter), true);
});

test('a token DexScreener does not know is "no data", a 429 is an error', async () => {
  const quiet = createDexScreenerProvider({ fetchImpl: scripted([['/latest/dex/tokens/', { pairs: null }]]).fetchImpl });
  assert.equal(await quiet.fetch('market', { chain: 'solana', address: 'Unknown111111111111111111111111111111111111' }), null);

  const limited = createDexScreenerProvider({ fetchImpl: scripted([['/latest/dex/tokens/', 429]]).fetchImpl });
  await assert.rejects(limited.fetch('market', { chain: 'solana', address: BONK }), /429/);
});

test('failed lookups are not memoised', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; if (n === 1) return { ok: false, status: 500, json: async () => ({}) }; return { ok: true, status: 200, json: async () => ({ pairs: [fullPair()] }) }; };
  const p = createDexScreenerProvider({ fetchImpl });
  const target = { chain: 'solana', address: BONK };
  await assert.rejects(p.fetch('market', target));
  assert.ok(await p.fetch('market', target), 'the retry must go back to the network');
  assert.equal(n, 2);
});

test('resolve: a pool address from an Axiom URL becomes the token it trades', async () => {
  const { fetchImpl, calls } = scripted([
    [`/latest/dex/tokens/${PAIR}`, { pairs: [] }], // not a token
    [`/latest/dex/pairs/solana/${PAIR}`, { pairs: [fullPair()] }],
  ]);
  const p = createDexScreenerProvider({ fetchImpl });
  const r = await p.resolve({ chain: 'solana', address: PAIR, addressKind: 'unknown' });
  assert.deepEqual(r, { address: BONK, chain: 'solana', addressKind: 'token', pairAddress: PAIR, resolvedBy: 'dexscreener', resolvedFrom: PAIR });
  assert.equal(calls.length, 2, 'tried as a token first, then as a pair');
});

test('resolve: an unknown-kind address that IS a token resolves in one call', async () => {
  const { fetchImpl, calls } = scripted([[`/latest/dex/tokens/${BONK}`, { pairs: [fullPair()] }]]);
  const p = createDexScreenerProvider({ fetchImpl });
  const r = await p.resolve({ chain: 'solana', address: BONK, addressKind: 'unknown' });
  assert.equal(r.address, BONK);
  assert.equal(r.resolvedFrom, null);
  assert.equal(calls.length, 1);
});

test('resolve: a pasted 0x address with no chain gets its chain from the pair', async () => {
  const evm = '0x6982508145454ce325ddbe47a25d4ec3d2311933';
  const { fetchImpl } = scripted([[`/latest/dex/tokens/${evm}`, { pairs: [fullPair({ chainId: 'ethereum', baseToken: { address: evm, symbol: 'PEPE' } })] }]]);
  const p = createDexScreenerProvider({ fetchImpl });
  const r = await p.resolve({ chain: 'unknown', address: evm, addressKind: 'token' });
  assert.equal(r.chain, 'ethereum');
});

test('resolve: nothing matches -> null, and the scan proceeds unresolved', async () => {
  const p = createDexScreenerProvider({ fetchImpl: scripted([]).fetchImpl });
  assert.equal(await p.resolve({ chain: 'solana', address: PAIR, addressKind: 'pool' }), null);
});

test('the provider is off until enabled in Settings', () => {
  const p = createDexScreenerProvider({ fetchImpl: async () => ({}) });
  assert.equal(p.isConfigured({}), false);
  assert.equal(p.isConfigured({ dexscreener: { enabled: true } }), true);
});

test('self-test reports the live shape whether or not it matches expectations', async () => {
  const good = createDexScreenerProvider({ fetchImpl: scripted([['/latest/dex/tokens/', { pairs: [fullPair()] }]]).fetchImpl });
  const ok = await good.test();
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.topLevelKeys, ['pairs']);
  assert.ok(ok.pairKeys.includes('baseToken'));
  assert.equal(ok.translated.liquidityUsd, 84000);

  const odd = createDexScreenerProvider({ fetchImpl: scripted([['/latest/dex/tokens/', { data: [] }]]).fetchImpl });
  const shape = await odd.test();
  assert.equal(shape.ok, false);
  assert.deepEqual(shape.topLevelKeys, ['data'], 'the unexpected keys are what gets pasted back for a fix');
  assert.match(shape.note, /response shape may differ/);

  const down = createDexScreenerProvider({ fetchImpl: scripted([['/latest/dex/tokens/', 503]]).fetchImpl });
  assert.match((await down.test()).error, /HTTP 503/);
});

test('resolve: a declared pair is looked up as one first - a single call', async () => {
  const { fetchImpl, calls } = scripted([[`/latest/dex/pairs/solana/${PAIR}`, { pairs: [fullPair()] }]]);
  const p = createDexScreenerProvider({ fetchImpl });
  const r = await p.resolve({ chain: 'solana', address: PAIR, addressKind: 'pair' });
  assert.equal(r.address, BONK);
  assert.equal(r.resolvedFrom, PAIR);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/latest\/dex\/pairs\/solana\//);
});

test('resolve: a "pair" that is really a mint still resolves via the fallback', async () => {
  const { fetchImpl, calls } = scripted([
    [`/latest/dex/pairs/solana/${BONK}`, { pairs: null }],
    [`/latest/dex/tokens/${BONK}`, { pairs: [fullPair()] }],
  ]);
  const p = createDexScreenerProvider({ fetchImpl });
  const r = await p.resolve({ chain: 'solana', address: BONK, addressKind: 'pair' });
  assert.equal(r.address, BONK);
  assert.equal(r.resolvedFrom, null);
  assert.equal(calls.length, 2);
});
