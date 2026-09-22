/**
 * Display formatting.
 *
 * RULE: a missing value renders as "Unknown" / "--", never as 0. The product is
 * useless if the user cannot tell "$0 liquidity" from "we could not fetch it".
 */

export const UNKNOWN = 'Unknown';
export const DASH = '--';

export function isMissing(v) {
  return v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
}

export function formatUsd(value, { placeholder = UNKNOWN } = {}) {
  if (isMissing(value)) return placeholder;
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  if (abs === 0) return '$0';
  // Sub-dollar prices: keep 4 significant digits so $0.000001234 stays readable.
  return `$${n.toPrecision(4).replace(/e-(\d+)/, 'e-$1')}`;
}

export function formatNumber(value, { placeholder = UNKNOWN } = {}) {
  if (isMissing(value)) return placeholder;
  const n = Number(value);
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatPercent(value, { placeholder = UNKNOWN, signed = false, digits = 1 } = {}) {
  if (isMissing(value)) return placeholder;
  const n = Number(value);
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

export function formatRatio(value, { placeholder = UNKNOWN, digits = 2 } = {}) {
  if (isMissing(value)) return placeholder;
  return `${Number(value).toFixed(digits)}x`;
}

/** Token age from a creation timestamp (ms epoch) to `now`. */
export function formatAge(createdAtMs, now = Date.now(), { placeholder = UNKNOWN } = {}) {
  if (isMissing(createdAtMs)) return placeholder;
  let ms = now - Number(createdAtMs);
  if (ms < 0) ms = 0;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days < 30) return remHours ? `${days}d ${remHours}h` : `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export function ageInMinutes(createdAtMs, now = Date.now()) {
  if (isMissing(createdAtMs)) return null;
  return Math.max(0, (now - Number(createdAtMs)) / 60000);
}

export function shortenAddress(address, lead = 4, tail = 4) {
  if (typeof address !== 'string' || address.length <= lead + tail + 3) return address || DASH;
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

export function formatRelativeTime(tsMs, now = Date.now()) {
  if (isMissing(tsMs)) return UNKNOWN;
  const secs = Math.round((now - tsMs) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
