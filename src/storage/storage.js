/**
 * Storage layer.
 *
 * PRIVACY: everything is local (browser.storage.local). Nothing is uploaded,
 * no analytics, no account. The extension never asks for, stores or touches
 * private keys, seed phrases or signing credentials - it has no wallet code at
 * all and cannot execute trades.
 *
 * Falls back to an in-memory Map when no extension API is present, so the same
 * module can be imported by the Node test runner.
 */

import { DEFAULT_SETTINGS } from '../scoring/config.js';

const ext = globalThis.browser ?? globalThis.chrome ?? null;
const hasExtStorage = Boolean(ext && ext.storage && ext.storage.local);

const memory = new Map();

const memoryBackend = {
  async get(keys) {
    const out = {};
    for (const k of [].concat(keys)) if (memory.has(k)) out[k] = memory.get(k);
    return out;
  },
  async set(obj) {
    for (const [k, v] of Object.entries(obj)) memory.set(k, v);
  },
  async remove(keys) {
    for (const k of [].concat(keys)) memory.delete(k);
  },
  async clear() {
    memory.clear();
  },
};

/** browser.* returns promises; chrome.* (older) uses callbacks. Normalise. */
const extBackend = {
  get: (keys) => promisify((cb) => ext.storage.local.get(keys, cb)),
  set: (obj) => promisify((cb) => ext.storage.local.set(obj, cb)),
  remove: (keys) => promisify((cb) => ext.storage.local.remove(keys, cb)),
  clear: () => promisify((cb) => ext.storage.local.clear(cb)),
};

function promisify(fn) {
  return new Promise((resolve, reject) => {
    try {
      const maybe = fn((result) => {
        const err = ext.runtime && ext.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

export const backend = hasExtStorage ? extBackend : memoryBackend;

export const KEYS = {
  settings: 'scan.settings',
  providerConfig: 'scan.providerConfig',
  lastScan: 'scan.lastScan',
  cachePrefix: 'scan.cache.',
};

export async function getSettings() {
  const stored = await backend.get(KEYS.settings);
  const saved = stored[KEYS.settings] || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    opportunityWeights: { ...DEFAULT_SETTINGS.opportunityWeights, ...(saved.opportunityWeights || {}) },
    riskWeights: { ...DEFAULT_SETTINGS.riskWeights, ...(saved.riskWeights || {}) },
  };
}

export async function saveSettings(settings) {
  await backend.set({ [KEYS.settings]: settings });
  return settings;
}

export async function resetSettings() {
  await backend.remove(KEYS.settings);
  return { ...DEFAULT_SETTINGS };
}

/** Provider API keys. Stored locally, never bundled, never transmitted anywhere
 *  except to the provider the user configured. */
export async function getProviderConfig() {
  const stored = await backend.get(KEYS.providerConfig);
  return stored[KEYS.providerConfig] || {};
}

export async function saveProviderConfig(config) {
  await backend.set({ [KEYS.providerConfig]: config });
  return config;
}

export async function getLastScan() {
  const stored = await backend.get(KEYS.lastScan);
  return stored[KEYS.lastScan] || null;
}

export async function setLastScan(record) {
  await backend.set({ [KEYS.lastScan]: record });
  return record;
}

/** Persistent tier for TtlCache. */
export const cacheStore = {
  async get(key) {
    const stored = await backend.get(KEYS.cachePrefix + key);
    return stored[KEYS.cachePrefix + key] ?? null;
  },
  async set(key, entry) {
    await backend.set({ [KEYS.cachePrefix + key]: entry });
  },
  async remove(key) {
    await backend.remove(KEYS.cachePrefix + key);
  },
};

export async function clearAllLocalData() {
  await backend.clear();
}
