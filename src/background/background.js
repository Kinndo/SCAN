/**
 * Background event page (Firefox MV3 uses `background.scripts`, not a service
 * worker). It owns detection, the provider registry, the cache and scan state.
 *
 * Why the background and not the popup: a Firefox popup is destroyed the moment
 * it loses focus. Keeping scan state here means an in-flight scan survives the
 * popup closing, and reopening the popup re-renders the last result instantly
 * instead of starting over.
 */

import { detectFromUrl, rankCandidates, isSupportedSite } from '../core/detect.js';
import { inferChainFromAddress, normalizeAddress, isNonTokenAddress } from '../utils/validation.js';
import { registry } from '../services/providerRegistry.js';
import { createMockProvider } from '../services/providers/mockProvider.js';
import { createDexScreenerProvider } from '../services/providers/dexscreenerProvider.js';
import { createRugCheckProvider } from '../services/providers/rugcheckProvider.js';
import { runScan } from '../services/marketData.js';
import { TtlCache } from '../utils/caching.js';
import { getSettings, getProviderConfig, setLastScan, getLastScan, cacheStore } from '../storage/storage.js';

const ext = globalThis.browser ?? globalThis.chrome;

// Providers. Each decides from providerConfig (Settings > Data providers)
// whether it is switched on; the registry only offers configured ones.
registry.register(createMockProvider());
registry.register(createDexScreenerProvider());
registry.register(createRugCheckProvider());

const cache = new TtlCache(cacheStore);

/** Last completed or in-flight scan, kept alive across popup open/close. */
let currentScan = null; // { target, snapshot, analysis, status, startedAt, error }
const ports = new Set();

// --------------------------------------------------------------------------
// Detection
// --------------------------------------------------------------------------

const CONTENT_FILES = [
  'src/content/adapters/base.js',
  'src/content/adapters/domAdapter.js',
  'src/content/adapters/siteAdapters.js',
  'src/content/content.js',
];

async function getActiveTab(windowId) {
  // A sidebar or popup passes its own window so a scan follows the tab the user
  // is actually looking at, not whichever window last had focus.
  const query = windowId != null ? { active: true, windowId } : { active: true, currentWindow: true };
  const tabs = await ext.tabs.query(query);
  return tabs && tabs[0] ? tabs[0] : null;
}

/**
 * Reading a page needs either activeTab (granted only by clicking the toolbar
 * button) or a host permission for that site. The sidebar has neither by
 * default, so when injection fails we report which origin to ask for.
 */
async function missingHostPermission(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const origin = `${u.protocol}//${u.hostname}/*`;
    const has = await ext.permissions.contains({ origins: [origin] });
    return has ? null : origin;
  } catch {
    return null;
  }
}

export async function detectToken(windowId = null) {
  const tab = await getActiveTab(windowId);
  if (!tab || !tab.url) {
    return { ok: false, reason: 'no-tab', message: 'No active tab to read.' };
  }

  // 1. URL adapters first - the most reliable signal available.
  const fromUrl = detectFromUrl(tab.url);
  if (fromUrl) {
    // The URL gives us the address but never the token's name. Read the page
    // for that too - this runs while the user is still looking at the idle
    // screen, before they press SCAN, so it costs them nothing.
    const { result: page, failed } = await readPage(tab.id);
    const needsHostPermission = failed && !restrictedPage(tab.url) ? await missingHostPermission(tab.url) : null;
    return {
      ok: true,
      ...fromUrl,
      identityHints: page && page.identityHints ? page.identityHints : null,
      pageDebug: page && page.debug ? page.debug : null,
      needsHostPermission,
      tabUrl: tab.url,
      hostname: safeHostname(tab.url),
    };
  }

  // 2. Fall back to reading the page. activeTab means this only ever happens
  //    for the tab the user pressed SCAN on.
  let pageResult = null;
  try {
    const injected = await ext.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    pageResult = injected && injected[0] ? injected[0].result : null;
  } catch (err) {
    const restricted = restrictedPage(tab.url);
    const needsHostPermission = restricted ? null : await missingHostPermission(tab.url);
    return {
      ok: false,
      reason: 'injection-failed',
      message: restricted
        ? 'This page cannot be read by extensions. Paste the contract address instead.'
        : needsHostPermission
          ? 'SCAN does not have permission to read this site yet.'
          : `Unable to read this page: ${String((err && err.message) || err)}`,
      needsHostPermission,
      hostname: safeHostname(tab.url),
      tabUrl: tab.url,
    };
  }

  if (pageResult && pageResult.candidates && pageResult.candidates.length) {
    const ranked = rankCandidates(pageResult.candidates);
    if (ranked.length) {
      const best = ranked[0];
      const family = inferChainFromAddress(best.address);
      // A tie at the top means the page lists several tokens and nothing
      // singles one out. That is reported, never resolved by guessing.
      const ambiguous = ranked.length > 1 && ranked[1].score >= best.score;
      return {
        ok: true,
        address: best.address,
        chain: family === 'solana' ? 'solana' : 'unknown',
        addressKind: 'token',
        site: 'generic',
        method: 'dom',
        confidence: ambiguous ? 'ambiguous' : 'ranked',
        matchedTicker: best.origins.includes('near-ticker'),
        candidates: ranked.slice(0, 8).map((c) => ({ address: c.address, score: c.score, origins: c.origins })),
        pageMetrics: pageResult.pageMetrics || {},
        identityHints: pageResult.identityHints || {},
        pageDebug: pageResult.debug || null,
        hostname: pageResult.hostname,
        tabUrl: tab.url,
      };
    }
  }

  return {
    ok: false,
    reason: 'unidentified',
    message: 'Unable to automatically identify this token.',
    pageDebug: pageResult && pageResult.debug ? pageResult.debug : null,
    supportedSite: isSupportedSite(tab.url),
    hostname: safeHostname(tab.url),
    tabUrl: tab.url,
  };
}

/** Best-effort page read for the token's name/ticker. Never fatal. */
async function readPage(tabId) {
  try {
    const injected = await ext.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return { result: injected && injected[0] ? injected[0].result : null, failed: false };
  } catch {
    return { result: null, failed: true };
  }
}

/** Turn page hints into an identity patch, marked as page-derived. */
function seedFromHints(hints) {
  if (!hints) return null;
  const identity = {};
  if (hints.symbolHint) identity.symbol = hints.symbolHint;
  if (hints.nameHint) identity.name = hints.nameHint;
  if (!Object.keys(identity).length) return null;
  identity.identitySource = hints.symbolSource ? `page (${hints.symbolSource})` : 'page';
  return { identity };
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function restrictedPage(url) {
  return /^(about:|moz-extension:|chrome:|resource:|view-source:|https:\/\/addons\.mozilla\.org)/i.test(url || '');
}

// --------------------------------------------------------------------------
// Scanning
// --------------------------------------------------------------------------

function broadcast(message) {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

export async function startScan(target) {
  const address = normalizeAddress(target.address);
  if (!address) return { ok: false, message: 'Invalid contract address.' };
  if (isNonTokenAddress(address)) return { ok: false, message: 'That address is a system or wrapped-asset account, not a token to research.' };

  const settings = await getSettings();
  const config = await getProviderConfig();
  const resolved = { ...target, address };

  const seed = seedFromHints(target.identityHints);
  currentScan = { target: resolved, snapshot: null, analysis: null, status: 'running', startedAt: Date.now(), error: null };
  broadcast({ type: 'SCAN_STARTED', target: resolved });

  try {
    const { snapshot, analysis } = await runScan(resolved, {
      registry,
      cache,
      settings,
      config,
      seed,
      onUpdate: ({ snapshot: snap, analysis: an, stage, done }) => {
        currentScan = { ...currentScan, snapshot: snap, analysis: an, status: done ? 'complete' : 'running' };
        broadcast({ type: 'SCAN_UPDATE', stage, done, snapshot: snap, analysis: an, target: resolved });
      },
    });
    currentScan = { ...currentScan, snapshot, analysis, status: 'complete' };
    await setLastScan({ target: resolved, snapshot, analysis, completedAt: Date.now() });
    broadcast({ type: 'SCAN_COMPLETE', snapshot, analysis, target: resolved });
    return { ok: true, snapshot, analysis };
  } catch (err) {
    const message = String((err && err.message) || err);
    currentScan = { ...currentScan, status: 'error', error: message };
    broadcast({ type: 'SCAN_ERROR', message });
    return { ok: false, message };
  }
}

// --------------------------------------------------------------------------
// Provider management (Settings page)
// --------------------------------------------------------------------------

async function describeProviders() {
  const config = await getProviderConfig();
  return {
    demoData: config.demoData !== false,
    providers: registry.list().map((p) => ({
      id: p.id,
      label: p.label,
      stages: p.stages,
      chains: p.chains,
      requiresKey: Boolean(p.requiresKey),
      isMock: Boolean(p.isMock),
      origins: p.origins || [],
      canResolve: typeof p.resolve === 'function',
      configured: registry.isUsable(p, config),
      testable: typeof p.test === 'function',
    })),
  };
}

/** Run a provider's own diagnostic against a known token and report raw facts. */
async function testProvider(id) {
  const provider = registry.get(id);
  if (!provider) return { ok: false, error: `Unknown provider: ${id}` };
  if (typeof provider.test !== 'function') return { ok: false, error: `${provider.label} has no self-test` };
  const config = await getProviderConfig();
  const started = Date.now();
  try {
    const result = await provider.test({ config });
    return { provider: id, ranAt: new Date().toISOString(), ...result };
  } catch (err) {
    return { provider: id, ok: false, ms: Date.now() - started, error: String((err && err.message) || err) };
  }
}

// --------------------------------------------------------------------------
// Messaging
// --------------------------------------------------------------------------

ext.runtime.onConnect.addListener((port) => {
  if (port.name !== 'scan') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));

  // Re-hydrate a reopened popup immediately.
  if (currentScan) {
    port.postMessage({
      type: currentScan.status === 'running' ? 'SCAN_UPDATE' : 'SCAN_COMPLETE',
      snapshot: currentScan.snapshot,
      analysis: currentScan.analysis,
      target: currentScan.target,
      done: currentScan.status !== 'running',
      resumed: true,
    });
  }
});

ext.runtime.onMessage.addListener((message) => {
  switch (message && message.type) {
    case 'DETECT':
      return detectToken(message.windowId ?? null);
    case 'SCAN':
      return startScan(message.target);
    case 'GET_STATE':
      return Promise.resolve({ current: currentScan });
    case 'GET_LAST_SCAN':
      return getLastScan();
    case 'PROVIDERS':
      return describeProviders();
    case 'PROVIDER_TEST':
      return testProvider(message.id);
    default:
      return undefined;
  }
});
