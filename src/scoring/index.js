/**
 * Public entry point for the scoring engine.
 *
 * analyze() is a PURE function: snapshot + settings + clock in, analysis out.
 * No network, no storage, no DOM. That is what makes it testable and what lets
 * the UI re-render partial results as each data stage lands.
 */

import { computeMomentum } from './momentumScore.js';
import { computeOpportunity } from './opportunityScore.js';
import { computeRisk, riskBand, opportunityBand } from './riskScore.js';
import { buildKeySignals, buildAlerts, buildWhy, buildConcerns, profileBreaches } from './signals.js';
import { DEFAULT_SETTINGS } from './config.js';
import { dataCompleteness } from '../core/model.js';

export function analyze(snapshot, options = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(options.settings || {}) };
  const now = options.now ?? Date.now();

  const momentum = computeMomentum(snapshot, { weights: options.momentumWeights });
  const opportunity = computeOpportunity(snapshot, {
    weights: settings.opportunityWeights,
    minCoverage: settings.minCoverage,
    momentum,
    now,
  });
  const risk = computeRisk(snapshot, { weights: settings.riskWeights, now });

  const alerts = buildAlerts(snapshot, opportunity, risk, settings, now);

  return {
    generatedAt: now,
    identity: snapshot.identity,
    opportunity,
    risk,
    momentum,
    bands: {
      opportunity: opportunityBand(opportunity.score),
      risk: riskBand(risk.score),
    },
    keySignals: buildKeySignals(snapshot, opportunity, risk, now),
    alerts,
    topAlerts: alerts.slice(0, settings.maxSignalsShown ?? 5),
    why: buildWhy(opportunity),
    concerns: buildConcerns(opportunity, risk),
    profileBreaches: profileBreaches(snapshot, settings, now),
    completeness: dataCompleteness(snapshot),
    isMockData: Boolean(snapshot.meta && snapshot.meta.isMockData),
    partial: Boolean(snapshot.meta && snapshot.meta.partial),
  };
}

export { computeMomentum, computeOpportunity, computeRisk, riskBand, opportunityBand };
