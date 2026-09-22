/**
 * The normalised TokenSnapshot - the ONLY contract between the data layer and
 * everything above it (scoring, UI). Providers translate their own responses
 * into this shape; scoring and UI never see a provider's raw JSON.
 *
 * Every metric is either:
 *   null                                  -> genuinely unknown, render "Unknown"
 *   { value, source, confidence, asOf }   -> a measured/derived value
 *
 * There is no third state. A provider that cannot answer must return null; it
 * must never substitute 0, because "no liquidity" and "liquidity unknown" lead
 * to opposite trading decisions.
 */

import { CONFIDENCE } from './constants.js';

/** Wrap a value as a sourced metric. Returns null for missing input. */
export function field(value, source, confidence = CONFIDENCE.MEASURED, asOf = null) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return { value, source, confidence, asOf };
}

/** Read a metric's value, or null. Safe on undefined/missing paths. */
export function val(metric) {
  if (metric === null || metric === undefined) return null;
  return metric.value === undefined ? null : metric.value;
}

/** Read a metric's source label for provenance display. */
export function src(metric) {
  return metric && metric.source ? metric.source : null;
}

export function hasValue(metric) {
  return val(metric) !== null;
}

/** Nested read: pick(snapshot, 'market.volume.h24') -> value or null. */
export function pick(snapshot, path) {
  const parts = path.split('.');
  let node = snapshot;
  for (const part of parts) {
    if (node === null || node === undefined) return null;
    node = node[part];
  }
  return val(node);
}

export const STAGES = ['identity', 'market', 'holders', 'contract', 'dev', 'social'];

export function emptySnapshot(identity = {}) {
  return {
    identity: {
      chain: identity.chain ?? 'unknown',
      address: identity.address ?? null,
      addressKind: identity.addressKind ?? 'token', // token | pair | pool
      symbol: null,
      name: null,
      decimals: null,
      pairAddress: null,
      dexId: null,
      identitySource: null, // 'page' when the name/ticker was read off the page
    },
    market: {
      priceUsd: null,
      marketCapUsd: null,
      fdvUsd: null,
      liquidityUsd: null,
      createdAt: null, // ms epoch - token/pool age
      volume: { m5: null, h1: null, h6: null, h24: null },
      priceChange: { m5: null, h1: null, h6: null, h24: null },
      txns: { m5: null, h1: null, h6: null, h24: null }, // each: {buys, sells} metric
    },
    holders: {
      count: null,
      countChange1h: null,
      top10Pct: null,
      top20Pct: null,
      largestPct: null,
      largestNonLpPct: null,
      lpHeldPct: null,
    },
    contract: {
      mintAuthorityActive: null, // Solana / mintable on EVM
      freezeAuthorityActive: null,
      upgradeable: null,
      ownershipRenounced: null,
      lpBurnedOrLockedPct: null,
      honeypot: null,
      buyTaxPct: null,
      sellTaxPct: null,
      transferRestricted: null,
      blacklistCapable: null,
    },
    dev: {
      deployerAddress: null,
      deployerHoldingPct: null,
      deployerSoldPct: null,
      deployerFundingSource: null,
    },
    social: {
      hasWebsite: null,
      hasTwitter: null,
      hasTelegram: null,
      linkCount: null,
      boosted: null,
    },
    meta: {
      fetchedAt: null,
      sources: [],
      stagesComplete: [],
      stagesPending: [...STAGES],
      errors: [],
      isMockData: false,
      partial: true,
    },
  };
}

/** Deep-merge a stage's partial result into a snapshot, without clobbering
 *  already-populated fields with nulls. Returns a NEW snapshot object. */
export function mergeSnapshot(base, patch) {
  if (!patch) return base;
  const out = structuredCloneSafe(base);
  mergeInto(out, patch);
  return out;
}

function mergeInto(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) continue; // never overwrite with unknown
    const existing = target[key];
    if (isPlainObject(value) && !isMetric(value)) {
      if (!isPlainObject(existing)) target[key] = {};
      mergeInto(target[key], value);
    } else if (Array.isArray(value)) {
      target[key] = Array.isArray(existing) ? [...new Set([...existing, ...value])] : [...value];
    } else {
      target[key] = value;
    }
  }
}

function isMetric(v) {
  return isPlainObject(v) && Object.prototype.hasOwnProperty.call(v, 'value') &&
    Object.prototype.hasOwnProperty.call(v, 'source');
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function structuredCloneSafe(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

export function markStageComplete(snapshot, stage, sourceLabel) {
  const meta = snapshot.meta;
  if (!meta.stagesComplete.includes(stage)) meta.stagesComplete.push(stage);
  meta.stagesPending = meta.stagesPending.filter((s) => s !== stage);
  if (sourceLabel && !meta.sources.includes(sourceLabel)) meta.sources.push(sourceLabel);
  meta.partial = meta.stagesPending.length > 0;
  return snapshot;
}

export function recordError(snapshot, stage, message) {
  snapshot.meta.errors.push({ stage, message });
  snapshot.meta.stagesPending = snapshot.meta.stagesPending.filter((s) => s !== stage);
  snapshot.meta.partial = snapshot.meta.stagesPending.length > 0;
  return snapshot;
}

/** Fraction of top-level data groups that returned at least one value. */
export function dataCompleteness(snapshot) {
  const groups = ['market', 'holders', 'contract', 'dev', 'social'];
  let filled = 0;
  for (const g of groups) if (groupHasAnyValue(snapshot[g])) filled += 1;
  return filled / groups.length;
}

function groupHasAnyValue(group) {
  if (!group) return false;
  for (const v of Object.values(group)) {
    if (hasValue(v)) return true;
    if (isPlainObject(v) && !isMetric(v) && groupHasAnyValue(v)) return true;
  }
  return false;
}
