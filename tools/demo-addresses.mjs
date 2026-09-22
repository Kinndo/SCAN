#!/usr/bin/env node
/**
 * Finds valid-format addresses that land on each mock archetype, so every UI
 * state can be reached on demand from the popup's manual-entry box.
 *
 * These are FORMAT-VALID BUT FICTIONAL addresses for exercising the demo
 * provider. They are not real tokens and mean nothing on a real chain.
 *
 *   node tools/demo-addresses.mjs
 */

import { archetypeFor, ARCHETYPES, buildMockModel, SPARSE_SENTINEL } from '../src/services/providers/mockProvider.js';
import { isSolanaAddress, isEvmAddress } from '../src/utils/validation.js';
import { formatUsd } from '../src/utils/formatting.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HEX = '0123456789abcdef';

function candidate(alphabet, length, n, prefix = '') {
  let out = prefix;
  let x = n;
  for (let i = out.length; i < length; i += 1) {
    out += alphabet[x % alphabet.length];
    x = Math.floor(x / alphabet.length) + i * 7919;
  }
  return out;
}

const WHAT = {
  earlyRunner: 'young token running on strong volume - high opportunity, age risk',
  establishedMeme: 'large, mature, well distributed - low risk, limited upside room',
  thinAndRisky: 'thin liquidity, concentrated supply, hot volume',
  dangerSignals: 'mint + freeze live, deployer selling, LP unlocked - high risk',
  fading: 'price sliding on draining volume, sellers dominant',
  sparseData: 'most fields unavailable - exercises every Insufficient data path (opt-in: only these sentinel addresses reach it)',
};

function findFor(kind, { evm = false } = {}) {
  // The data-poor archetype is opt-in: real addresses never hash onto it.
  if (kind === 'sparseData') return evm ? '0x5aa55e' + '0'.repeat(34) : 'Sparse' + 'A'.repeat(38);
  const alphabet = evm ? HEX : B58;
  const length = evm ? 42 : 44;
  const prefix = evm ? '0x' : '';
  const check = evm ? isEvmAddress : isSolanaAddress;
  for (let n = 1; n < 200000; n += 1) {
    const addr = candidate(alphabet, length, n, prefix);
    if (check(addr) && archetypeFor(addr) === kind) return addr;
  }
  return null;
}

console.log('\nFictional, format-valid addresses for exercising the demo provider.');
console.log('Paste one into the popup\'s manual-entry box. These are NOT real tokens.\n');

for (const kind of ARCHETYPES) {
  const sol = findFor(kind);
  const evm = findFor(kind, { evm: true });
  console.log(`${kind}`);
  console.log(`  what you should see: ${WHAT[kind]}`);
  if (sol) {
    const m = buildMockModel(sol, 'solana', Date.now());
    console.log(`  solana : ${sol}`);
    console.log(`           mcap ${formatUsd(m.marketCapUsd)}  liq ${formatUsd(m.liquidityUsd)}  ${m.contract.mintAuthorityActive ? 'mint LIVE' : 'mint revoked'}`);
  }
  if (evm) console.log(`  evm    : ${evm}   (choose a chain in the dropdown)`);
  console.log();
}
