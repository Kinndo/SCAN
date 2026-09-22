/**
 * Two-tier TTL cache: an in-process Map (survives while the background page is
 * alive) over an async persistent store (survives restarts).
 *
 * Different data has very different shelf lives - contract metadata barely
 * changes, price changes every second - so the TTL is per-namespace.
 */

export const TTL = {
  identity: 24 * 60 * 60 * 1000, // name/symbol/decimals: effectively immutable
  contract: 60 * 60 * 1000, // mint/freeze authority: rarely changes
  holders: 5 * 60 * 1000,
  social: 30 * 60 * 1000,
  market: 20 * 1000, // price/volume: short
  scan: 60 * 1000, // whole analysed scan
};

export function cacheKey(namespace, chain, address) {
  return `${namespace}:${chain || 'unknown'}:${address}`;
}

export class TtlCache {
  /**
   * @param {{get:(k:string)=>Promise<any>, set:(k:string,v:any)=>Promise<void>, remove:(k:string)=>Promise<void>}} [store]
   * @param {() => number} [now] injectable clock for tests
   */
  constructor(store = null, now = () => Date.now()) {
    this.memory = new Map();
    this.store = store;
    this.now = now;
  }

  async get(key) {
    const hit = this.memory.get(key);
    if (hit) {
      if (hit.expiresAt > this.now()) return hit.value;
      this.memory.delete(key);
    }
    if (!this.store) return null;
    try {
      const persisted = await this.store.get(key);
      if (persisted && persisted.expiresAt > this.now()) {
        this.memory.set(key, persisted);
        return persisted.value;
      }
      if (persisted) await this.store.remove(key);
    } catch {
      // A broken cache must never break a scan.
    }
    return null;
  }

  async set(key, value, ttlMs) {
    const entry = { value, expiresAt: this.now() + ttlMs, storedAt: this.now() };
    this.memory.set(key, entry);
    if (this.store) {
      try {
        await this.store.set(key, entry);
      } catch {
        /* memory tier still works */
      }
    }
    return value;
  }

  /** Fetch-through helper: returns {value, cached}. */
  async wrap(key, ttlMs, producer) {
    const cached = await this.get(key);
    if (cached !== null && cached !== undefined) return { value: cached, cached: true };
    const value = await producer();
    if (value !== null && value !== undefined) await this.set(key, value, ttlMs);
    return { value, cached: false };
  }

  async invalidate(key) {
    this.memory.delete(key);
    if (this.store) {
      try {
        await this.store.remove(key);
      } catch {
        /* ignore */
      }
    }
  }

  clearMemory() {
    this.memory.clear();
  }

  get size() {
    return this.memory.size;
  }
}
