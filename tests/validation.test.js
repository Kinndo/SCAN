import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSolanaAddress, isEvmAddress, normalizeAddress, inferChainFromAddress,
  validateManualInput, isNonTokenAddress,
} from '../src/utils/validation.js';

const SOL = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM = '0x6982508145454Ce325dDbE47a25d4ec3d2311933';

test('recognises each address family', () => {
  assert.ok(isSolanaAddress(SOL));
  assert.ok(isEvmAddress(EVM));
  assert.equal(isSolanaAddress(EVM), false);
  assert.equal(isEvmAddress(SOL), false);
  // base58 excludes 0, O, I and l
  assert.equal(isSolanaAddress('0ezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), false);
  assert.equal(isEvmAddress('0x6982508145454Ce325dDbE47a25d4ec3d23119'), false);
});

test('EVM addresses normalise to lowercase, base58 is left alone', () => {
  assert.equal(normalizeAddress(`  ${EVM}  `), EVM.toLowerCase());
  assert.equal(normalizeAddress(SOL), SOL);
  assert.equal(normalizeAddress('nonsense'), null);
});

test('chain family inference cannot invent a specific EVM chain', () => {
  assert.equal(inferChainFromAddress(SOL), 'solana');
  assert.equal(inferChainFromAddress(EVM), 'evm-family');
  assert.equal(inferChainFromAddress('xx'), 'unknown');
});

test('manual entry accepts a bare address', () => {
  const r = validateManualInput(SOL);
  assert.deepEqual([r.ok, r.chain, r.address], [true, 'solana', SOL]);
});

test('manual entry extracts an address out of a pasted URL', () => {
  const r = validateManualInput(`https://dexscreener.com/ethereum/${EVM}`);
  assert.ok(r.ok);
  assert.equal(r.address, EVM.toLowerCase());
  assert.equal(r.chain, 'unknown', 'shape alone cannot prove which EVM chain');
});

test('manual entry honours an explicit EVM chain choice', () => {
  const r = validateManualInput(EVM, 'base');
  assert.equal(r.chain, 'base');
});

test('manual entry refuses ambiguous and empty input', () => {
  assert.equal(validateManualInput('').ok, false);
  assert.equal(validateManualInput('no address in here').ok, false);
  const two = validateManualInput(`${EVM} and 0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE`);
  assert.equal(two.ok, false);
  assert.match(two.error, /2 possible addresses/);
});

test('system and wrapped-asset addresses are rejected', () => {
  assert.ok(isNonTokenAddress('So11111111111111111111111111111111111111112'));
  assert.ok(isNonTokenAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'));
  assert.equal(validateManualInput('So11111111111111111111111111111111111111112').ok, false);
});
