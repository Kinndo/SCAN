import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRugCheckProvider, translateHolders, translateContract, translateDev, isPoolHolder } from '../src/services/providers/rugcheckProvider.js';
import { val } from '../src/core/model.js';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

/** A report as the public format is remembered. Field names are what the live Test verifies. */
function fullReport(over = {}) {
  return {
    mint: BONK, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    creator: 'CreatorWallet11111111111111111111111111111', creatorBalance: 5_000_000,
    token: { mintAuthority: null, freezeAuthority: null, supply: 100_000_000, decimals: 5, isInitialized: true },
    topHolders: [
      { address: 'lpAcct', owner: 'RaydiumPool', pct: 30, amount: 30_000_000, insider: false },
      { address: 'w1', owner: 'Whale1', pct: 12, amount: 12_000_000, insider: false },
      { address: 'w2', owner: 'Whale2', pct: 6, amount: 6_000_000, insider: true },
      { address: 'w3', owner: 'Whale3', pct: 3, amount: 3_000_000, insider: false },
    ],
    knownAccounts: { RaydiumPool: { name: 'Raydium (LP)', type: 'AMM' } },
    markets: [{ pubkey: 'm1', marketType: 'raydium_v4', lp: { lpLockedPct: 97.5, lpLockedUSD: 80000, lpTotalSupply: 1000 } }],
    totalHolders: 4321, totalMarketLiquidity: 84000, rugged: false, score: 120, score_normalised: 12,
    transferFee: { pct: 0, maxAmount: 0, authority: null },
    ...over,
  };
}

test('pool vaults are recognised from knownAccounts', () => {
  const known = { RaydiumPool: { name: 'Raydium (LP)', type: 'AMM' }, Someone: { name: 'Exchange', type: 'CEX' } };
  assert.equal(isPoolHolder({ owner: 'RaydiumPool' }, known), true);
  assert.equal(isPoolHolder({ owner: 'Someone' }, known), false);
  assert.equal(isPoolHolder({ owner: 'Unknown' }, known), false);
  assert.equal(isPoolHolder({ owner: 'x' }, null), false);
});

test('holder concentration is measured over wallets with the pool set aside', () => {
  const { holders } = translateHolders(fullReport());
  assert.equal(val(holders.count), 4321);
  assert.equal(val(holders.largestPct), 30, 'the pool is still the largest account');
  assert.equal(val(holders.largestNonLpPct), 12, 'but the whale figure excludes it');
  assert.equal(val(holders.top10Pct), 21, '12 + 6 + 3');
  assert.equal(val(holders.lpHeldPct), 30);
});

test('holders: a report with no holder data yields null, not zeros', () => {
  assert.equal(translateHolders({}), null);
  const { holders } = translateHolders({ totalHolders: 10 });
  assert.equal(val(holders.count), 10);
  assert.equal(holders.top10Pct, null);
  assert.equal(holders.largestNonLpPct, null);
});

test('contract: null authority means revoked, a string means active, absent means unknown', () => {
  const revoked = translateContract(fullReport()).contract;
  assert.equal(val(revoked.mintAuthorityActive), false);
  assert.equal(val(revoked.freezeAuthorityActive), false);
  assert.equal(val(revoked.lpBurnedOrLockedPct), 97.5);
  assert.equal(val(revoked.buyTaxPct), 0);
  assert.equal(revoked.honeypot, null, 'Solana has no honeypot check; not claimed safe');

  const live = translateContract(fullReport({ token: { mintAuthority: 'SomeKey', freezeAuthority: 'OtherKey' } })).contract;
  assert.equal(val(live.mintAuthorityActive), true);
  assert.equal(val(live.freezeAuthorityActive), true);

  // Nothing about the contract in the report at all: that is an empty stage,
  // not a stage full of nulls.
  assert.equal(translateContract(fullReport({ token: {}, mintAuthority: undefined, markets: [], transferFee: undefined })), null);

  // Partial: authorities present, no markets, no fee -> those two are unknown.
  const partial = translateContract(fullReport({ markets: [], transferFee: undefined })).contract;
  assert.equal(val(partial.mintAuthorityActive), false);
  assert.equal(partial.lpBurnedOrLockedPct, null);
  assert.equal(partial.buyTaxPct, null);
});

test('contract: top-level authority fields are honoured when the token block lacks them', () => {
  const c = translateContract({ mintAuthority: 'Key', freezeAuthority: null }).contract;
  assert.equal(val(c.mintAuthorityActive), true);
  assert.equal(val(c.freezeAuthorityActive), false);
});

test('contract: the deepest market decides the LP lock figure', () => {
  const c = translateContract(fullReport({ markets: [
    { lp: { lpLockedPct: 10, lpLockedUSD: 100 } },
    { lp: { lpLockedPct: 99, lpLockedUSD: 90000 } },
  ] })).contract;
  assert.equal(val(c.lpBurnedOrLockedPct), 99);
});

test('dev: creator holding is derived from balance over supply, unit mismatches rejected', () => {
  const d = translateDev(fullReport()).dev;
  assert.equal(val(d.deployerAddress), 'CreatorWallet11111111111111111111111111111');
  assert.equal(val(d.deployerHoldingPct), 5);
  assert.equal(d.deployerSoldPct, null, 'selling history is not in the report');

  const bad = translateDev(fullReport({ creatorBalance: 5e12 })).dev;
  assert.equal(bad.deployerHoldingPct, null, 'over 100% means the units did not match');
  assert.equal(translateDev({}), null);
});

function scripted(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: status === 200, status, json: async () => body }; };
  return { fetchImpl, calls };
}

test('three stages share one report request; only Solana mints are attempted', async () => {
  const { fetchImpl, calls } = scripted(fullReport());
  const p = createRugCheckProvider({ fetchImpl });
  const target = { chain: 'solana', address: BONK, addressKind: 'token' };
  const [h, c, d] = await Promise.all([p.fetch('holders', target), p.fetch('contract', target), p.fetch('dev', target)]);
  assert.equal(calls.length, 1);
  assert.equal(val(h.holders.top10Pct), 21);
  assert.equal(val(c.contract.mintAuthorityActive), false);
  assert.equal(val(d.dev.deployerHoldingPct), 5);
  assert.equal(await p.fetch('holders', { chain: 'ethereum', address: '0x6982508145454ce325ddbe47a25d4ec3d2311933' }), null);
  assert.equal(calls.length, 1, 'an EVM address never reaches the API');
});

test('the provider is Solana-only and off until enabled', () => {
  const p = createRugCheckProvider({ fetchImpl: async () => ({}) });
  assert.deepEqual(p.chains, ['solana']);
  assert.equal(p.isConfigured({}), false);
  assert.equal(p.isConfigured({ rugcheck: { enabled: true } }), true);
});

test('self-test reports the live shape', async () => {
  const good = createRugCheckProvider({ fetchImpl: scripted(fullReport()).fetchImpl });
  const ok = await good.test();
  assert.equal(ok.ok, true);
  assert.ok(ok.topLevelKeys.includes('topHolders'));
  assert.deepEqual(ok.lpKeys, ['lpLockedPct', 'lpLockedUSD', 'lpTotalSupply']);
  assert.equal(ok.translated.top10Pct, 21);
  assert.equal(ok.knownAccountsSample[0].address, 'RaydiumPool');

  const odd = createRugCheckProvider({ fetchImpl: scripted({ data: {} }).fetchImpl });
  const shape = await odd.test();
  assert.equal(shape.ok, false);
  assert.deepEqual(shape.topLevelKeys, ['data']);

  const down = createRugCheckProvider({ fetchImpl: scripted({}, 502).fetchImpl });
  assert.match((await down.test()).error, /HTTP 502/);
});
