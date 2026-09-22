/**
 * TEMPLATE - copy this file to add a real HTTP data provider.
 * It is NOT registered by default and makes no network calls as written.
 *
 * ============================ API KEYS ============================
 * Never hard-code a key in this repository. Keys are entered by the user in
 * the Settings page and stored in browser.storage.local under
 * `providerConfig.<providerId>.apiKey`; they are passed to fetch() as
 * ctx.config. That means:
 *   - no key ever ships in the extension bundle or the git history,
 *   - a user without a key simply loses that provider, not the whole scan.
 *
 * ========================= HOST PERMISSIONS =======================
 * A background script may only call hosts the extension has permission for.
 * Add the host to `optional_host_permissions` in manifest.json, then request
 * it at runtime from a user gesture (a click in Settings):
 *   await browser.permissions.request({ origins: ['https://api.example.com/*'] })
 * Requesting from the background without a gesture is rejected by Firefox.
 *
 * ============================== CORS ==============================
 * Fetch from the BACKGROUND script, never from the content script. With host
 * permissions the background is not subject to the page's CORS restrictions;
 * a content script generally is.
 *
 * NOTE: the endpoints and field names a real provider uses were NOT verified
 * in this build - the development environment had no outbound network access.
 * Confirm the response shape against live responses before trusting this map.
 */

import { field } from '../../core/model.js';
import { CONFIDENCE } from '../../core/constants.js';

export function createHttpProvider({
  id,
  label,
  baseUrl,
  chains = '*',
  stages = ['market'],
  requiresKey = false,
  priority = 0,
  timeoutMs = 6000,
  buildUrl,
  translate,
} = {}) {
  return {
    id,
    label,
    priority,
    chains,
    stages,
    requiresKey,

    isConfigured(config = {}) {
      if (!requiresKey) return true;
      const entry = config[id];
      return Boolean(entry && entry.apiKey);
    },

    async fetch(stage, target, ctx = {}) {
      const url = buildUrl ? buildUrl(stage, target, ctx) : `${baseUrl}/${target.chain}/${target.address}`;
      if (!url) return null;

      // Own timeout, chained to the caller's abort signal, so one slow provider
      // cannot hold up the whole scan.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (ctx.signal) ctx.signal.addEventListener('abort', () => controller.abort(), { once: true });

      try {
        const headers = { Accept: 'application/json' };
        const key = ctx.config && ctx.config[id] && ctx.config[id].apiKey;
        if (key) headers['X-API-KEY'] = key; // header name is provider-specific

        const res = await fetch(url, { headers, signal: controller.signal });
        if (res.status === 429) throw new Error('Rate limited');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return translate ? translate(stage, json, target) : null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Helper for translate(): wrap a value, dropping it if the API omitted it. */
export const measured = (value, sourceId) =>
  field(value === undefined ? null : value, sourceId, CONFIDENCE.MEASURED);
