import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry } from '../src/services/providerRegistry.js';
import { createMockProvider, buildMockModel, archetypeFor, ARCHETYPES } from '../src/services/providers/mockProvider.js';
import { runScan } from '../src/services/marketData.js';
import { TtlCache } from '../src/utils/caching.js';
import { pick } from '../src/core/model.js';

const SOL = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM = '0x6982508145454ce325ddbe47a25d4ec3d2311933';

function reg() {
  return new ProviderRegistry().register(createMockProvider({ latencyFactor: 0 }));
}

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

test('addresses spread across every archetype including the data-poor one', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) seen.add(archetypeFor(`addr-${i}`));
  assert.deepEqual([...seen].sort(), [...ARCHETYPES].sort());
});

test('a scan fills the snapshot, scores it and marks it as mock data', async () => {
  const { snapshot, analysis } = await runScan({ chain: 'solana', address: SOL }, { registry: reg() });
  assert.equal(snapshot.identity.address, SOL);
  assert.ok(snapshot.identity.symbol);
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

test('a data-poor token records stage errors instead of inventing values', async () => {
  // Find an address the mock maps onto the sparse archetype.
  let sparse = null;
  for (let i = 0; i < 500 && !sparse; i += 1) {
    if (archetypeFor(`sparse-${i}`) === 'sparseData') sparse = `sparse-${i}`;
  }
  assert.ok(sparse, 'expected to find a sparse-archetype address');

  const { snapshot, analysis } = await runScan({ chain: 'solana', address: sparse }, { registry: reg() });
  assert.equal(pick(snapshot, 'holders.top10Pct'), null);
  assert.equal(pick(snapshot, 'contract.mintAuthorityActive'), null);
  assert.ok(snapshot.meta.errors.length > 0, 'missing stages must be recorded as errors');
  assert.ok(analysis.risk.unverified.length > 0);
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
