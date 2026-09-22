import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Content scripts cannot import ES modules, so the address regexes are
 * duplicated in src/content/adapters/base.js. This test is the guard that
 * stops the two copies drifting apart.
 */
const NAMES = ['SOLANA_ADDRESS_RE', 'EVM_ADDRESS_RE', 'SOLANA_SCAN_RE', 'EVM_SCAN_RE'];

function literalsFrom(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const out = {};
  for (const name of NAMES) {
    const m = source.match(new RegExp(`${name}\\s*=\\s*(/.+?/[gimsuy]*)\\s*;`));
    assert.ok(m, `${name} not found in ${path}`);
    out[name] = m[1];
  }
  return out;
}

test('content-script regexes match the canonical validation regexes', () => {
  const canonical = literalsFrom('../src/utils/validation.js');
  const copy = literalsFrom('../src/content/adapters/base.js');
  assert.deepEqual(copy, canonical);
});

test('content base helpers load as a plain script and expose their API', async () => {
  await import('../src/content/adapters/base.js');
  const base = globalThis.ScanContentBase;
  assert.ok(base, 'base.js should define globalThis.ScanContentBase');
  assert.ok(base.isSolana('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'));
  assert.ok(base.isEvm('0x6982508145454Ce325dDbE47a25d4ec3d2311933'));

  const found = base.scanText('pair 0x6982508145454Ce325dDbE47a25d4ec3d2311933 vs DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
  assert.equal(found.length, 2);
});

test('repeated scans do not leak regex lastIndex state', async () => {
  await import('../src/content/adapters/base.js');
  const base = globalThis.ScanContentBase;
  const text = '0x6982508145454Ce325dDbE47a25d4ec3d2311933';
  assert.equal(base.scanText(text).length, 1);
  assert.equal(base.scanText(text).length, 1, 'a global regex must be reset between calls');
});
