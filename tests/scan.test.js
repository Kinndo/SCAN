import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry } from '../src/services/providerRegistry.js';
import { createMockProvider, buildMockModel, archetypeFor, ARCHETYPES, isSparseFixture } from '../src/services/providers/mockProvider.js';
import { runScan } from '../src/services/marketData.js';
import { TtlCache } from '../src/utils/caching.js';
import { pick } from '../src/core/model.js';

const SOL = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM = '0x6982508145454ce325ddbe47a25d4ec3d2311933';

function reg() {
  return new ProviderRegistry().register(createMockProvider({ latencyFactor: 0 }));
}

test('the mock provider never invents a token identity', async () => {
  const { snapshot } = await runScan({ chain: 'solana', address: SOL }, { registry: reg() });
  // Placeholder market numbers are labelled and understood as fake. A
  // fabricated name is not: it makes the panel look like it is describing a
  // different token than the one on screen.
  assert.equal(snapshot.identity.name, null);
  assert.equal(snapshot.identity.symbol, null);
  assert.equal(snapshot.identity.decimals, null);
  assert.equal(snapshot.identity.address, SOL, 'the address is the one real identifier');
});

test('page-read identity seeds the scan and is marked as page-derived', async () => {
  const seed = { identity: { symbol: 'Nuts', name: 'Nuts', identitySource: 'page' } };
  const { snapshot } = await runScan({ chain: 'solana', address: SOL }, { registry: reg(), seed });
  assert.equal(snapshot.identity.symbol, 'Nuts');
  assert.equal(snapshot.identity.identitySource, 'page');
  assert.ok(snapshot.meta.sources.includes('page'));
  assert.equal(snapshot.identity.address, SOL, 'a page hint must never change the address');
});

test('mock data is deterministic for a given address', () => {
  const a = buildMockModel(SOL, 'solana', 1_700_000_000_000);
  const b = buildMockModel(SOL, 'solana', 1_700_000_000_000);
  assert.deepEqual(a, b);
  const c = buildMockModel(EVM, 'ethereum', 1_700_000_000_000);
  assert.notEqual(a.marketCapUsd, c.marketCapUsd);
});

test('mock data is internally consistent', () => {
  for (const addr of [SOL, EVM, 'So11111111111111111111111111111111111111113', '0xdeadbeef']) {
    const m = buildMockModel(addr, 'solana', 1_700_000_000_000);
    assert.ok(Math.abs(m.priceUsd * m.supply - m.marketCapUsd) < 1e-6, 'mcap must equal price x supply');
    assert.ok(m.volume.h1 <= m.volume.h6, 'volume windows must nest');
    assert.ok(m.volume.h6 <= m.volume.h24);
    assert.ok(m.volume.m5 <= m.volume.h1);
    if (m.txns.h1) assert.ok(m.txns.h1.buys + m.txns.h1.sells > 0);
  }
});

const SPARSE_SOL = 'Sparse' + 'A'.repeat(38); // valid base58, 44 chars
const SPARSE_EVM = '0x5aa55e' + '0'.repeat(34);

test('ordinary addresses rotate across the rich archetypes only', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) seen.add(archetypeFor(`addr-${i}`));
  const rich = ARCHETYPES.filter((k) => k !== 'sparseData');
  assert.deepEqual([...seen].sort(), [...rich].sort());
  // A real token must never land on the near-empty panel by hash luck - it
  // reads as the extension failing.
  assert.ok(!seen.has('sparseData'));
});

test('the data-poor archetype is reached only through sentinel fixture addresses', () => {
  assert.ok(isSparseFixture(SPARSE_SOL));
  assert.ok(isSparseFixture(SPARSE_EVM));
  assert.equal(archetypeFor(SPARSE_SOL), 'sparseData');
  assert.equal(archetypeFor(SPARSE_EVM), 'sparseData');
  assert.equal(isSparseFixture(SOL), false);
});

test('a scan fills the snapshot, scores it and marks it as mock data', async () => {
  const { snapshot, analysis } = await runScan({ chain: 'solana', address: SOL }, { registry: reg() });
  assert.equal(snapshot.identity.address, SOL);
  assert.ok(Number.isFinite(pick(snapshot, 'market.priceUsd')));
  assert.equal(snapshot.meta.partial, false);
  assert.equal(snapshot.meta.isMockData, true);
  assert.equal(analysis.isMockData, true, 'the UI must be able to label this as demo data');
  assert.ok(analysis.keySignals.length === 7);
});

test('stages arrive progressively and each update carries a usable analysis', async () => {
  const updates = [];
  await runScan({ chain: 'solana', address: SOL }, {
    registry: reg(),
    onUpdate: (u) => updates.push(u),
  });
  assert.ok(updates.length >= 3, 'should emit per-stage, not just once at the end');
  assert.ok(updates.every((u) => u.analysis && Array.isArray(u.analysis.keySignals)));
  assert.equal(updates.at(-1).done, true);
  const firstStages = updates[0].snapshot.meta.stagesComplete.length;
  const lastStages = updates.at(-1).snapshot.meta.stagesComplete.length;
  assert.ok(lastStages > firstStages, 'the snapshot should accumulate across updates');
});

test('a data-poor token records empty stages, not errors, and invents nothing', async () => {
  const { snapshot, analysis } = await runScan({ chain: 'solana', address: SPARSE_SOL }, { registry: reg() });
  assert.equal(pick(snapshot, 'holders.top10Pct'), null);
  assert.equal(pick(snapshot, 'contract.mintAuthorityActive'), null);
  // The provider ran fine and simply had nothing: that is "no data", which the
  // UI shows dimmed, not "failed", which it shows red.
  for (const stage of ['holders', 'contract', 'dev', 'social']) {
    assert.ok(snapshot.meta.stagesEmpty.includes(stage), `${stage} should be empty`);
  }
  assert.equal(snapshot.meta.errors.length, 0, 'nothing actually failed');
  assert.equal(snapshot.meta.partial, false);
  assert.ok(analysis.risk.unverified.length > 0);
});

test('a provider that throws is an error, a provider that returns null is not', async () => {
  const registry = new ProviderRegistry()
    .register({ id: 'quiet', label: 'Quiet', chains: '*', stages: ['holders'], fetch: async () => null })
    .register({ id: 'broken', label: 'Broken', chains: '*', stages: ['contract'], fetch: async () => { throw new Error('HTTP 500'); } });
  const { snapshot } = await runScan({ chain: 'solana', address: SOL }, { registry, stages: ['holders', 'contract'] });
  assert.deepEqual(snapshot.meta.stagesEmpty, ['holders']);
  assert.equal(snapshot.meta.errors.length, 1);
  assert.equal(snapshot.meta.errors[0].stage, 'contract');
  assert.match(snapshot.meta.errors[0].message, /HTTP 500/);
});

test('a failing provider never aborts the scan', async () => {
  const registry = reg().register({
    id: 'broken', label: 'Broken', priority: 100, chains: '*', stages: ['holders'],
    fetch: async () => { throw new Error('upstream 500'); },
  });
  const { snapshot } = await runScan({ chain: 'solana', address: SOL }, { registry });
  assert.ok(Number.isFinite(pick(snapshot, 'market.priceUsd')), 'other stages still land');
  // Falls through from the broken high-priority provider to the mock.
  assert.ok(Number.isFinite(pick(snapshot, 'holders.top10Pct')) || snapshot.meta.errors.some((e) => e.stage === 'holders'));
});

test('stages with no provider at all are reported, not silently empty', async () => {
  const registry = new ProviderRegistry().register({
    id: 'market-only', label: 'Market only', chains: '*', stages: ['identity', 'market'],
    fetch: async () => ({ market: {} }),
  });
  const { snapshot } = await runScan({ chain: 'solana', address: SOL }, { registry });
  const stages = snapshot.meta.errors.map((e) => e.stage);
  for (const stage of ['holders', 'contract', 'dev', 'social']) {
    assert.ok(stages.includes(stage), `${stage} should report having no provider`);
  }
});

test('a second scan of the same token is served from cache', async () => {
  const cache = new TtlCache();
  const registry = reg();
  await runScan({ chain: 'solana', address: SOL }, { registry, cache });
  const { snapshot } = await runScan({ chain: 'solana', address: SOL }, { registry, cache });
  assert.ok(snapshot.meta.sources.some((s) => s.endsWith(':cached')), 'expected a cache hit on the repeat scan');
});

test('providers that need an unconfigured key are skipped', () => {
  const registry = reg().register({
    id: 'paid', label: 'Paid API', priority: 50, chains: '*', stages: ['market'],
    requiresKey: true,
    isConfigured: (config) => Boolean(config.paid && config.paid.apiKey),
    fetch: async () => ({}),
  });
  assert.equal(registry.candidates('market', 'solana', {}).length, 1, 'only the mock is usable');
  assert.equal(registry.candidates('market', 'solana', { paid: { apiKey: 'k' } })[0].id, 'paid');
});

test('registry honours chain support and priority order', () => {
  const registry = reg().register({
    id: 'sol-only', label: 'Solana only', priority: 10, chains: ['solana'], stages: ['holders'],
    fetch: async () => ({}),
  });
  assert.equal(registry.candidates('holders', 'solana', {})[0].id, 'sol-only');
  assert.deepEqual(registry.candidates('holders', 'ethereum', {}).map((p) => p.id), ['mock']);
  assert.deepEqual(registry.unservedStages(['holders', 'nonexistent'], 'ethereum', {}), ['nonexistent']);
});

test('an aborted scan stops merging results', async () => {
  const controller = new AbortController();
  controller.abort();
  const { snapshot } = await runScan({ chain: 'solana', address: SOL }, { registry: reg(), signal: controller.signal });
  assert.equal(pick(snapshot, 'market.priceUsd'), null);
});
