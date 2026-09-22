/**
 * Pure scoring primitives. Every scoring decision in the extension routes
 * through one of these so a number can always be traced back to a curve.
 */

export function clamp(n, lo = 0, hi = 100) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Linear map of `value` in [lo,hi] onto [0,100], clamped at both ends. */
export function linearScore(value, lo, hi) {
  if (!Number.isFinite(value)) return null;
  if (hi === lo) return 50;
  return clamp(((value - lo) / (hi - lo)) * 100);
}

/**
 * Log map - the right shape for quantities spanning orders of magnitude
 * (liquidity, market cap, transaction counts), where $20K -> $40K matters far
 * more than $2M -> $2.02M.
 */
export function logScore(value, lo, hi) {
  if (!Number.isFinite(value) || value <= 0) return value === 0 ? 0 : null;
  if (hi <= lo || lo <= 0) return null;
  const v = Math.log(Math.max(value, lo));
  return clamp(((v - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100);
}

/**
 * Piecewise bands: [{ upTo, score, label }] evaluated in order; the final band
 * should use upTo: Infinity. Returns {score, label}.
 */
export function bandScore(value, bands) {
  if (!Number.isFinite(value)) return null;
  for (const band of bands) {
    if (value <= band.upTo) return { score: band.score, label: band.label };
  }
  const last = bands[bands.length - 1];
  return { score: last.score, label: last.label };
}

/** Severity in [0,1] from descending thresholds: [{ atLeast, severity, label }]. */
export function severityFrom(value, thresholds) {
  if (!Number.isFinite(value)) return null;
  for (const t of thresholds) {
    if (value >= t.atLeast) return { severity: t.severity, label: t.label };
  }
  return { severity: 0, label: null };
}

/** Same, for metrics where SMALLER is worse (liquidity, age). */
export function severityBelow(value, thresholds) {
  if (!Number.isFinite(value)) return null;
  for (const t of thresholds) {
    if (value < t.below) return { severity: t.severity, label: t.label };
  }
  return { severity: 0, label: null };
}

/** Weighted mean over sub-parts that have a score; null if none do. */
export function weightedMean(parts) {
  let total = 0;
  let weight = 0;
  for (const p of parts) {
    if (p == null || !Number.isFinite(p.score) || !Number.isFinite(p.weight)) continue;
    total += p.score * p.weight;
    weight += p.weight;
  }
  if (weight === 0) return { score: null, coverage: 0 };
  return { score: total / weight, coverage: weight };
}

export function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

export function round(n, digits = 0) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
