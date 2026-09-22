/**
 * PHASE 1 MOCK PROVIDER - generates placeholder data so the detection,
 * scoring, progressive-loading and UI layers can be built and tested with no
 * network access.
 *
 * Design rules that make this useful rather than decorative:
 *  1. DETERMINISTIC - the same address always produces the same numbers, so a
 *     scan is reproducible and testable.
 *  2. INTERNALLY CONSISTENT - market cap = price x supply, volume windows nest
 *     correctly, transaction counts track volume. Nonsense inputs would hide
 *     real scoring bugs.
 *  3. ARCHETYPES - addresses map onto six different token situations including
 *     a deliberately data-poor one, so every UI state (strong, risky, fading,
 *     insufficient data) is reachable without waiting for a real token to
 *     misbehave.
 *  4. HONESTLY LABELLED - every snapshot it produces sets meta.isMockData, and
 *     the UI shows a DEMO DATA banner. This must never be mistaken for live data.
 *
 * Replace by registering a real provider with the same shape - see
 * httpProvider.template.js.
 */

import { field, markStageComplete } from '../../core/model.js';
import { CONFIDENCE } from '../../core/constants.js';

const SOURCE = 'mock';

export const ARCHETYPES = ['earlyRunner', 'establishedMeme', 'thinAndRisky', 'dangerSignals', 'fading', 'sparseData'];

/** FNV-1a: small, fast, stable across runs and platforms. */
export function hashAddress(address) {
  let h = 0x811c9dc5;
  const s = String(address || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 - deterministic PRNG seeded from the address hash. */
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function archetypeFor(address) {
  const h = hashAddress(address);
  return ARCHETYPES[h % ARCHETYPES.length];
}

const PROFILES = {
  earlyRunner: {
    ageMinutes: [20, 240], mcap: [80000, 900000], liqRatio: [0.08, 0.2], vol24Ratio: [0.9, 3.5],
    priceH1: [4, 45], buyShare: [0.55, 0.72], top10: [18, 34], largestNonLp: [3, 9],
    devHold: [0.5, 3], devSold: [0, 0.4], holderGrowth: [8, 30], holders: [400, 3000],
    mint: false, freeze: false, lpLocked: [80, 100], tax: [0, 1], socials: 3,
  },
  establishedMeme: {
    ageMinutes: [20000, 400000], mcap: [8000000, 300000000], liqRatio: [0.04, 0.12], vol24Ratio: [0.1, 0.6],
    priceH1: [-4, 6], buyShare: [0.45, 0.58], top10: [8, 22], largestNonLp: [1.5, 5],
    devHold: [0, 1], devSold: [0, 0.2], holderGrowth: [0, 3], holders: [40000, 400000],
    mint: false, freeze: false, lpLocked: [95, 100], tax: [0, 0], socials: 3,
  },
  thinAndRisky: {
    ageMinutes: [45, 900], mcap: [30000, 300000], liqRatio: [0.012, 0.045], vol24Ratio: [1.5, 9],
    priceH1: [-15, 35], buyShare: [0.42, 0.62], top10: [40, 68], largestNonLp: [12, 28],
    devHold: [2, 9], devSold: [0, 1.5], holderGrowth: [2, 18], holders: [120, 900],
    mint: false, freeze: false, lpLocked: [20, 70], tax: [0, 6], socials: 1,
  },
  dangerSignals: {
    ageMinutes: [5, 120], mcap: [15000, 200000], liqRatio: [0.01, 0.04], vol24Ratio: [2, 12],
    priceH1: [-30, 60], buyShare: [0.35, 0.6], top10: [50, 82], largestNonLp: [20, 42],
    devHold: [8, 25], devSold: [3, 14], holderGrowth: [-2, 25], holders: [40, 500],
    mint: true, freeze: true, lpLocked: [0, 25], tax: [5, 25], socials: 0,
  },
  fading: {
    ageMinutes: [2000, 40000], mcap: [200000, 4000000], liqRatio: [0.05, 0.14], vol24Ratio: [0.02, 0.18],
    priceH1: [-22, -1], buyShare: [0.26, 0.44], top10: [22, 42], largestNonLp: [5, 13],
    devHold: [0, 2], devSold: [0.2, 2], holderGrowth: [-6, 0.5], holders: [2000, 25000],
    mint: false, freeze: false, lpLocked: [70, 100], tax: [0, 3], socials: 2,
  },
  // Deliberately data-poor: exercises every "Insufficient data" path.
  sparseData: {
    ageMinutes: null, mcap: [25000, 400000], liqRatio: null, vol24Ratio: [0.05, 1.2],
    priceH1: null, buyShare: null, top10: null, largestNonLp: null,
    devHold: null, devSold: null, holderGrowth: null, holders: null,
    mint: null, freeze: null, lpLocked: null, tax: null, socials: null,
  },
};

const between = (r, range) => (range ? range[0] + r() * (range[1] - range[0]) : null);

/** Everything a scan needs, derived once per address so stages stay consistent. */
export function buildMockModel(address, chain, now = Date.now()) {
  const seed = hashAddress(address);
  const r = rng(seed);
  const kind = archetypeFor(address);
  const p = PROFILES[kind];

  const ageMinutes = between(r, p.ageMinutes);
  const marketCapUsd = between(r, p.mcap);
  const supply = Math.round(10 ** (8 + Math.floor(r() * 4)));
  const priceUsd = marketCapUsd / supply;
  const liquidityUsd = p.liqRatio === null ? null : marketCapUsd * between(r, p.liqRatio);
  const volume24 = marketCapUsd * between(r, p.vol24Ratio);

  // Nest the volume windows so h1 < h6 < h24 always holds.
  const hourlyShare = 0.03 + r() * 0.14;
  const volumeH1 = volume24 * hourlyShare;
  const volumeH6 = Math.min(volume24, volumeH1 * (3 + r() * 3));
  const volumeM5 = volumeH1 * (0.05 + r() * 0.2);

  const priceH1 = between(r, p.priceH1);
  const priceH24 = priceH1 === null ? null : priceH1 * (1.2 + r() * 2.5);
  const priceM5 = priceH1 === null ? null : priceH1 * (0.08 + r() * 0.3);
  const priceH6 = priceH1 === null ? null : priceH1 * (1.1 + r() * 1.4);

  const buyShare = between(r, p.buyShare);
  // Roughly one trade per $250-1250 of volume.
  const tradeSize = 250 + r() * 1000;
  const txnsH1 = Math.max(1, Math.round(volumeH1 / tradeSize));
  const txnsH24 = Math.max(txnsH1, Math.round(volume24 / tradeSize));
  const txnsM5 = Math.max(0, Math.round(volumeM5 / tradeSize));

  const split = (total) => {
    if (buyShare === null) return null;
    const buys = Math.round(total * buyShare);
    return { buys, sells: Math.max(0, total - buys) };
  };

  const top10 = between(r, p.top10);
  const largestNonLp = between(r, p.largestNonLp);

  return {
    kind,
    chain,
    address,
    supply,
    priceUsd,
    marketCapUsd,
    fdvUsd: marketCapUsd * (1 + r() * 0.25),
    liquidityUsd,
    createdAt: ageMinutes === null ? null : now - ageMinutes * 60000,
    volume: { m5: volumeM5, h1: volumeH1, h6: volumeH6, h24: volume24 },
    priceChange: { m5: priceM5, h1: priceH1, h6: priceH6, h24: priceH24 },
    txns: { m5: split(txnsM5), h1: split(txnsH1), h6: split(Math.round(txnsH24 * 0.3)), h24: split(txnsH24) },
    holders: {
      count: p.holders === null ? null : Math.round(between(r, p.holders)),
      countChange1h: between(r, p.holderGrowth),
      top10Pct: top10,
      top20Pct: top10 === null ? null : Math.min(95, top10 * (1.15 + r() * 0.2)),
      largestPct: largestNonLp === null ? null : largestNonLp * (1.4 + r()),
      largestNonLpPct: largestNonLp,
      lpHeldPct: p.liqRatio === null ? null : 10 + r() * 25,
    },
    contract: {
      mintAuthorityActive: p.mint,
      freezeAuthorityActive: p.freeze,
      lpBurnedOrLockedPct: between(r, p.lpLocked),
      honeypot: p.tax === null ? null : false,
      buyTaxPct: between(r, p.tax),
      sellTaxPct: between(r, p.tax),
    },
    dev: {
      deployerAddress: p.devHold === null ? null : mockWallet(seed, chain),
      deployerHoldingPct: between(r, p.devHold),
      deployerSoldPct: between(r, p.devSold),
    },
    social: p.socials === null
      ? null
      : { hasWebsite: p.socials >= 1, hasTwitter: p.socials >= 2, hasTelegram: p.socials >= 3, linkCount: p.socials, boosted: p.socials === 3 && r() > 0.6 },
  };
}

function mockWallet(seed, chain) {
  const hex = (seed >>> 0).toString(16).padStart(8, '0').repeat(5);
  return chain === 'solana' ? `Dev${hex.slice(0, 41)}` : `0x${hex.slice(0, 40)}`;
}

const F = (v) => field(v, SOURCE, CONFIDENCE.MOCK);

/** Simulated latency so the progressive-rendering path is exercised for real. */
const STAGE_LATENCY = { identity: 60, market: 140, holders: 420, contract: 300, dev: 560, social: 220 };

export function createMockProvider(options = {}) {
  const latencyFactor = options.latencyFactor ?? 1;
  const now = options.now ?? (() => Date.now());

  return {
    id: 'mock',
    label: 'Demo data (Phase 1)',
    priority: -100, // always the last resort once real providers exist
    chains: '*',
    stages: ['identity', 'market', 'holders', 'contract', 'dev', 'social'],
    requiresKey: false,
    isMock: true,
    isConfigured: () => true,

    async fetch(stage, target) {
      const delay = (STAGE_LATENCY[stage] ?? 100) * latencyFactor;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const m = buildMockModel(target.address, target.chain, now());

      switch (stage) {
        case 'identity':
          // Deliberately returns NO name, symbol or decimals. Placeholder
          // market numbers are labelled DEMO DATA and understood as fake, but a
          // fabricated NAME makes the panel look like it is describing a
          // different token than the one on screen - which is worse than
          // showing nothing. Identity comes from the address (real), from the
          // page, or not at all.
          return {
            identity: { chain: target.chain, address: target.address, addressKind: target.addressKind ?? 'token', dexId: 'demo-dex' },
            meta: { isMockData: true },
          };
        case 'market':
          return {
            market: {
              priceUsd: F(m.priceUsd),
              marketCapUsd: F(m.marketCapUsd),
              fdvUsd: F(m.fdvUsd),
              liquidityUsd: F(m.liquidityUsd),
              createdAt: F(m.createdAt),
              volume: { m5: F(m.volume.m5), h1: F(m.volume.h1), h6: F(m.volume.h6), h24: F(m.volume.h24) },
              priceChange: { m5: F(m.priceChange.m5), h1: F(m.priceChange.h1), h6: F(m.priceChange.h6), h24: F(m.priceChange.h24) },
              txns: { m5: F(m.txns.m5), h1: F(m.txns.h1), h6: F(m.txns.h6), h24: F(m.txns.h24) },
            },
            meta: { isMockData: true },
          };
        case 'holders':
          if (m.holders.top10Pct === null && m.holders.count === null) return null;
          return {
            holders: {
              count: F(m.holders.count),
              countChange1h: F(m.holders.countChange1h),
              top10Pct: F(m.holders.top10Pct),
              top20Pct: F(m.holders.top20Pct),
              largestPct: F(m.holders.largestPct),
              largestNonLpPct: F(m.holders.largestNonLpPct),
              lpHeldPct: F(m.holders.lpHeldPct),
            },
            meta: { isMockData: true },
          };
        case 'contract':
          if (m.contract.mintAuthorityActive === null) return null;
          return {
            contract: {
              mintAuthorityActive: F(m.contract.mintAuthorityActive),
              freezeAuthorityActive: F(m.contract.freezeAuthorityActive),
              lpBurnedOrLockedPct: F(m.contract.lpBurnedOrLockedPct),
              honeypot: F(m.contract.honeypot),
              buyTaxPct: F(m.contract.buyTaxPct),
              sellTaxPct: F(m.contract.sellTaxPct),
            },
            meta: { isMockData: true },
          };
        case 'dev':
          if (m.dev.deployerHoldingPct === null) return null;
          return {
            dev: {
              deployerAddress: F(m.dev.deployerAddress),
              deployerHoldingPct: F(m.dev.deployerHoldingPct),
              deployerSoldPct: F(m.dev.deployerSoldPct),
            },
            meta: { isMockData: true },
          };
        case 'social':
          if (!m.social) return null;
          return {
            social: {
              hasWebsite: F(m.social.hasWebsite),
              hasTwitter: F(m.social.hasTwitter),
              hasTelegram: F(m.social.hasTelegram),
              linkCount: F(m.social.linkCount),
              boosted: F(m.social.boosted),
            },
            meta: { isMockData: true },
          };
        default:
          return null;
      }
    },
  };
}

export { markStageComplete };
