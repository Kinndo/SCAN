#!/usr/bin/env node
/**
 * Runs a real scan through the real pipeline (detection -> providers ->
 * scoring -> signals) and prints the dashboard as text. Same modules the popup
 * uses, so it is a genuine end-to-end check without launching Firefox.
 *
 *   node tools/demo-scan.mjs [address-or-url]
 */

import { ProviderRegistry } from '../src/services/providerRegistry.js';
import { createMockProvider } from '../src/services/providers/mockProvider.js';
import { runScan } from '../src/services/marketData.js';
import { detectFromUrl } from '../src/core/detect.js';
import { validateManualInput } from '../src/utils/validation.js';
import { formatUsd, formatPercent, formatAge } from '../src/utils/formatting.js';
import { pick } from '../src/core/model.js';

const input = process.argv[2] || 'https://dexscreener.com/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

const detected = detectFromUrl(input);
const target = detected ?? (() => {
  const parsed = validateManualInput(input);
  if (!parsed.ok) {
    console.error(`Unable to automatically identify this token: ${parsed.error}`);
    process.exit(1);
  }
  return parsed;
})();

console.log(`\ninput   : ${input}`);
console.log(`detected: ${target.address}  chain=${target.chain}  kind=${target.addressKind}  via=${target.method ?? 'manual'}\n`);

const registry = new ProviderRegistry().register(createMockProvider());
const started = Date.now();
const stageTimes = [];

const { snapshot, analysis } = await runScan(target, {
  registry,
  onUpdate: ({ stage, done }) => {
    if (!done) stageTimes.push(`${stage}+${Date.now() - started}ms`);
  },
});

const DOT = { good: '\x1b[32m*\x1b[0m', warn: '\x1b[33m!\x1b[0m', bad: '\x1b[31mX\x1b[0m', unknown: '\x1b[90m?\x1b[0m' };
const line = (k, v) => `  ${k.padEnd(14)} ${v}`;

if (analysis.isMockData) console.log('\x1b[33m[DEMO DATA] placeholder values from the built-in mock provider\x1b[0m\n');

const shownName = snapshot.identity.name || 'Name unavailable';
const shownTicker = snapshot.identity.symbol ? `$${snapshot.identity.symbol}` : snapshot.identity.address;
console.log(`${shownName}  ${shownTicker}`);
console.log(line('Price', formatUsd(pick(snapshot, 'market.priceUsd'))));
console.log(line('Market Cap', formatUsd(pick(snapshot, 'market.marketCapUsd'))));
console.log(line('Liquidity', formatUsd(pick(snapshot, 'market.liquidityUsd'))));
console.log(line('24h Volume', formatUsd(pick(snapshot, 'market.volume.h24'))));
console.log(line('Age', pick(snapshot, 'market.createdAt') ? formatAge(pick(snapshot, 'market.createdAt'), analysis.generatedAt) : 'Unknown'));
console.log(line('1h Change', formatPercent(pick(snapshot, 'market.priceChange.h1'), { signed: true })));

const scoreText = (s) => (s.insufficientData ? 'Insufficient data' : `${s.score} / 100`);
console.log(`\n  OPPORTUNITY SCORE   ${scoreText(analysis.opportunity)}   (${Math.round(analysis.opportunity.coverage * 100)}% data)`);
console.log(`  RISK SCORE          ${scoreText(analysis.risk)}   (${Math.round(analysis.risk.coverage * 100)}% data)`);

console.log('\nKEY SIGNALS');
for (const s of analysis.keySignals) console.log(`  ${DOT[s.level]} ${s.label.padEnd(12)} ${s.text}`);

console.log('\nIMPORTANT SIGNALS');
for (const a of analysis.topAlerts) console.log(`  ${DOT[a.level]} ${a.text}`);

console.log('\nWHY?');
for (const w of analysis.why) console.log(`  - ${w}`);
console.log('\nCONCERNS');
for (const c of analysis.concerns) console.log(`  ! ${c}`);

console.log('\nOPPORTUNITY BREAKDOWN');
for (const c of analysis.opportunity.components) {
  const score = c.available ? String(c.score).padStart(3) : ' --';
  console.log(`  ${score}  ${c.label.padEnd(20)} w${String(c.weight).padStart(3)}  ${c.available ? (c.reasons[0] ?? `scored ${c.score}`) : `Insufficient data (missing ${c.missing.join(', ')})`}`);
}

if (analysis.risk.unverified.length) {
  console.log('\nUNVERIFIED RISK CHECKS');
  for (const u of analysis.risk.unverified) console.log(`  ? ${u.label}: ${u.message}`);
}

console.log(`\nstages  : ${stageTimes.join('  ')}`);
console.log(`total   : ${Date.now() - started}ms   completeness=${Math.round(analysis.completeness * 100)}%`);
if (snapshot.meta.stagesEmpty.length) console.log(`no data : ${snapshot.meta.stagesEmpty.join(', ')}`);
if (snapshot.meta.errors.length) {
  console.log('errors  : ' + snapshot.meta.errors.map((e) => `${e.stage}: ${e.message}`).join(' | '));
}
console.log();
