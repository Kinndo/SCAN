import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSnapshot, F, NOW } from './helpers.js';
import { emptySnapshot, field } from '../src/core/model.js';
import { computeMomentum, volumePace, buyRatio } from '../src/scoring/momentumScore.js';
import { computeOpportunity, compose } from '../src/scoring/opportunityScore.js';
import { computeRisk, riskBand, opportunityBand } from '../src/scoring/riskScore.js';
import { analyze } from '../src/scoring/index.js';
import { DEFAULT_SETTINGS } from '../src/scoring/config.js';

// --- momentum ---------------------------------------------------------------

test('volume pace compares the current hour against the 24h average', () => {
  const s = makeSnapshot();            // h1 = 30000, h24 = 190000 -> 190000/24 = 7916
  const { pace, basis } = volumePace(s);
  assert.ok(pace > 3.7 && pace < 3.9, `unexpected pace ${pace}`);
  assert.equal(basis, '1h vs 24h average');
});

test('volume pace falls back to the 5m window when 24h data is missing', () => {
  const s = makeSnapshot();
  s.market.volume.h24 = null;
  const { basis } = volumePace(s);
  assert.equal(basis, '5m vs 1h average');
});

test('buy ratio needs both sides of the book', () => {
  const s = makeSnapshot();
  assert.equal(buyRatio(s, 'h1'), 0.6);
  s.market.txns.h1 = F({ buys: 0, sells: 0 });
  assert.equal(buyRatio(s, 'h1'), null, 'zero trades is not a 50/50 book');
});

test('price up on rising volume reads differently from price up on fading volume', () => {
  const rising = makeSnapshot();
  const fading = makeSnapshot();
  fading.market.volume.h1 = F(2000);   // well below the 24h average pace

  const a = computeMomentum(rising);
  const b = computeMomentum(fading);

  assert.match(a.interpretation, /backed by|broadening/i);
  assert.match(b.interpretation, /thinning|fading/i);
  assert.ok(a.score > b.score, 'the participation-backed advance should score higher');
});

test('price up while sellers dominate is called out as distribution', () => {
  const s = makeSnapshot();
  s.market.txns.h1 = F({ buys: 60, sells: 140 });
  s.market.txns.m5 = F({ buys: 4, sells: 16 });
  const m = computeMomentum(s);
  assert.match(m.interpretation, /distributing|sell/i);
});

test('momentum degrades gracefully and reports what it lacked', () => {
  const s = emptySnapshot({ chain: 'solana', address: 'A' });
  const m = computeMomentum(s);
  assert.equal(m.score, null);
  assert.equal(m.available, false);
  assert.ok(m.missing.includes('price change'));
  assert.ok(m.missing.includes('volume acceleration'));
});

// --- opportunity ------------------------------------------------------------

test('every opportunity component is explainable', () => {
  const o = computeOpportunity(makeSnapshot());
  assert.ok(Number.isFinite(o.score));
  assertExplainable(o);
});

/**
 * The regression this guards: momentum could score off volume alone while
 * producing an empty reasons array, leaving an unexplainable number on screen.
 * Any component that emits a score must say why, under ANY data shape.
 */
test('components stay explainable when data is partial', () => {
  const shapes = [
    { holders: { count: null, countChange1h: null, top10Pct: null, top20Pct: null, largestPct: null, largestNonLpPct: null } },
    { market: { priceChange: { m5: null, h1: null, h6: null, h24: null } } },
    { market: { txns: { m5: null, h1: null, h6: null, h24: null } } },
    { social: { hasWebsite: null, hasTwitter: null, hasTelegram: null } },
  ];
  for (const shape of shapes) {
    const s = makeSnapshot();
    for (const [group, values] of Object.entries(shape)) Object.assign(s[group], values);
    assertExplainable(computeOpportunity(s), JSON.stringify(Object.keys(shape)));
  }
});

function assertExplainable(o, context = '') {
  for (const c of o.components) {
    assert.ok(c.label, 'component needs a label');
    if (c.available) {
      assert.ok(c.reasons.length > 0, `${c.key} scored ${c.score} but gave no reason ${context}`);
      assert.ok(c.reasons.every((r) => typeof r === 'string' && r.length > 0), `${c.key} has an empty reason ${context}`);
    } else {
      assert.ok(c.missing.length > 0, `${c.key} is unavailable but did not say what is missing ${context}`);
    }
  }
}

test('weights of missing components are redistributed, not counted as zero', () => {
  const full = computeOpportunity(makeSnapshot());
  const partial = makeSnapshot();
  partial.social.hasWebsite = null;
  partial.social.hasTwitter = null;
  partial.social.hasTelegram = null;
  const reduced = computeOpportunity(partial);

  assert.ok(reduced.coverage < full.coverage);
  const social = reduced.components.find((c) => c.key === 'socialPresence');
  assert.equal(social.available, false);
  assert.equal(social.effectiveWeight, 0);
  const sumEffective = reduced.components.reduce((n, c) => n + c.effectiveWeight, 0);
  assert.ok(Math.abs(sumEffective - 100) < 1.5, `effective weights should still total 100, got ${sumEffective}`);
});

test('too little data yields "Insufficient data" rather than a number', () => {
  const s = emptySnapshot({ chain: 'solana', address: 'A' });
  s.market.priceUsd = field(1, 'x');
  const o = computeOpportunity(s);
  assert.equal(o.score, null);
  assert.equal(o.insufficientData, true);
  assert.match(o.summary, /Insufficient data/);
});

test('compose normalises over available weight only', () => {
  const r = compose('t', 'T', [
    { key: 'a', label: 'A', weight: 50, score: 80, available: true },
    { key: 'b', label: 'B', weight: 50, score: 40, available: true },
    { key: 'c', label: 'C', weight: 100, score: null, available: false },
  ], 0.4);
  assert.equal(r.score, 60, 'should average the two available components');
  assert.equal(r.coverage, 0.5);
  assert.deepEqual(r.missing, ['C']);
});

test('custom weights change the result', () => {
  const s = makeSnapshot();
  const base = computeOpportunity(s);
  const liquidityHeavy = computeOpportunity(s, {
    weights: { ...DEFAULT_SETTINGS.opportunityWeights, liquidity: 200 },
  });
  assert.notEqual(base.score, liquidityHeavy.score);
});

// --- risk -------------------------------------------------------------------

test('a clean, mature token scores lower risk than a fresh concentrated one', () => {
  const clean = makeSnapshot();
  clean.market.createdAt = F(NOW - 40 * 24 * 3600 * 1000);
  const risky = makeSnapshot();
  risky.market.createdAt = F(NOW - 8 * 60000);
  risky.market.liquidityUsd = F(9000);
  risky.holders.top10Pct = F(68);
  risky.holders.largestNonLpPct = F(31);
  risky.contract.mintAuthorityActive = F(true);
  risky.contract.freezeAuthorityActive = F(true);
  risky.contract.lpBurnedOrLockedPct = F(0);
  risky.dev.deployerSoldPct = F(8);

  const a = computeRisk(clean, { now: NOW });
  const b = computeRisk(risky, { now: NOW });
  assert.ok(b.score > a.score + 30, `expected a wide gap, got ${a.score} vs ${b.score}`);
  assert.equal(riskBand(b.score).level, 'bad');
});

test('unverifiable checks are reported, never scored as safe', () => {
  const s = makeSnapshot();
  s.contract.mintAuthorityActive = null;
  s.contract.freezeAuthorityActive = null;
  s.contract.honeypot = null;
  s.contract.buyTaxPct = null;
  s.contract.sellTaxPct = null;

  const r = computeRisk(s, { now: NOW });
  const keys = r.unverified.map((u) => u.key);
  assert.ok(keys.includes('mintAuthority'));
  assert.ok(keys.includes('freezeAuthority'));
  assert.ok(keys.includes('honeypotOrTax'));
  assert.ok(r.unverified.every((u) => /Unable to verify/.test(u.message)));
  assert.ok(!r.factors.some((f) => f.key === 'mintAuthority'), 'must not appear as an evaluated factor');
  assert.ok(r.coverage < 1);
});

test('removing a risk weight disables that check entirely', () => {
  const s = makeSnapshot();
  s.contract.mintAuthorityActive = F(true);
  const withCheck = computeRisk(s, { now: NOW });
  const without = computeRisk(s, { now: NOW, weights: { ...DEFAULT_SETTINGS.riskWeights, mintAuthority: 0 } });
  assert.ok(withCheck.factors.some((f) => f.key === 'mintAuthority'));
  assert.ok(!without.factors.some((f) => f.key === 'mintAuthority'));
  assert.ok(without.score < withCheck.score);
});

test('risk reports insufficient data when almost nothing can be checked', () => {
  const s = emptySnapshot({ chain: 'solana', address: 'A' });
  const r = computeRisk(s, { now: NOW });
  assert.equal(r.score, null);
  assert.equal(r.insufficientData, true);
});

test('every evaluated risk factor carries a message and evidence', () => {
  const r = computeRisk(makeSnapshot(), { now: NOW });
  for (const f of r.factors) {
    assert.ok(f.message, `${f.key} has no message`);
    assert.ok(f.points <= f.maxPoints);
    assert.ok(f.severity >= 0 && f.severity <= 1);
  }
});

// --- analyze ----------------------------------------------------------------

test('analyze returns a complete, self-describing dashboard payload', () => {
  const a = analyze(makeSnapshot(), { now: NOW });
  assert.equal(a.keySignals.length, 7);
  assert.ok(a.keySignals.every((s) => ['good', 'warn', 'bad', 'unknown'].includes(s.level)));
  assert.ok(a.alerts.length > 0);
  assert.ok(a.topAlerts.length <= 5);
  assert.ok(a.why.length > 0);
  assert.equal(a.bands.opportunity.level, opportunityBand(a.opportunity.score).level);
  assert.ok(a.completeness > 0.8);
});

test('alerts are ranked with the most important first', () => {
  const s = makeSnapshot();
  s.market.liquidityUsd = F(8000);
  s.holders.top10Pct = F(72);
  const a = analyze(s, { now: NOW });
  const importances = a.alerts.map((x) => x.importance);
  assert.deepEqual(importances, [...importances].sort((x, y) => y - x));
  assert.equal(a.topAlerts[0].level, 'bad');
});

test('user thresholds surface as their own signals without moving the scores', () => {
  const s = makeSnapshot();
  const lenient = analyze(s, { now: NOW, settings: { minLiquidityUsd: 1000 } });
  const strict = analyze(s, { now: NOW, settings: { minLiquidityUsd: 500000 } });
  assert.equal(lenient.profileBreaches.length, 0);
  assert.ok(strict.profileBreaches.some((b) => /below your/.test(b.text)));
  assert.equal(lenient.opportunity.score, strict.opportunity.score, 'thresholds must not silently rescore');
});

test('a data-poor token produces an honest, mostly-unknown dashboard', () => {
  const s = emptySnapshot({ chain: 'solana', address: 'A' });
  s.market.marketCapUsd = field(50000, 'x');
  const a = analyze(s, { now: NOW });
  assert.equal(a.opportunity.insufficientData, true);
  assert.equal(a.risk.insufficientData, true);
  assert.ok(a.keySignals.filter((k) => k.level === 'unknown').length >= 5);
  assert.ok(a.keySignals.some((k) => k.text === 'Insufficient data'));
});

test('a chip scored from one surviving input says so', () => {
  const s = makeSnapshot();
  s.market.priceChange = { m5: null, h1: null, h6: null, h24: null };
  s.market.txns = { m5: null, h1: null, h6: null, h24: null };
  s.holders.countChange1h = null;
  const a = analyze(s, { now: NOW });
  const chip = a.keySignals.find((k) => k.label === 'Momentum');
  assert.match(chip.text, /partial data/);

  const full = analyze(makeSnapshot(), { now: NOW }).keySignals.find((k) => k.label === 'Momentum');
  assert.doesNotMatch(full.text, /partial data/);
});

/**
 * Seen live with DexScreener alone: coverage 0.34 against a 0.35 threshold
 * refused a risk score by rounding luck. The refusal is now a rule: market
 * figures alone (liquidity, age, volume, sell pressure) never produce one.
 */
test('risk refuses to score from market figures alone', () => {
  const s = makeSnapshot();
  for (const k of Object.keys(s.holders)) s.holders[k] = null;
  for (const k of Object.keys(s.contract)) s.contract[k] = null;
  for (const k of Object.keys(s.dev)) s.dev[k] = null;
  const r = computeRisk(s, { now: NOW, minCoverage: 0 });
  assert.equal(r.insufficientData, true);
  assert.match(r.summary, /no holder or contract checks/);
  assert.ok(r.factors.some((f) => f.key === 'tokenAge'), 'the market factors are still listed for the breakdown');
});

test('one structural check is enough for a score to be emitted', () => {
  const s = makeSnapshot();
  for (const k of Object.keys(s.holders)) s.holders[k] = null;
  for (const k of Object.keys(s.dev)) s.dev[k] = null;
  s.contract.lpBurnedOrLockedPct = null;
  s.contract.honeypot = null; s.contract.buyTaxPct = null; s.contract.sellTaxPct = null;
  // Only mint/freeze authority remain.
  const r = computeRisk(s, { now: NOW, minCoverage: 0 });
  assert.equal(r.insufficientData, false);
  assert.ok(Number.isFinite(r.score));
});
