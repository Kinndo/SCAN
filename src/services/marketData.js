/**
 * Scan orchestrator.
 *
 * Every stage is requested IN PARALLEL and rendered the moment it lands - the
 * user sees price and market cap while holder and contract analysis are still
 * in flight, which is the whole point of the product. A stage that fails or has
 * no provider is recorded as an error and leaves its fields null; it never
 * aborts the scan and never substitutes a placeholder value.
 */

import { emptySnapshot, mergeSnapshot, markStageComplete, recordError, recordEmpty, STAGES } from '../core/model.js';
import { TTL, cacheKey } from '../utils/caching.js';
import { analyze } from '../scoring/index.js';

const STAGE_TTL = {
  identity: TTL.identity,
  market: TTL.market,
  holders: TTL.holders,
  contract: TTL.contract,
  dev: TTL.contract,
  social: TTL.social,
};

/**
 * @param {{chain:string,address:string,addressKind?:string}} target
 * @param {object} deps
 * @param {import('./providerRegistry.js').ProviderRegistry} deps.registry
 * @param {import('../utils/caching.js').TtlCache} [deps.cache]
 * @param {object} [deps.settings]
 * @param {object} [deps.config]        provider configuration (API keys etc.)
 * @param {(update:{snapshot:object,analysis:object,stage:string,done:boolean})=>void} [deps.onUpdate]
 * @param {AbortSignal} [deps.signal]
 * @param {number} [deps.now]
 */
export async function runScan(target, deps = {}) {
  const { registry, cache = null, settings = {}, config = {}, onUpdate, signal } = deps;
  const now = deps.now ?? Date.now();
  if (!registry) throw new Error('runScan requires a provider registry');
  if (!target || !target.address) throw new Error('runScan requires a target address');

  // A page usually hands us a pool address (Axiom, DexScreener, DEXTools) or an
  // address of unknown chain (a pasted 0x...). Everything downstream - other
  // providers, cache keys, the header - needs the token itself, so resolve
  // first. Resolution is cached for a day: a pool's base token does not change.
  const resolution = needsResolution(target)
    ? await resolveTarget(target, { registry, cache, config, signal })
    : null;
  const resolvedTarget = resolution
    ? { ...target, address: resolution.address, chain: resolution.chain ?? target.chain, addressKind: 'token' }
    : target;

  let snapshot = emptySnapshot(resolvedTarget);
  snapshot.meta.fetchedAt = now;
  if (resolution) {
    snapshot.identity.pairAddress = resolution.pairAddress ?? null;
    snapshot.identity.resolvedBy = resolution.resolvedBy ?? null;
    snapshot.identity.resolvedFrom = resolution.resolvedFrom ?? target.address;
  }

  // Identity read from the page before the scan started. It is a hint, not a
  // provider result, so it is tagged as such and any provider that can return
  // authoritative metadata later will overwrite it.
  if (deps.seed) {
    snapshot = mergeSnapshot(snapshot, deps.seed);
    if (deps.seed.identity && (deps.seed.identity.symbol || deps.seed.identity.name)) {
      snapshot.meta.sources.push('page');
    }
  }

  const emit = (stage, done = false) => {
    if (typeof onUpdate !== 'function') return;
    try {
      onUpdate({ snapshot, stage, done, analysis: analyze(snapshot, { settings, now: Date.now() }) });
    } catch {
      // A rendering error must not kill the scan.
    }
  };

  const stages = deps.stages ?? STAGES;
  const unserved = registry.unservedStages(stages, resolvedTarget.chain, config);
  for (const stage of unserved) {
    recordError(snapshot, stage, 'No data provider available for this stage on this chain.');
  }
  if (resolution) emit('resolve');

  const pending = stages
    .filter((stage) => !unserved.includes(stage))
    .map((stage) =>
      fetchStage(stage, resolvedTarget, { registry, cache, config, signal })
        .then((result) => {
          if (signal && signal.aborted) return;
          if (result && result.patch) {
            snapshot = mergeSnapshot(snapshot, result.patch);
            markStageComplete(snapshot, stage, result.providerId);
            if (result.cached) {
              const tag = `${result.providerId}:cached`;
              if (!snapshot.meta.sources.includes(tag)) snapshot.meta.sources.push(tag);
            }
          } else if (result && result.empty) {
            recordEmpty(snapshot, stage);
          } else {
            recordError(snapshot, stage, result && result.error ? result.error : 'No data returned for this stage.');
          }
          emit(stage);
        })
        .catch((err) => {
          recordError(snapshot, stage, String((err && err.message) || err));
          emit(stage);
        }),
    );

  await Promise.allSettled(pending);
  snapshot.meta.partial = snapshot.meta.stagesPending.length > 0;
  const analysis = analyze(snapshot, { settings, now: Date.now() });
  emit('done', true);
  return { snapshot, analysis };
}

export function needsResolution(target) {
  const kind = target.addressKind || 'token';
  return kind !== 'token' || !target.chain || target.chain === 'unknown';
}

async function resolveTarget(target, { registry, cache, config, signal }) {
  for (const provider of registry.resolvers(target.chain, config)) {
    if (signal && signal.aborted) return null;
    try {
      const key = cacheKey(`resolve:${provider.id}`, target.chain, `${target.addressKind || 'token'}:${target.address}`);
      const run = () => provider.resolve(target, { config, signal });
      const result = cache ? (await cache.wrap(key, TTL.identity, run)).value : await run();
      if (result && result.address) return result;
    } catch {
      // A resolver that fails is skipped; the scan proceeds with what it has.
    }
  }
  return null;
}

async function fetchStage(stage, target, { registry, cache, config, signal }) {
  const candidates = registry.candidates(stage, target.chain, config);
  const errors = [];

  for (const provider of candidates) {
    if (signal && signal.aborted) return { patch: null, error: 'Scan cancelled.' };
    const key = cacheKey(`${stage}:${provider.id}`, target.chain, target.address);
    try {
      if (cache) {
        const hit = await cache.get(key);
        if (hit) return { patch: hit, providerId: provider.id, cached: true };
      }
      const patch = await provider.fetch(stage, target, { config, signal });
      if (patch) {
        if (cache) await cache.set(key, patch, STAGE_TTL[stage] ?? 60000);
        return { patch, providerId: provider.id, cached: false };
      }
      errors.push(`${provider.id}: no data`);
    } catch (err) {
      errors.push(`${provider.id}: ${String((err && err.message) || err)}`);
    }
  }

  // Every candidate ran and none threw: the data is absent, not broken.
  const allEmpty = candidates.length > 0 && errors.every((e) => e.endsWith(': no data'));
  if (allEmpty) return { patch: null, empty: true };
  return { patch: null, error: errors.length ? errors.join('; ') : 'No provider returned data.' };
}
