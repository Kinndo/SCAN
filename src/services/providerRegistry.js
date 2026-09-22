/**
 * Provider registry - the seam between the data layer and everything above it.
 *
 * A provider declares which chains and which snapshot stages it can serve. The
 * orchestrator asks the registry for candidates per (stage, chain) and tries
 * them in priority order, so adding a real API later means writing one module
 * and calling register() - no changes to scoring or UI.
 *
 * Provider contract:
 *   {
 *     id: string,
 *     label: string,
 *     priority: number,          // higher wins
 *     chains: string[] | '*',
 *     stages: string[],          // identity|market|holders|contract|dev|social
 *     requiresKey: boolean,
 *     isConfigured(config): boolean,
 *     async fetch(stage, target, ctx): Partial<TokenSnapshot> | null
 *   }
 *
 * fetch() MUST return null (not zeros) for data it cannot obtain.
 */

export class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(provider) {
    if (!provider || !provider.id) throw new Error('Provider needs an id');
    if (typeof provider.fetch !== 'function') throw new Error(`Provider ${provider.id} needs a fetch()`);
    this.providers.set(provider.id, { priority: 0, requiresKey: false, chains: '*', stages: [], ...provider });
    return this;
  }

  unregister(id) {
    this.providers.delete(id);
    return this;
  }

  get(id) {
    return this.providers.get(id) ?? null;
  }

  list() {
    return [...this.providers.values()];
  }

  supportsChain(provider, chain) {
    if (provider.chains === '*') return true;
    if (!Array.isArray(provider.chains)) return false;
    // 'unknown' chain: let a provider opt in explicitly, otherwise allow so the
    // scan can still try (an EVM address of unresolved chain is common).
    return provider.chains.includes(chain) || chain === 'unknown';
  }

  /** Providers that can serve this stage for this chain, best first. */
  candidates(stage, chain, config = {}) {
    return this.list()
      .filter((p) => p.stages.includes(stage))
      .filter((p) => this.supportsChain(p, chain))
      .filter((p) => !p.requiresKey || (typeof p.isConfigured === 'function' ? p.isConfigured(config) : false))
      .sort((a, b) => b.priority - a.priority);
  }

  /** Which stages have no usable provider at all - drives "Insufficient data". */
  unservedStages(stages, chain, config = {}) {
    return stages.filter((stage) => this.candidates(stage, chain, config).length === 0);
  }
}

export const registry = new ProviderRegistry();
