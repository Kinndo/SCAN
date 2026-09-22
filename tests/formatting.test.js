import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, formatPercent, formatAge, formatNumber, shortenAddress, ageInMinutes, isMissing } from '../src/utils/formatting.js';

test('missing values never render as zero', () => {
  assert.equal(formatUsd(null), 'Unknown');
  assert.equal(formatUsd(undefined), 'Unknown');
  assert.equal(formatUsd(NaN), 'Unknown');
  assert.equal(formatPercent(null), 'Unknown');
  assert.equal(formatNumber(null), 'Unknown');
  // A real zero is still a real zero and must be distinguishable.
  assert.equal(formatUsd(0), '$0');
});

test('usd scales by magnitude', () => {
  assert.equal(formatUsd(1_250_000_000), '$1.25B');
  assert.equal(formatUsd(4_200_000), '$4.20M');
  assert.equal(formatUsd(84_000), '$84.0K');
  assert.equal(formatUsd(12.5), '$12.50');
  assert.match(formatUsd(0.000123), /^\$0\.0001230?/);
});

test('percent signing', () => {
  assert.equal(formatPercent(12.34, { signed: true }), '+12.3%');
  assert.equal(formatPercent(-4, { signed: true }), '-4.0%');
});

test('age formatting and minutes', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatAge(now - 11 * 60000, now), '11m');
  assert.equal(formatAge(now - (2 * 60 + 14) * 60000, now), '2h 14m');
  assert.equal(formatAge(now - 3 * 24 * 3600000, now), '3d');
  assert.equal(formatAge(null, now), 'Unknown');
  assert.equal(Math.round(ageInMinutes(now - 600000, now)), 10);
  assert.equal(ageInMinutes(null, now), null);
});

test('address shortening and isMissing', () => {
  assert.equal(shortenAddress('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), 'DezX...B263');
  assert.equal(isMissing(0), false);
  assert.equal(isMissing(null), true);
});
