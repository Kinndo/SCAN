/**
 * RugCheck - Solana holder distribution, mint/freeze authority, LP lock status
 * and creator holdings. No key for the public report endpoint.
 *
 * Needs the token MINT. Pool addresses are resolved to the mint by the
 * orchestrator before this provider runs.
 *
 * UNVERIFIED: the field names below come from RugCheck's public report format
 * as remembered, not from a live response captured in this build. Settings >
 * Data providers > Test fetches a known token and prints the real keys of the
 * report, the token block, the first holder, the first market's lp block and
 * a knownAccounts sample - enough to correct any name in one round.
 */

import { field } from '../../core/model.js';
import { CONFIDENCE } from '../../core/constants.js';
import { isSolanaAddress } from '../../utils/validation.js';
import { fetchJson } from '../http.js';

export const RUGCHECK_BASE = 'https://api.rugcheck.xyz/v1';
export const RUGCHECK_ORIGIN = 'https://api.rugcheck.xyz/*';
const SOURCE = 'rugcheck';
const MEMO_TTL_MS = 15000;

export const TEST_TARGET = { chain: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', addressKind: 'token' };

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const F = (v) => field(v, SOURCE, CONFIDENCE.MEASURED);
const round2 = (n) => Math.round(n * 100) / 100;

/** First value that is actually present (null counts as present: it means "revoked"). */
function firstDefined(...values) {
  for (const v of values) if (v !== undefined) return v;
  return undefined;
}

/** Is this top-holder entry a pool / AMM vault rather than a person? */
export function isPoolHolder(holder, knownAccounts) {
  if (!holder) return false;
  const known = knownAccounts && (knownAccounts[holder.owner] || knownAccounts[holder.address]);
  if (!known) return false;
  return /amm|lp|pool|liquidity|raydium|orca|meteora|pumpswap|pump\s*fun|vault/i.test(`${known.type || ''} ${known.name || ''}`);
}

export function translateHolders(report) {
  const raw = Array.isArray(report.topHolders) ? report.topHolders.filter(Boolean) : [];
  const known = report.knownAccounts && typeof report.knownAccounts === 'object' ? report.knownAccounts : {};
  const holders = raw
    .map((h) => ({ ...h, pctNum: num(h.pct) }))
    .filter((h) => h.pctNum !== null)
    .sort((a, b) => b.pctNum - a.pctNum);
  const pools = holders.filter((h) => isPoolHolder(h, known));
  const people = holders.filter((h) => !isPoolHolder(h, known));
  const sum = (list) => round2(list.reduce((s, h) => s + h.pctNum, 0));
  const count = num(report.totalHolders);

  if (!holders.length && count === null) return null;
  return {
    holders: {
      count: count === null ? null : F(count),
      // Concentration is measured over wallets, with pool vaults set aside:
      // the Raydium pool "owning" 30% is liquidity, not a whale.
      top10Pct: people.length ? F(sum(people.slice(0, 10))) : null,
      top20Pct: people.length ? F(sum(people.slice(0, 20))) : null,
      largestPct: holders.length ? F(holders[0].pctNum) : null,
      largestNonLpPct: people.length ? F(people[0].pctNum) : null,
      lpHeldPct: holders.length ? F(sum(pools)) : null,
    },
  };
}

export function translateContract(report) {
  const token = report.token && typeof report.token === 'object' ? report.token : {};
  const mint = firstDefined(token.mintAuthority, report.mintAuthority);
  const freeze = firstDefined(token.freezeAuthority, report.freezeAuthority);
  const authority = (v) => (v === undefined ? null : F(v !== null && v !== ''));

  // LP lock: take the deepest market's lp block.
  const markets = Array.isArray(report.markets) ? report.markets.filter((m) => m && m.lp) : [];
  const deepest = markets.sort((a, b) => (num(b.lp.lpLockedUSD) ?? num(b.lp.lpTotalSupply) ?? 0) - (num(a.lp.lpLockedUSD) ?? num(a.lp.lpTotalSupply) ?? 0))[0];
  const lpLocked = deepest ? num(deepest.lp.lpLockedPct) : null;

  // Token-2022 transfer fee applies on every transfer - the nearest thing
  // Solana has to a trading tax.
  const fee = report.transferFee && typeof report.transferFee === 'object' ? num(report.transferFee.pct) : null;

  if (mint === undefined && freeze === undefined && lpLocked === null && fee === null) return null;
  return {
    contract: {
      mintAuthorityActive: authority(mint),
      freezeAuthorityActive: authority(freeze),
      lpBurnedOrLockedPct: lpLocked === null ? null : F(lpLocked),
      buyTaxPct: fee === null ? null : F(fee),
      sellTaxPct: fee === null ? null : F(fee),
      // Solana has no honeypot mechanism as such; freeze authority is the
      // equivalent risk and is reported above. Left unknown, not "safe".
      honeypot: null,
    },
  };
}

export function translateDev(report) {
  const token = report.token && typeof report.token === 'object' ? report.token : {};
  const creator = typeof report.creator === 'string' && report.creator ? report.creator : null;
  const balance = num(report.creatorBalance);
  const supply = num(token.supply);
  let holdingPct = null;
  if (balance !== null && supply !== null && supply > 0) {
    holdingPct = round2((balance / supply) * 100);
    if (holdingPct < 0 || holdingPct > 100) holdingPct = null; // unit mismatch guard
  }
  if (!creator && holdingPct === null) return null;
  return {
    dev: {
      deployerAddress: creator ? F(creator) : null,
      deployerHoldingPct: holdingPct === null ? null : F(holdingPct),
      // Selling history is not in the report; left unknown rather than 0.
      deployerSoldPct: null,
    },
  };
}

export function createRugCheckProvider({ fetchImpl, now = () => Date.now() } = {}) {
  const memo = new Map();
  const http = (url, ctx) => fetchJson(url, { timeoutMs: 8000, signal: ctx && ctx.signal, fetchImpl });

  function reportFor(target, ctx) {
    const key = target.address;
    const hit = memo.get(key);
    const at = now();
    if (hit && at - hit.at < MEMO_TTL_MS) return hit.promise;
    const promise = http(`${RUGCHECK_BASE}/tokens/${encodeURIComponent(target.address)}/report`, ctx);
    memo.set(key, { promise, at });
    promise.catch(() => memo.delete(key));
    return promise;
  }

  return {
    id: 'rugcheck',
    label: 'RugCheck',
    priority: 40,
    chains: ['solana'],
    stages: ['holders', 'contract', 'dev'],
    requiresKey: false,
    origins: [RUGCHECK_ORIGIN],
    isConfigured: (config = {}) => Boolean(config.rugcheck && config.rugcheck.enabled),

    async fetch(stage, target, ctx = {}) {
      if (!isSolanaAddress(target.address)) return null;
      const report = await reportFor(target, ctx);
      if (!report || typeof report !== 'object') return null;
      switch (stage) {
        case 'holders': return translateHolders(report);
        case 'contract': return translateContract(report);
        case 'dev': return translateDev(report);
        default: return null;
      }
    },

    async test(ctx = {}) {
      const url = `${RUGCHECK_BASE}/tokens/${TEST_TARGET.address}/report`;
      const started = now();
      try {
        const report = await http(url, ctx);
        const keys = (o) => (o && typeof o === 'object' ? Object.keys(o) : [typeof o]);
        const holder0 = Array.isArray(report.topHolders) ? report.topHolders[0] : null;
        const market0 = Array.isArray(report.markets) ? report.markets[0] : null;
        const knownSample = report.knownAccounts && typeof report.knownAccounts === 'object'
          ? Object.entries(report.knownAccounts).slice(0, 3).map(([k, v]) => ({ address: k, ...v }))
          : null;
        const v = (m) => (m ? m.value : null);
        const holders = translateHolders(report);
        const contract = translateContract(report);
        const dev = translateDev(report);
        return {
          ok: Boolean(holders || contract),
          ms: now() - started,
          url,
          topLevelKeys: keys(report),
          tokenKeys: keys(report.token),
          topHolderKeys: keys(holder0),
          topHolderCount: Array.isArray(report.topHolders) ? report.topHolders.length : null,
          marketKeys: keys(market0),
          lpKeys: market0 ? keys(market0.lp) : [],
          knownAccountsSample: knownSample,
          sample: {
            totalHolders: report.totalHolders, mintAuthority: report.token && report.token.mintAuthority,
            freezeAuthority: report.token && report.token.freezeAuthority, creator: report.creator,
            creatorBalance: report.creatorBalance, supply: report.token && report.token.supply,
            decimals: report.token && report.token.decimals, topHolder0: holder0,
            lpLockedPct: market0 && market0.lp && market0.lp.lpLockedPct, rugged: report.rugged,
            score: report.score, score_normalised: report.score_normalised, transferFee: report.transferFee,
          },
          translated: {
            top10Pct: holders ? v(holders.holders.top10Pct) : null,
            largestNonLpPct: holders ? v(holders.holders.largestNonLpPct) : null,
            lpHeldPct: holders ? v(holders.holders.lpHeldPct) : null,
            mintAuthorityActive: contract ? v(contract.contract.mintAuthorityActive) : null,
            freezeAuthorityActive: contract ? v(contract.contract.freezeAuthorityActive) : null,
            lpBurnedOrLockedPct: contract ? v(contract.contract.lpBurnedOrLockedPct) : null,
            deployerHoldingPct: dev ? v(dev.dev.deployerHoldingPct) : null,
          },
          note: holders || contract ? null : 'Request succeeded but nothing translated - the report shape may differ from what the translator expects.',
        };
      } catch (err) {
        return { ok: false, ms: now() - started, url, error: String((err && err.message) || err), status: err && err.status ? err.status : null };
      }
    },
  };
}
