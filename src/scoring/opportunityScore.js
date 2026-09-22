/**
 * Opportunity Score.
 *
 * This is NOT a probability of profit and must never be presented as one. It is
 * a standardised 0-100 summary of how a token currently measures up on eight
 * observable dimensions, so two tokens can be compared on the same yardstick.
 *
 * Structure: each dimension returns a component with its own score, weight and
 * plain-language reasons. The total is the weight-normalised mean over the
 * components that actually have data. If too little data is available, the
 * score is null and the UI shows "Insufficient data" - never a filled-in guess.
 */

import { pick } from '../core/model.js';
import { DEFAULT_OPPORTUNITY_WEIGHTS } from './config.js';
import { linearScore, logScore, bandScore, safeRatio, round, clamp } from './curves.js';
import { computeMomentum, buyRatio } from './momentumScore.js';
import { MIN_COVERAGE } from '../core/constants.js';

export function computeOpportunity(snapshot, options = {}) {
  const weights = { ...DEFAULT_OPPORTUNITY_WEIGHTS, ...(options.weights || {}) };
  const minCoverage = options.minCoverage ?? MIN_COVERAGE;
  const momentum = options.momentum ?? computeMomentum(snapshot, options);

  const components = [
    { ...momentum, weight: weights.momentum },
    volumeToMcapComponent(snapshot, weights.volumeToMcap),
    liquidityComponent(snapshot, weights.liquidity),
    buySellComponent(snapshot, weights.buySellPressure),
    holderGrowthComponent(snapshot, weights.holderGrowth),
    marketCapContextComponent(snapshot, weights.marketCapContext),
    socialComponent(snapshot, weights.socialPresence),
    walletActivityComponent(snapshot, weights.walletActivity),
  ];

  return compose('opportunity', 'Opportunity Score', components, minCoverage);
}

/**
 * Weight-normalised composition. Components without data are excluded and their
 * weight is redistributed, but `coverage` records how much was missing so the
 * UI can show how trustworthy the number is.
 */
export function compose(key, label, components, minCoverage = MIN_COVERAGE) {
  const totalWeight = components.reduce((sum, c) => sum + (c.weight || 0), 0);
  const available = components.filter((c) => c.available && Number.isFinite(c.score));
  const availableWeight = available.reduce((sum, c) => sum + (c.weight || 0), 0);
  const coverage = totalWeight > 0 ? availableWeight / totalWeight : 0;

  const enriched = components.map((c) => ({
    ...c,
    effectiveWeight: c.available && availableWeight > 0 ? round((c.weight / availableWeight) * 100, 1) : 0,
  }));

  if (coverage < minCoverage || availableWeight === 0) {
    return {
      key,
      label,
      score: null,
      insufficientData: true,
      coverage: round(coverage, 2),
      components: enriched,
      missing: components.filter((c) => !c.available).map((c) => c.label),
      summary: `Insufficient data - only ${Math.round(coverage * 100)}% of the scoring inputs were available.`,
    };
  }

  const score = available.reduce((sum, c) => sum + c.score * (c.weight / availableWeight), 0);
  return {
    key,
    label,
    score: round(score, 0),
    insufficientData: false,
    coverage: round(coverage, 2),
    components: enriched,
    missing: components.filter((c) => !c.available).map((c) => c.label),
    summary: null,
  };
}

function unavailable(key, label, weight, missing) {
  return { key, label, weight, score: null, available: false, reasons: [], missing, parts: [] };
}

// --- individual dimensions --------------------------------------------------

export function volumeToMcapComponent(snapshot, weight) {
  const vol = pick(snapshot, 'market.volume.h24');
  const mcap = pick(snapshot, 'market.marketCapUsd');
  const ratio = safeRatio(vol, mcap);
  if (!Number.isFinite(ratio)) {
    return unavailable('volumeToMcap', 'Volume / Market Cap', weight, ['24h volume', 'market cap']);
  }
  // 0.02x -> ~10, 0.3x -> ~60, 1x -> ~80, 4x+ -> ~100
  const score = logScore(clamp(ratio, 0.005, 6), 0.02, 4);
  const reasons = [`24h volume is ${round(ratio, 2)}x market cap.`];
  if (ratio > 5) {
    reasons.push('Turnover this high can also indicate wash trading - see Risk.');
  } else if (ratio > 0.8) {
    reasons.push('Turnover is high relative to size - the token is being actively traded.');
  } else if (ratio < 0.05) {
    reasons.push('Turnover is low relative to size - little active interest right now.');
  }
  return { key: 'volumeToMcap', label: 'Volume / Market Cap', weight, score: round(score, 0), available: true, reasons, missing: [], parts: [] };
}

export function liquidityComponent(snapshot, weight) {
  const liq = pick(snapshot, 'market.liquidityUsd');
  const mcap = pick(snapshot, 'market.marketCapUsd');
  if (!Number.isFinite(liq)) {
    return unavailable('liquidity', 'Liquidity', weight, ['liquidity']);
  }
  // Absolute depth: $5K -> 0, $500K -> 100 (log).
  const absScore = logScore(Math.max(liq, 1), 5000, 500000);
  const ratio = safeRatio(liq, mcap);
  const reasons = [];
  let score = absScore;

  if (Number.isFinite(ratio)) {
    // Depth relative to size: 2% -> 0, 20% -> 100.
    const relScore = linearScore(ratio, 0.02, 0.2);
    score = absScore * 0.6 + relScore * 0.4;
    reasons.push(`Liquidity is ${round(ratio * 100, 1)}% of market cap.`);
    if (ratio < 0.05) reasons.push('Thin relative to market cap - exits may move the price hard.');
    else if (ratio > 0.15) reasons.push('Deep relative to market cap for a token this size.');
  } else {
    reasons.push('Market cap unavailable, so depth is judged on the absolute figure only.');
  }
  reasons.unshift(`Pool depth is about $${Math.round(liq).toLocaleString('en-US')}.`);

  return { key: 'liquidity', label: 'Liquidity', weight, score: round(score, 0), available: true, reasons, missing: [], parts: [] };
}

export function buySellComponent(snapshot, weight) {
  const ratio = buyRatio(snapshot, 'h1') ?? buyRatio(snapshot, 'm5');
  if (!Number.isFinite(ratio)) {
    return unavailable('buySellPressure', 'Buy/Sell Pressure', weight, ['buy/sell transaction counts']);
  }
  const score = linearScore(ratio, 0.32, 0.68);
  const pct = round(ratio * 100, 0);
  const reasons = [`${pct}% of recent trades are buys.`];
  if (ratio > 0.6) reasons.push('Demand is clearly outweighing supply in the order flow.');
  else if (ratio < 0.4) reasons.push('Sellers are outnumbering buyers.');
  else reasons.push('Order flow is close to balanced.');
  return { key: 'buySellPressure', label: 'Buy/Sell Pressure', weight, score: round(score, 0), available: true, reasons, missing: [], parts: [] };
}

export function holderGrowthComponent(snapshot, weight) {
  const growth = pick(snapshot, 'holders.countChange1h');
  const count = pick(snapshot, 'holders.count');
  if (!Number.isFinite(growth)) {
    return unavailable('holderGrowth', 'Holder Growth', weight, ['holder count history']);
  }
  const score = linearScore(growth, -5, 25);
  const reasons = [`Holder count changed ${growth > 0 ? '+' : ''}${round(growth, 1)}% in the last hour.`];
  if (Number.isFinite(count)) reasons.push(`Currently ${Math.round(count).toLocaleString('en-US')} holders.`);
  if (growth > 10) reasons.push('New wallets are entering quickly.');
  else if (growth < 0) reasons.push('Holder count is shrinking.');
  return { key: 'holderGrowth', label: 'Holder Growth', weight, score: round(score, 0), available: true, reasons, missing: [], parts: [] };
}

export function marketCapContextComponent(snapshot, weight) {
  const mcap = pick(snapshot, 'market.marketCapUsd');
  if (!Number.isFinite(mcap)) {
    return unavailable('marketCapContext', 'Market Cap Context', weight, ['market cap']);
  }
  const band = bandScore(mcap, [
    { upTo: 15000, score: 35, label: 'micro cap - extremely thin, high variance both ways' },
    { upTo: 100000, score: 70, label: 'very early - large room to move, fragile' },
    { upTo: 1000000, score: 82, label: 'early but established enough to trade' },
    { upTo: 10000000, score: 70, label: 'mid range - meaningful size, less room for multiples' },
    { upTo: 100000000, score: 52, label: 'large for a memecoin - further multiples need heavy inflow' },
    { upTo: Infinity, score: 35, label: 'very large - limited room relative to risk' },
  ]);
  return {
    key: 'marketCapContext',
    label: 'Market Cap Context',
    weight,
    score: band.score,
    available: true,
    reasons: [`$${Math.round(mcap).toLocaleString('en-US')} market cap: ${band.label}.`],
    missing: [],
    parts: [],
  };
}

export function socialComponent(snapshot, weight) {
  const hasWebsite = pick(snapshot, 'social.hasWebsite');
  const hasTwitter = pick(snapshot, 'social.hasTwitter');
  const hasTelegram = pick(snapshot, 'social.hasTelegram');
  const boosted = pick(snapshot, 'social.boosted');
  const known = [hasWebsite, hasTwitter, hasTelegram].filter((v) => v !== null);
  if (known.length === 0) {
    return unavailable('socialPresence', 'Social Presence', weight, ['social links']);
  }
  const present = known.filter(Boolean).length;
  // Presence of channels is a weak, honest proxy. It is NOT engagement.
  let score = linearScore(present, 0, 3);
  if (boosted === true) score = clamp(score + 10);
  const reasons = [
    `${present} of ${known.length} checked social channels are linked` +
      `${present ? ` (${[hasWebsite && 'website', hasTwitter && 'X/Twitter', hasTelegram && 'Telegram'].filter(Boolean).join(', ')})` : ''}.`,
    'Measures whether channels exist, not whether the community is real - engagement data is not available in this build.',
  ];
  if (boosted === true) reasons.push('Token profile is promoted/boosted on its listing platform.');
  return { key: 'socialPresence', label: 'Social Presence', weight, score: round(score, 0), available: true, reasons, missing: [], parts: [] };
}

export function walletActivityComponent(snapshot, weight) {
  const txns = pick(snapshot, 'market.txns.h1');
  const holders = pick(snapshot, 'holders.count');
  if (!txns || !Number.isFinite(txns.buys) || !Number.isFinite(txns.sells)) {
    return unavailable('walletActivity', 'Wallet Activity', weight, ['transaction counts']);
  }
  const total = txns.buys + txns.sells;
  let score = logScore(Math.max(total, 1), 15, 2000);
  const reasons = [`${total} trades in the last hour.`];
  if (Number.isFinite(holders) && holders > 0) {
    const perHolder = total / holders;
    reasons.push(`That is ${round(perHolder, 2)} trades per holder.`);
    if (perHolder > 2) {
      score = clamp(score - 12);
      reasons.push('Very high trade-per-holder ratio can indicate a small set of wallets churning volume.');
    }
  }
  return { key: 'walletActivity', label: 'Wallet Activity', weight, score: round(score, 0), available: true, reasons, missing: [], parts: [] };
}
