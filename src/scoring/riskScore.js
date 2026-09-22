/**
 * Risk Score - computed independently of Opportunity.
 *
 * Higher = more risk indicators present. Each factor contributes penalty points
 * scaled by how severely it is triggered. Factors we cannot evaluate are NOT
 * counted as safe: they are reported as "Unable to verify" and they lower the
 * confidence figure instead.
 *
 * Language policy: this module never calls a token a scam or a rug. It reports
 * what is measurable - "concentration detected", "unable to verify",
 * "high risk indicator" - and lets the user judge.
 */

import { pick } from '../core/model.js';
import { DEFAULT_RISK_WEIGHTS } from './config.js';
import { severityFrom, severityBelow, safeRatio, round } from './curves.js';
import { ageInMinutes } from '../utils/formatting.js';

/** Each factor returns {severity: 0..1, message, evidence} or null if unknown. */
export const RISK_FACTORS = [
  {
    key: 'lowLiquidityAbsolute',
    label: 'Liquidity depth',
    evaluate: (s) => {
      const liq = pick(s, 'market.liquidityUsd');
      const hit = severityBelow(liq, [
        { below: 10000, severity: 1.0, label: 'Liquidity is under $10K - even small exits move the price sharply' },
        { below: 25000, severity: 0.75, label: 'Liquidity is under $25K - shallow' },
        { below: 50000, severity: 0.45, label: 'Liquidity is under $50K' },
        { below: 100000, severity: 0.2, label: 'Liquidity is under $100K' },
      ]);
      if (!hit) return null;
      return {
        severity: hit.severity,
        message: hit.label || 'Liquidity depth is adequate for this size',
        evidence: `$${Math.round(liq).toLocaleString('en-US')} in the pool`,
      };
    },
  },
  {
    key: 'liquidityToMarketCap',
    label: 'Liquidity vs market cap',
    evaluate: (s) => {
      const ratio = safeRatio(pick(s, 'market.liquidityUsd'), pick(s, 'market.marketCapUsd'));
      if (!Number.isFinite(ratio)) return null;
      const hit = severityBelow(ratio, [
        { below: 0.02, severity: 1.0, label: 'Liquidity is under 2% of market cap - the price is very easy to move' },
        { below: 0.05, severity: 0.6, label: 'Liquidity is under 5% of market cap' },
        { below: 0.1, severity: 0.3, label: 'Liquidity is under 10% of market cap' },
      ]);
      return {
        severity: hit.severity,
        message: hit.label || 'Liquidity is well proportioned to market cap',
        evidence: `${round(ratio * 100, 1)}% ratio`,
      };
    },
  },
  {
    key: 'holderConcentration',
    label: 'Holder concentration',
    evaluate: (s) => {
      const top10 = pick(s, 'holders.top10Pct');
      const hit = severityFrom(top10, [
        { atLeast: 60, severity: 1.0, label: 'Concentration detected: top 10 wallets hold over 60% of supply' },
        { atLeast: 45, severity: 0.75, label: 'Concentration detected: top 10 wallets hold over 45% of supply' },
        { atLeast: 30, severity: 0.45, label: 'Top 10 wallets hold over 30% of supply' },
        { atLeast: 20, severity: 0.2, label: 'Top 10 wallets hold over 20% of supply' },
      ]);
      if (!hit) return null;
      return {
        severity: hit.severity,
        message: hit.label || 'Supply is reasonably distributed across holders',
        evidence: `Top 10 = ${round(top10, 1)}%`,
      };
    },
  },
  {
    key: 'singleWhale',
    label: 'Largest non-LP holder',
    evaluate: (s) => {
      const largest = pick(s, 'holders.largestNonLpPct') ?? pick(s, 'holders.largestPct');
      const hit = severityFrom(largest, [
        { atLeast: 25, severity: 1.0, label: 'A single non-pool wallet holds over 25% of supply' },
        { atLeast: 15, severity: 0.7, label: 'A single non-pool wallet holds over 15% of supply' },
        { atLeast: 8, severity: 0.4, label: 'A single non-pool wallet holds over 8% of supply' },
        { atLeast: 4, severity: 0.15, label: 'Largest non-pool wallet holds over 4% of supply' },
      ]);
      if (!hit) return null;
      return {
        severity: hit.severity,
        message: hit.label || 'No single wallet holds an outsized share',
        evidence: `Largest holder = ${round(largest, 1)}%`,
      };
    },
  },
  {
    key: 'devHoldings',
    label: 'Deployer holdings',
    evaluate: (s) => {
      const pct = pick(s, 'dev.deployerHoldingPct');
      const hit = severityFrom(pct, [
        { atLeast: 15, severity: 1.0, label: 'Deployer wallet still holds over 15% of supply' },
        { atLeast: 8, severity: 0.65, label: 'Deployer wallet still holds over 8% of supply' },
        { atLeast: 3, severity: 0.3, label: 'Deployer wallet holds over 3% of supply' },
      ]);
      if (!hit) return null;
      return {
        severity: hit.severity,
        message: hit.label || 'Deployer holds a small share of supply',
        evidence: `Deployer = ${round(pct, 2)}%`,
      };
    },
  },
  {
    key: 'devSelling',
    label: 'Deployer selling',
    evaluate: (s) => {
      const sold = pick(s, 'dev.deployerSoldPct');
      const hit = severityFrom(sold, [
        { atLeast: 5, severity: 1.0, label: 'High risk indicator: deployer has sold over 5% of supply' },
        { atLeast: 2, severity: 0.7, label: 'Deployer has sold over 2% of supply' },
        { atLeast: 0.5, severity: 0.35, label: 'Some deployer selling detected' },
      ]);
      if (!hit) return null;
      return {
        severity: hit.severity,
        message: hit.label || 'No significant deployer selling detected',
        evidence: `${round(sold, 2)}% of supply sold by deployer`,
      };
    },
  },
  {
    key: 'tokenAge',
    label: 'Token age',
    evaluate: (s, ctx) => {
      const mins = ageInMinutes(pick(s, 'market.createdAt'), ctx.now);
      const hit = severityBelow(mins, [
        { below: 15, severity: 1.0, label: 'Launched less than 15 minutes ago - almost no track record' },
        { below: 60, severity: 0.8, label: 'Launched less than an hour ago' },
        { below: 360, severity: 0.55, label: 'Launched less than 6 hours ago' },
        { below: 1440, severity: 0.35, label: 'Launched less than 24 hours ago' },
        { below: 10080, severity: 0.15, label: 'Less than a week old' },
      ]);
      if (!hit) return null;
      return {
        severity: hit.severity,
        message: hit.label || 'Token has been trading for over a week',
        evidence: `${Math.round(mins)} minutes old`,
      };
    },
  },
  {
    key: 'mintAuthority',
    label: 'Mint authority',
    evaluate: (s) => {
      const active = pick(s, 'contract.mintAuthorityActive');
      if (active === null) return null;
      return {
        severity: active ? 1.0 : 0,
        message: active
          ? 'High risk indicator: mint authority is still active - more supply can be created'
          : 'Mint authority is revoked - supply cannot be inflated',
        evidence: active ? 'mintAuthority present' : 'mintAuthority revoked',
      };
    },
  },
  {
    key: 'freezeAuthority',
    label: 'Freeze authority',
    evaluate: (s) => {
      const active = pick(s, 'contract.freezeAuthorityActive');
      if (active === null) return null;
      return {
        severity: active ? 1.0 : 0,
        message: active
          ? 'High risk indicator: freeze authority is active - holder accounts can be frozen'
          : 'Freeze authority is revoked',
        evidence: active ? 'freezeAuthority present' : 'freezeAuthority revoked',
      };
    },
  },
  {
    key: 'lpNotSecured',
    label: 'Liquidity lock status',
    evaluate: (s) => {
      const pct = pick(s, 'contract.lpBurnedOrLockedPct');
      if (!Number.isFinite(pct)) return null;
      const hit = severityBelow(pct, [
        { below: 10, severity: 1.0, label: 'Under 10% of LP is burned or locked - liquidity can be withdrawn' },
        { below: 50, severity: 0.6, label: 'Under half of LP is burned or locked' },
        { below: 90, severity: 0.25, label: 'Some LP remains unlocked' },
      ]);
      return {
        severity: hit.severity,
        message: hit.label || 'Liquidity appears locked or burned',
        evidence: `${round(pct, 1)}% of LP burned/locked`,
      };
    },
  },
  {
    key: 'honeypotOrTax',
    label: 'Trading restrictions',
    evaluate: (s) => {
      const honeypot = pick(s, 'contract.honeypot');
      const sellTax = pick(s, 'contract.sellTaxPct');
      const buyTax = pick(s, 'contract.buyTaxPct');
      if (honeypot === null && sellTax === null && buyTax === null) return null;
      if (honeypot === true) {
        return { severity: 1.0, message: 'High risk indicator: simulated sells failed - possible honeypot', evidence: 'honeypot check failed' };
      }
      const worstTax = Math.max(Number.isFinite(sellTax) ? sellTax : 0, Number.isFinite(buyTax) ? buyTax : 0);
      const hit = severityFrom(worstTax, [
        { atLeast: 20, severity: 0.95, label: 'Trading tax above 20%' },
        { atLeast: 10, severity: 0.7, label: 'Trading tax above 10%' },
        { atLeast: 5, severity: 0.35, label: 'Trading tax above 5%' },
      ]);
      return {
        severity: hit ? hit.severity : 0,
        message: (hit && hit.label) || 'No honeypot indicators and no significant trading tax detected',
        evidence: Number.isFinite(worstTax) ? `max tax ${round(worstTax, 1)}%` : 'no tax reported',
      };
    },
  },
  {
    key: 'abnormalVolume',
    label: 'Volume plausibility',
    evaluate: (s) => {
      const ratio = safeRatio(pick(s, 'market.volume.h24'), pick(s, 'market.marketCapUsd'));
      if (!Number.isFinite(ratio)) return null;
      const hit = severityFrom(ratio, [
        { atLeast: 20, severity: 1.0, label: 'Unusual activity detected: 24h volume exceeds 20x market cap' },
        { atLeast: 8, severity: 0.6, label: 'Unusual activity detected: 24h volume exceeds 8x market cap' },
        { atLeast: 4, severity: 0.25, label: '24h volume is more than 4x market cap' },
      ]);
      return {
        severity: hit.severity,
        message: hit.label || 'Volume is plausible relative to market cap',
        evidence: `volume/mcap = ${round(ratio, 2)}x`,
      };
    },
  },
  {
    key: 'sellPressure',
    label: 'Sell pressure',
    evaluate: (s) => {
      const txns = pick(s, 'market.txns.h1');
      if (!txns || !Number.isFinite(txns.buys) || !Number.isFinite(txns.sells)) return null;
      const total = txns.buys + txns.sells;
      if (total <= 0) return null;
      const sellShare = txns.sells / total;
      const hit = severityFrom(sellShare, [
        { atLeast: 0.75, severity: 1.0, label: 'Over 75% of recent trades are sells' },
        { atLeast: 0.62, severity: 0.6, label: 'Over 62% of recent trades are sells' },
        { atLeast: 0.55, severity: 0.3, label: 'Sells modestly outnumber buys' },
      ]);
      return {
        severity: hit.severity,
        message: hit.label || 'Order flow is not dominated by sellers',
        evidence: `${round(sellShare * 100, 0)}% sells over 1h`,
      };
    },
  },
];

export function computeRisk(snapshot, options = {}) {
  const weights = { ...DEFAULT_RISK_WEIGHTS, ...(options.weights || {}) };
  const ctx = { now: options.now ?? Date.now() };

  const evaluated = [];
  const unverified = [];

  for (const factor of RISK_FACTORS) {
    const weight = weights[factor.key] ?? 0;
    if (weight <= 0) continue;
    let result = null;
    try {
      result = factor.evaluate(snapshot, ctx);
    } catch {
      result = null;
    }
    if (!result || !Number.isFinite(result.severity)) {
      unverified.push({ key: factor.key, label: factor.label, message: 'Unable to verify - no data available' });
      continue;
    }
    evaluated.push({
      key: factor.key,
      label: factor.label,
      weight,
      severity: round(result.severity, 2),
      points: round(result.severity * weight, 2),
      maxPoints: weight,
      triggered: result.severity > 0,
      message: result.message,
      evidence: result.evidence ?? null,
    });
  }

  const pointsAvailable = evaluated.reduce((sum, f) => sum + f.maxPoints, 0);
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const coverage = totalWeight > 0 ? pointsAvailable / totalWeight : 0;
  const minCoverage = options.minCoverage ?? 0.35;

  if (pointsAvailable === 0 || coverage < minCoverage) {
    return {
      key: 'risk',
      label: 'Risk Score',
      score: null,
      insufficientData: true,
      coverage: round(coverage, 2),
      factors: evaluated.sort(bySeverity),
      unverified,
      summary: `Insufficient data - only ${Math.round(coverage * 100)}% of risk checks could be evaluated.`,
    };
  }

  const points = evaluated.reduce((sum, f) => sum + f.points, 0);
  return {
    key: 'risk',
    label: 'Risk Score',
    score: round((points / pointsAvailable) * 100, 0),
    insufficientData: false,
    coverage: round(coverage, 2),
    factors: evaluated.sort(bySeverity),
    unverified,
    summary: null,
  };
}

function bySeverity(a, b) {
  return b.points - a.points;
}

export function riskBand(score) {
  if (!Number.isFinite(score)) return { label: 'Unknown', level: 'unknown' };
  if (score >= 70) return { label: 'High', level: 'bad' };
  if (score >= 45) return { label: 'Elevated', level: 'warn' };
  if (score >= 25) return { label: 'Moderate', level: 'warn' };
  return { label: 'Lower', level: 'good' };
}

export function opportunityBand(score) {
  if (!Number.isFinite(score)) return { label: 'Unknown', level: 'unknown' };
  if (score >= 75) return { label: 'Strong', level: 'good' };
  if (score >= 55) return { label: 'Moderate', level: 'warn' };
  if (score >= 35) return { label: 'Weak', level: 'warn' };
  return { label: 'Poor', level: 'bad' };
}
