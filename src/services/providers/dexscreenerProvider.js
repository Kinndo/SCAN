/**
 * DexScreener - market data, identity and social links, every chain, no key.
 *
 * One response serves three stages (identity, market, social) and it can turn
 * a pair/pool address into the token it trades - which is what every Axiom
 * scan needs, since Axiom's URLs carry the pool.
 *
 * UNVERIFIED: the endpoint paths and field names below come from DexScreener's
 * public API documentation as remembered, not from a live response captured
 * during this build (the build environment had no network). Settings > Data
 * providers > Test fetches a known token and shows the real status and keys;
 * that is how a wrong field name gets found and fixed.
 *
 * Documented limit: 300 requests/minute. Every stage of one scan shares a
 * single request via an in-flight memo, so a scan costs one or two calls.
 */

import { field } from '../../core/model.js';
import { CONFIDENCE } from '../../core/constants.js';
import { normalizeChainSlug } from '../../core/detect.js';
import { fetchJson } from '../http.js';

export const DEXSCREENER_BASE = 'https://api.dexscreener.com';
export const DEXSCREENER_ORIGIN = 'https://api.dexscreener.com/*';
const SOURCE = 'dexscreener';
const MEMO_TTL_MS = 15000;

/** A known, liquid token for the Settings "Test" button. */
export const TEST_TARGET = { chain: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', addressKind: 'token' };

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** The API has answered with {pairs:[...]}, {pair:{...}} and a bare array. */
export function pairsFrom(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json.filter(Boolean);
  if (Array.isArray(json.pairs)) return json.pairs.filter(Boolean);
  if (json.pair && typeof json.pair === 'object') return [json.pair];
  return [];
}

/** The most liquid pair where `address` is the BASE token (not the quote). */
export function bestPairFor(pairs, address, chain = null) {
  const mine = pairs
    .filter((p) => p && p.baseToken && sameAddress(p.baseToken.address, address))
    .filter((p) => !chain || chain === 'unknown' || normalizeChainSlug(p.chainId) === chain);
  if (!mine.length) return null;
  const liq = (p) => num(p.liquidity && p.liquidity.usd) ?? -1;
  const vol = (p) => num(p.volume && p.volume.h24) ?? -1;
  return [...mine].sort((a, b) => liq(b) - liq(a) || vol(b) - vol(a))[0];
}

// --- translators: pair -> snapshot patch. Absent field -> null, never 0. ---

export function translateIdentity(pair, target) {
  const base = pair.baseToken || {};
  return {
    identity: {
      chain: normalizeChainSlug(pair.chainId) ?? target.chain,
      address: base.address ?? target.address,
      symbol: typeof base.symbol === 'string' && base.symbol ? base.symbol : null,
      name: typeof base.name === 'string' && base.name ? base.name : null,
      pairAddress: pair.pairAddress ?? null,
      dexId: pair.dexId ?? null,
      identitySource: SOURCE,
    },
  };
}

export function translateMarket(pair) {
  const F = (v) => field(num(v), SOURCE, CONFIDENCE.MEASURED);
  const win = (obj, key) => (obj && obj[key] !== undefined ? obj[key] : null);
  const txn = (t) => {
    if (!t || t.buys === undefined || t.sells === undefined) return null;
    const buys = num(t.buys);
    const sells = num(t.sells);
    return buys === null || sells === null ? null : field({ buys, sells }, SOURCE, CONFIDENCE.MEASURED);
  };
  const mcap = num(pair.marketCap);
  const fdv = num(pair.fdv);
  return {
    market: {
      priceUsd: F(pair.priceUsd),
      // A brand-new listing often has fdv but no marketCap. Using fdv in its
      // place is a reasonable stand-in for a memecoin, but it is labelled
      // DERIVED so the provenance is visible rather than silently equated.
      marketCapUsd: mcap !== null ? F(mcap) : fdv !== null ? field(fdv, SOURCE, CONFIDENCE.DERIVED) : null,
      fdvUsd: F(fdv),
      liquidityUsd: F(pair.liquidity && pair.liquidity.usd),
      createdAt: F(pair.pairCreatedAt),
      volume: { m5: F(win(pair.volume, 'm5')), h1: F(win(pair.volume, 'h1')), h6: F(win(pair.volume, 'h6')), h24: F(win(pair.volume, 'h24')) },
      priceChange: { m5: F(win(pair.priceChange, 'm5')), h1: F(win(pair.priceChange, 'h1')), h6: F(win(pair.priceChange, 'h6')), h24: F(win(pair.priceChange, 'h24')) },
      txns: { m5: txn(win(pair.txns, 'm5')), h1: txn(win(pair.txns, 'h1')), h6: txn(win(pair.txns, 'h6')), h24: txn(win(pair.txns, 'h24')) },
    },
  };
}

export function translateSocial(pair) {
  const boosted = pair.boosts && pair.boosts.active !== undefined
    ? field((num(pair.boosts.active) ?? 0) > 0, SOURCE, CONFIDENCE.MEASURED)
    : null;
  const info = pair.info;
  // No `info` block means DexScreener lists no links. That is not proof the
  // token has none, so the link flags stay unknown rather than false.
  if (!info || typeof info !== 'object') return boosted ? { social: { boosted } } : null;
  const socials = Array.isArray(info.socials) ? info.socials.filter(Boolean) : [];
  const websites = Array.isArray(info.websites) ? info.websites.filter(Boolean) : [];
  const has = (...types) => socials.some((s) => typeof s.type === 'string' && types.includes(s.type.toLowerCase()));
  return {
    social: {
      hasWebsite: field(websites.length > 0, SOURCE, CONFIDENCE.MEASURED),
      hasTwitter: field(has('twitter', 'x'), SOURCE, CONFIDENCE.MEASURED),
      hasTelegram: field(has('telegram'), SOURCE, CONFIDENCE.MEASURED),
      linkCount: field(websites.length + socials.length, SOURCE, CONFIDENCE.MEASURED),
      boosted,
    },
  };
}

function resolutionFrom(pair, target, viaPairLookup) {
  return {
    address: pair.baseToken.address,
    chain: normalizeChainSlug(pair.chainId) ?? target.chain,
    addressKind: 'token',
    pairAddress: pair.pairAddress ?? (viaPairLookup ? target.address : null),
    resolvedBy: SOURCE,
    resolvedFrom: viaPairLookup ? target.address : null,
  };
}

export function createDexScreenerProvider({ fetchImpl, now = () => Date.now() } = {}) {
  const memo = new Map(); // "chain:address" -> { promise, at }
  const http = (url, ctx) => fetchJson(url, { timeoutMs: 6000, signal: ctx && ctx.signal, fetchImpl });

  /** One tokens-endpoint call per token per 15s, shared by concurrent stages. */
  function pairFor(target, ctx) {
    const key = `${target.chain}:${target.address}`;
    const hit = memo.get(key);
    const at = now();
    if (hit && at - hit.at < MEMO_TTL_MS) return hit.promise;
    const promise = http(`${DEXSCREENER_BASE}/latest/dex/tokens/${encodeURIComponent(target.address)}`, ctx)
      .then((json) => bestPairFor(pairsFrom(json), target.address, target.chain));
    memo.set(key, { promise, at });
    promise.catch(() => memo.delete(key)); // do not cache failures
    return promise;
  }

  async function lookupPair(chain, pairAddress, ctx) {
    const json = await http(`${DEXSCREENER_BASE}/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pairAddress)}`, ctx);
    const pairs = pairsFrom(json);
    return pairs.find((p) => sameAddress(p.pairAddress, pairAddress)) ?? pairs[0] ?? null;
  }

  return {
    id: 'dexscreener',
    label: 'DexScreener',
    priority: 50,
    chains: '*',
    stages: ['identity', 'market', 'social'],
    requiresKey: false,
    origins: [DEXSCREENER_ORIGIN],
    isConfigured: (config = {}) => Boolean(config.dexscreener && config.dexscreener.enabled),

    /**
     * Turn whatever the page gave us into a token address on a known chain.
     * Called by the orchestrator before any stage runs when the address kind
     * is pair/pool/unknown or the chain is unknown.
     */
    async resolve(target, ctx = {}) {
      const kind = target.addressKind || 'token';
      const chain = target.chain || 'unknown';

      // 1. Treat it as a token. The tokens endpoint is chain-agnostic, which
      //    also settles an unknown EVM chain.
      if (kind === 'token' || kind === 'unknown') {
        const pair = await pairFor(target, ctx).catch(() => null);
        if (pair) return resolutionFrom(pair, target, false);
        if (kind === 'token') return null;
      }

      // 2. Treat it as a pair/pool on the chain we know.
      if (chain !== 'unknown') {
        const pair = await lookupPair(chain, target.address, ctx).catch(() => null);
        if (pair && pair.baseToken && pair.baseToken.address) return resolutionFrom(pair, target, true);
      }
      return null;
    },

    async fetch(stage, target, ctx = {}) {
      const pair = await pairFor(target, ctx);
      if (!pair) return null; // unknown to DexScreener: "no data", not an error
      switch (stage) {
        case 'identity': return translateIdentity(pair, target);
        case 'market': return translateMarket(pair);
        case 'social': return translateSocial(pair);
        default: return null;
      }
    },

    /** Diagnostic for Settings: what the live API actually returns. */
    async test(ctx = {}) {
      const url = `${DEXSCREENER_BASE}/latest/dex/tokens/${TEST_TARGET.address}`;
      const started = now();
      try {
        const json = await http(url, ctx);
        const pairs = pairsFrom(json);
        const best = bestPairFor(pairs, TEST_TARGET.address, TEST_TARGET.chain);
        const market = best ? translateMarket(best).market : null;
        const v = (m) => (m ? m.value : null);
        return {
          ok: Boolean(best),
          ms: now() - started,
          url,
          topLevelKeys: json && typeof json === 'object' ? Object.keys(json) : [typeof json],
          pairCount: pairs.length,
          pairKeys: best ? Object.keys(best) : [],
          sample: best ? {
            chainId: best.chainId, dexId: best.dexId, symbol: best.baseToken && best.baseToken.symbol,
            priceUsd: best.priceUsd, marketCap: best.marketCap, fdv: best.fdv,
            liquidityUsd: best.liquidity && best.liquidity.usd, volumeH24: best.volume && best.volume.h24,
            txnsH1: best.txns && best.txns.h1, pairCreatedAt: best.pairCreatedAt, hasInfo: Boolean(best.info),
          } : null,
          translated: market ? {
            priceUsd: v(market.priceUsd), marketCapUsd: v(market.marketCapUsd), liquidityUsd: v(market.liquidityUsd),
            volumeH24: v(market.volume.h24), txnsH1: v(market.txns.h1), createdAt: v(market.createdAt),
          } : null,
          note: best ? null : 'Request succeeded but no pair had the test token as base - the response shape may differ from what the translator expects.',
        };
      } catch (err) {
        return { ok: false, ms: now() - started, url, error: String((err && err.message) || err), status: err && err.status ? err.status : null };
      }
    },
  };
}
