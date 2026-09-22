/**
 * Turns scores into the things a trader actually reads in the first 5 seconds:
 * a fixed row of dimension chips, a ranked alert list, a "why" list and a
 * "concerns" list.
 *
 * Ranking matters more than completeness here - thirty alerts is the same as no
 * alerts. The UI shows the top few and hides the rest behind an expander.
 */

import { SIGNAL_LEVEL } from '../core/constants.js';
import { pick } from '../core/model.js';
import { formatUsd, formatAge, ageInMinutes } from '../utils/formatting.js';
import { round } from './curves.js';

function levelFromScore(score, { good = 70, warn = 45 } = {}) {
  if (!Number.isFinite(score)) return SIGNAL_LEVEL.UNKNOWN;
  if (score >= good) return SIGNAL_LEVEL.GOOD;
  if (score >= warn) return SIGNAL_LEVEL.WARN;
  return SIGNAL_LEVEL.BAD;
}

function levelFromSeverity(severity) {
  if (!Number.isFinite(severity)) return SIGNAL_LEVEL.UNKNOWN;
  if (severity >= 0.6) return SIGNAL_LEVEL.BAD;
  // Anything that triggered at all is a warning, so the chip row and the alert
  // list can never disagree about the same factor.
  if (severity > 0) return SIGNAL_LEVEL.WARN;
  return SIGNAL_LEVEL.GOOD;
}

const componentBy = (opportunity, key) => opportunity.components.find((c) => c.key === key);
const factorBy = (risk, key) => risk.factors.find((f) => f.key === key);
const isUnverified = (risk, key) => risk.unverified.some((u) => u.key === key);

/** The fixed dimension row. Always the same seven rows, so the eye learns it. */
export function buildKeySignals(snapshot, opportunity, risk, now = Date.now()) {
  const momentum = componentBy(opportunity, 'momentum');
  const volume = componentBy(opportunity, 'volumeToMcap');
  const liquidity = componentBy(opportunity, 'liquidity');
  const concentration = factorBy(risk, 'holderConcentration');
  const whale = factorBy(risk, 'singleWhale');
  const age = factorBy(risk, 'tokenAge');

  const contractLevel = contractStatus(risk);

  return [
    row('Momentum', momentum ? levelFromScore(momentum.score) : SIGNAL_LEVEL.UNKNOWN,
      describeScore(momentum, ['Strong', 'Mixed', 'Weak'])),
    row('Volume', volume ? levelFromScore(volume.score) : SIGNAL_LEVEL.UNKNOWN,
      describeScore(volume, ['Strong', 'Moderate', 'Thin'])),
    row('Liquidity', liquidity ? levelFromScore(liquidity.score, { good: 65, warn: 40 }) : SIGNAL_LEVEL.UNKNOWN,
      liquidity && liquidity.available
        ? `${formatUsd(pick(snapshot, 'market.liquidityUsd'))} pooled`
        : 'Insufficient data'),
    row('Holders', concentration ? levelFromSeverity(concentration.severity) : SIGNAL_LEVEL.UNKNOWN,
      concentration ? `Top 10 hold ${round(pick(snapshot, 'holders.top10Pct'), 1)}%` : 'Insufficient data'),
    row('Whale Risk', whale ? levelFromSeverity(whale.severity) : SIGNAL_LEVEL.UNKNOWN,
      whale ? whale.evidence : 'Insufficient data'),
    row('Contract', contractLevel.level, contractLevel.text),
    row('Token Age', age ? levelFromSeverity(age.severity) : SIGNAL_LEVEL.UNKNOWN,
      pick(snapshot, 'market.createdAt') ? formatAge(pick(snapshot, 'market.createdAt'), now) + ' old' : 'Insufficient data'),
  ];
}

function row(label, level, text) {
  return { label, level, text: text || 'Insufficient data' };
}

function describeScore(component, [good, mid, bad]) {
  if (!component || !component.available) return 'Insufficient data';
  const word = component.score >= 70 ? good : component.score >= 45 ? mid : bad;
  // A composite scored from one surviving input should not read as confidently
  // as one scored from all of them.
  if (Number.isFinite(component.coverage) && component.coverage < 0.6) {
    return `${word} (partial data)`;
  }
  return word;
}

function contractStatus(risk) {
  const keys = ['mintAuthority', 'freezeAuthority', 'honeypotOrTax', 'lpNotSecured'];
  const evaluated = keys.map((k) => factorBy(risk, k)).filter(Boolean);
  if (evaluated.length === 0) return { level: SIGNAL_LEVEL.UNKNOWN, text: 'Unable to verify' };
  const worst = Math.max(...evaluated.map((f) => f.severity));
  const unverifiedCount = keys.filter((k) => isUnverified(risk, k)).length;
  if (worst >= 0.6) {
    const bad = evaluated.filter((f) => f.severity >= 0.6).map((f) => f.label.toLowerCase());
    return { level: SIGNAL_LEVEL.BAD, text: `Issue: ${bad.join(', ')}` };
  }
  if (worst >= 0.25) return { level: SIGNAL_LEVEL.WARN, text: 'Minor permission concerns' };
  if (unverifiedCount > 0) return { level: SIGNAL_LEVEL.WARN, text: `No issues found (${unverifiedCount} unverified)` };
  return { level: SIGNAL_LEVEL.GOOD, text: 'No obvious issues' };
}

/** Ranked alert list. Importance is on an arbitrary 0-100 scale, sort only. */
export function buildAlerts(snapshot, opportunity, risk, settings, now = Date.now()) {
  const alerts = [];

  // Triggered risk factors, weighted by how much they actually contribute.
  for (const factor of risk.factors) {
    if (!factor.triggered) {
      if (factor.severity === 0 && isReassuring(factor.key)) {
        alerts.push({
          level: SIGNAL_LEVEL.GOOD,
          icon: 'check',
          category: factor.label,
          text: factor.message,
          detail: factor.evidence,
          importance: 22,
        });
      }
      continue;
    }
    alerts.push({
      level: factor.severity >= 0.6 ? SIGNAL_LEVEL.BAD : SIGNAL_LEVEL.WARN,
      icon: factor.severity >= 0.6 ? 'alert' : 'warn',
      category: factor.label,
      text: factor.message,
      detail: factor.evidence,
      importance: 40 + factor.points * 2.2,
    });
  }

  // Standout strengths.
  for (const c of opportunity.components) {
    if (c.available && c.score >= 78) {
      alerts.push({
        level: SIGNAL_LEVEL.GOOD,
        icon: 'check',
        category: c.label,
        text: c.reasons[0] || `${c.label} scores ${c.score}/100`,
        detail: null,
        importance: 25 + (c.score - 78) * 0.4,
      });
    }
  }

  // Things we could not check are themselves information.
  const criticalUnverified = risk.unverified.filter((u) =>
    ['mintAuthority', 'freezeAuthority', 'honeypotOrTax', 'holderConcentration', 'devSelling', 'lpNotSecured'].includes(u.key));
  if (criticalUnverified.length) {
    alerts.push({
      level: SIGNAL_LEVEL.UNKNOWN,
      icon: 'question',
      category: 'Unverified checks',
      text: `${criticalUnverified.length} safety check${criticalUnverified.length > 1 ? 's' : ''} could not be verified: ${criticalUnverified.map((u) => u.label.toLowerCase()).join(', ')}.`,
      detail: 'Missing data is not the same as a clean result.',
      importance: 38,
    });
  }

  // Profile fit - the user's own thresholds.
  for (const breach of profileBreaches(snapshot, settings, now)) {
    alerts.push({ ...breach, importance: 34 });
  }

  return alerts.sort((a, b) => b.importance - a.importance);
}

function isReassuring(key) {
  return ['mintAuthority', 'freezeAuthority', 'honeypotOrTax', 'lpNotSecured', 'devSelling'].includes(key);
}

/** Compare the snapshot against the user's configured thresholds. */
export function profileBreaches(snapshot, settings, now = Date.now()) {
  const out = [];
  if (!settings) return out;
  const liq = pick(snapshot, 'market.liquidityUsd');
  const mcap = pick(snapshot, 'market.marketCapUsd');
  const top10 = pick(snapshot, 'holders.top10Pct');
  const mins = ageInMinutes(pick(snapshot, 'market.createdAt'), now);

  if (Number.isFinite(liq) && Number.isFinite(settings.minLiquidityUsd) && liq < settings.minLiquidityUsd) {
    out.push({ level: SIGNAL_LEVEL.WARN, icon: 'warn', category: 'Your filter', text: `Liquidity ${formatUsd(liq)} is below your ${formatUsd(settings.minLiquidityUsd)} minimum.`, detail: null });
  }
  if (Number.isFinite(mcap) && Number.isFinite(settings.minMarketCapUsd) && mcap < settings.minMarketCapUsd) {
    out.push({ level: SIGNAL_LEVEL.WARN, icon: 'warn', category: 'Your filter', text: `Market cap ${formatUsd(mcap)} is below your ${formatUsd(settings.minMarketCapUsd)} minimum.`, detail: null });
  }
  if (Number.isFinite(mcap) && Number.isFinite(settings.maxMarketCapUsd) && mcap > settings.maxMarketCapUsd) {
    out.push({ level: SIGNAL_LEVEL.WARN, icon: 'warn', category: 'Your filter', text: `Market cap ${formatUsd(mcap)} is above your ${formatUsd(settings.maxMarketCapUsd)} maximum.`, detail: null });
  }
  if (Number.isFinite(top10) && Number.isFinite(settings.maxTop10ConcentrationPct) && top10 > settings.maxTop10ConcentrationPct) {
    out.push({ level: SIGNAL_LEVEL.WARN, icon: 'warn', category: 'Your filter', text: `Top-10 concentration ${round(top10, 1)}% exceeds your ${settings.maxTop10ConcentrationPct}% limit.`, detail: null });
  }
  if (Number.isFinite(mins) && Number.isFinite(settings.minTokenAgeMinutes) && mins < settings.minTokenAgeMinutes) {
    out.push({ level: SIGNAL_LEVEL.WARN, icon: 'warn', category: 'Your filter', text: `Token is ${Math.round(mins)}m old, under your ${settings.minTokenAgeMinutes}m minimum.`, detail: null });
  }
  return out;
}

/** The "WHY?" block - the strongest supporting observations. */
export function buildWhy(opportunity, limit = 4) {
  return opportunity.components
    .filter((c) => c.available && c.score >= 60)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .flatMap((c) => (c.reasons.length ? [c.reasons[0]] : []))
    .slice(0, limit);
}

/** The "CONCERNS" block - the strongest negative observations. */
export function buildConcerns(opportunity, risk, limit = 4) {
  const fromRisk = risk.factors.filter((f) => f.triggered).slice(0, limit).map((f) => f.message);
  // A raw reason string ("85 trades in the last hour") does not read as a
  // concern on its own - name the dimension and its score so the line explains
  // why it is listed here.
  const weakComponents = opportunity.components
    .filter((c) => c.available && c.score < 40)
    .map((c) => (c.reasons[0]
      ? `${c.label} is weak (${c.score}/100): ${lowerFirst(c.reasons[0])}`
      : `${c.label} is weak (${c.score}/100).`));
  return [...fromRisk, ...weakComponents].slice(0, limit);
}

function lowerFirst(text) {
  if (!text) return text;
  // Leave acronyms and figures alone - only downcase an ordinary capitalised word.
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}
