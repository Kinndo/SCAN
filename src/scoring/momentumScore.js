/**
 * Momentum.
 *
 * Deliberately NOT "price went up = good". The same +12% hour means opposite
 * things depending on whether participation is expanding or draining, so the
 * module cross-reads price against volume pace, buy/sell balance, transaction
 * count and holder growth, and states the interpretation in words.
 */

import { pick } from '../core/model.js';
import { DEFAULT_MOMENTUM_WEIGHTS } from './config.js';
import { clamp, linearScore, logScore, weightedMean, safeRatio, round } from './curves.js';

/**
 * Volume pace: current hourly burn rate vs the 24h average hourly rate.
 * 1.0 = running at its daily average. 3.0 = three times hotter than average.
 */
export function volumePace(snapshot) {
  const h1 = pick(snapshot, 'market.volume.h1');
  const h24 = pick(snapshot, 'market.volume.h24');
  if (Number.isFinite(h1) && Number.isFinite(h24) && h24 > 0) {
    return { pace: safeRatio(h1, h24 / 24), basis: '1h vs 24h average' };
  }
  const m5 = pick(snapshot, 'market.volume.m5');
  if (Number.isFinite(m5) && Number.isFinite(h1) && h1 > 0) {
    return { pace: safeRatio(m5, h1 / 12), basis: '5m vs 1h average' };
  }
  return { pace: null, basis: null };
}

export function buyRatio(snapshot, window = 'h1') {
  const txns = pick(snapshot, `market.txns.${window}`);
  if (!txns || !Number.isFinite(txns.buys) || !Number.isFinite(txns.sells)) return null;
  const total = txns.buys + txns.sells;
  if (total <= 0) return null;
  return txns.buys / total;
}

export function computeMomentum(snapshot, { weights = DEFAULT_MOMENTUM_WEIGHTS } = {}) {
  const parts = [];
  const missing = [];
  const reasons = [];

  // --- price change (1h, with 5m as fallback) -------------------------------
  const pc1h = pick(snapshot, 'market.priceChange.h1');
  const pc5m = pick(snapshot, 'market.priceChange.m5');
  const priceRef = Number.isFinite(pc1h) ? pc1h : pc5m;
  const priceWindow = Number.isFinite(pc1h) ? '1h' : '5m';
  if (Number.isFinite(priceRef)) {
    // -25% -> 0, flat -> 50, +40% -> 100
    parts.push({
      key: 'priceChange',
      label: 'Price change',
      score: linearScore(priceRef, -25, 40),
      weight: weights.priceChange,
      detail: `${priceRef > 0 ? '+' : ''}${round(priceRef, 1)}% over ${priceWindow}`,
    });
  } else {
    missing.push('price change');
  }

  // --- volume acceleration --------------------------------------------------
  const { pace, basis } = volumePace(snapshot);
  if (Number.isFinite(pace)) {
    // 0.25x -> 10, 1x -> 50, 3x -> 85, 8x+ -> 100
    parts.push({
      key: 'volumeAcceleration',
      label: 'Volume acceleration',
      score: logScore(clamp(pace, 0.05, 12), 0.25, 8),
      weight: weights.volumeAcceleration,
      detail: `${round(pace, 2)}x its average pace (${basis})`,
    });
  } else {
    missing.push('volume acceleration');
  }

  // --- buy/sell ratio -------------------------------------------------------
  const ratio = buyRatio(snapshot, 'h1') ?? buyRatio(snapshot, 'm5');
  if (Number.isFinite(ratio)) {
    // 30% buys -> 0, 50/50 -> 50, 70% buys -> 100
    parts.push({
      key: 'buySellRatio',
      label: 'Buy/sell balance',
      score: linearScore(ratio, 0.3, 0.7),
      weight: weights.buySellRatio,
      detail: `${round(ratio * 100, 0)}% of trades are buys`,
    });
  } else {
    missing.push('buy/sell counts');
  }

  // --- raw transaction activity --------------------------------------------
  const txns = pick(snapshot, 'market.txns.h1');
  if (txns && Number.isFinite(txns.buys) && Number.isFinite(txns.sells)) {
    const total = txns.buys + txns.sells;
    parts.push({
      key: 'transactionActivity',
      label: 'Transaction count',
      score: logScore(Math.max(total, 1), 10, 1500),
      weight: weights.transactionActivity,
      detail: `${total} trades in the last hour`,
    });
  } else {
    missing.push('transaction count');
  }

  // --- holder growth --------------------------------------------------------
  const holderGrowth = pick(snapshot, 'holders.countChange1h');
  if (Number.isFinite(holderGrowth)) {
    parts.push({
      key: 'holderGrowth',
      label: 'Holder growth',
      score: linearScore(holderGrowth, -5, 25),
      weight: weights.holderGrowth,
      detail: `${holderGrowth > 0 ? '+' : ''}${round(holderGrowth, 1)}% holders in 1h`,
    });
  } else {
    missing.push('holder growth');
  }

  const { score, coverage } = weightedMean(parts);
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const coverageRatio = totalWeight ? coverage / totalWeight : 0;
  // --- interpretation: the part a raw number cannot express -----------------
  const interpretation = interpret(priceRef, pace, ratio, holderGrowth);
  if (interpretation) reasons.push(interpretation);
  if (Number.isFinite(pace) && Number.isFinite(priceRef)) {
    reasons.push(
      `Price ${priceRef >= 0 ? 'up' : 'down'} ${Math.abs(round(priceRef, 1))}% with volume at ${round(pace, 2)}x average pace.`,
    );
  }
  if (Number.isFinite(ratio)) {
    reasons.push(`Order flow is ${round(ratio * 100, 0)}% buys / ${round(100 - ratio * 100, 0)}% sells.`);
  }
  // A score with no explanation is exactly what this product must never emit.
  // When too little is present to form an interpretation, fall back to naming
  // the inputs that did contribute.
  if (!reasons.length && parts.length) {
    reasons.push(`Scored from ${parts.map((p) => `${p.label.toLowerCase()} (${p.detail})`).join('; ')}.`);
  }
  if (missing.length && score !== null) {
    reasons.push(`No data for ${missing.join(', ')} - those inputs were excluded.`);
  }

  return {
    key: 'momentum',
    label: 'Momentum',
    score: score === null ? null : round(score, 0),
    available: score !== null,
    coverage: coverageRatio,
    parts,
    reasons,
    missing,
    interpretation,
  };
}

function interpret(priceChange, pace, ratio, holderGrowth) {
  const hasPrice = Number.isFinite(priceChange);
  const hasPace = Number.isFinite(pace);
  if (!hasPrice || !hasPace) return null;

  const rising = priceChange > 2;
  const falling = priceChange < -2;
  const hot = pace > 1.3;
  const cooling = pace < 0.7;
  const buying = Number.isFinite(ratio) && ratio > 0.55;
  const selling = Number.isFinite(ratio) && ratio < 0.45;
  const holdersUp = Number.isFinite(holderGrowth) && holderGrowth > 2;

  // Order matters. The sell-dominated cases are checked FIRST, because
  // "price up on heavy volume" and "price up on heavy volume while sellers
  // outnumber buyers" mean opposite things, and the second is the one a
  // trader needs told.
  if (rising) {
    if (selling) {
      return hot
        ? 'Price is up on heavy volume while sell orders outnumber buys - looks like distribution into strength.'
        : 'Price is up while sell orders outnumber buys - someone is selling into the move.';
    }
    if (hot && buying && holdersUp) {
      return 'Advance is backed by expanding volume, buy-side flow and new holders - participation is broadening.';
    }
    if (hot) return 'Advance is backed by rising volume rather than a thin move.';
    if (cooling) return 'Price is up but volume is fading - the move is thinning, not broadening.';
    return 'Price is up on roughly average volume.';
  }

  if (falling) {
    if (hot) return 'Decline is happening on heavy volume - active distribution, not drift.';
    if (cooling) return 'Decline on light volume - fading interest rather than an exit rush.';
    return 'Price is down on roughly average volume.';
  }

  if (hot) return 'Price is flat but volume is elevated - accumulation or churn, direction unresolved.';
  if (cooling) return 'Quiet: little price movement and below-average volume.';
  return 'Flat price on average volume - no clear momentum either way.';
}
