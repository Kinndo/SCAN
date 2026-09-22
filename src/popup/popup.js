/**
 * Popup controller.
 *
 * Renders whatever the background has so far and re-renders on every stage
 * update, so the dashboard fills in progressively instead of blocking on the
 * slowest request. All text goes in via textContent - page-derived strings are
 * never interpolated as HTML.
 */

import { formatUsd, formatPercent, formatAge, formatRelativeTime, shortenAddress, isMissing } from '../utils/formatting.js';
import { validateManualInput, inferChainFromAddress } from '../utils/validation.js';
import { pick } from '../core/model.js';
import { CHAINS } from '../core/constants.js';
import { getSettings } from '../storage/storage.js';
import { isSidebarView, shouldRescan, isNavigationUpdate, debounce } from './sidebar.js';

const ext = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

const state = {
  detection: null,
  analysis: null,
  snapshot: null,
  target: null,
  expanded: null, // 'opportunity' | 'risk' | null
  showAllAlerts: false,
  scanning: false,
  settings: null,
  windowId: null,
};

let port = null;
const isSidebar = isSidebarView(ext, window);
let followGeneration = 0;

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

init();

async function init() {
  document.documentElement.classList.toggle('sidebar', isSidebar);
  $('btn-sidebar').hidden = isSidebar;
  state.settings = await getSettings();
  try {
    state.windowId = (await ext.windows.getCurrent()).id;
  } catch {
    state.windowId = null;
  }
  wireEvents();
  connect();
  await detect();
  if (isSidebar) {
    watchActiveTab();
    await followActiveTab();
  }
  // Settings changed while the panel is open apply to the next scan.
  try {
    ext.storage.onChanged.addListener(() => {
      getSettings().then((next) => { state.settings = next; });
    });
  } catch {
    /* no change events: settings load on next open */
  }
}

function connect() {
  try {
    port = ext.runtime.connect({ name: 'scan' });
    port.onMessage.addListener(onBackgroundMessage);
  } catch {
    // Background unavailable: manual entry still works via sendMessage.
  }
}

function onBackgroundMessage(msg) {
  if (!msg) return;
  switch (msg.type) {
    case 'SCAN_STARTED':
      state.scanning = true;
      state.target = msg.target;
      showView('result');
      break;
    case 'SCAN_UPDATE':
    case 'SCAN_COMPLETE':
      if (msg.snapshot) state.snapshot = msg.snapshot;
      if (msg.analysis) state.analysis = msg.analysis;
      if (msg.target) state.target = msg.target;
      state.scanning = msg.type === 'SCAN_UPDATE' && !msg.done;
      showView('result');
      render();
      break;
    case 'SCAN_ERROR':
      state.scanning = false;
      showError(msg.message || 'Scan failed.');
      break;
    default:
      break;
  }
}

function wireEvents() {
  $('btn-scan').addEventListener('click', onScanClick);
  $('btn-rescan').addEventListener('click', onScanClick);
  $('btn-settings').addEventListener('click', () => ext.runtime.openOptionsPage());
  $('btn-manual-toggle').addEventListener('click', () => showView('manual'));
  $('btn-error-manual').addEventListener('click', () => showView('manual'));
  $('btn-manual-cancel').addEventListener('click', () => showView(state.analysis ? 'result' : 'idle'));
  $('btn-manual-scan').addEventListener('click', onManualScan);
  $('manual-address').addEventListener('keydown', (e) => { if (e.key === 'Enter') onManualScan(); });
  $('card-opp').addEventListener('click', () => toggleBreakdown('opportunity'));
  $('card-risk').addEventListener('click', () => toggleBreakdown('risk'));
  $('btn-more-alerts').addEventListener('click', () => { state.showAllAlerts = !state.showAllAlerts; render(); });
  $('token-address').addEventListener('click', copyAddress);
  $('btn-debug').addEventListener('click', copyDebugReport);
  $('btn-sidebar').addEventListener('click', onOpenSidebar);
  $('btn-source-settings').addEventListener('click', () => ext.runtime.openOptionsPage());
  $('btn-allow-site').addEventListener('click', onAllowSite);
}

// --------------------------------------------------------------------------
// Detection + scanning
// --------------------------------------------------------------------------

async function detect() {
  try {
    const result = await ext.runtime.sendMessage({ type: 'DETECT', windowId: state.windowId });
    state.detection = result;
  } catch (err) {
    state.detection = { ok: false, message: String((err && err.message) || err) };
  }
  renderDetectPreview(state.detection);
  renderHostPermissionPrompt(state.detection);
}

// --------------------------------------------------------------------------
// Sidebar mode: follow the active tab
// --------------------------------------------------------------------------

function watchActiveTab() {
  const refresh = debounce(async () => {
    await detect();
    await followActiveTab();
  }, 600);
  try {
    ext.tabs.onActivated.addListener((info) => {
      if (state.windowId === null || info.windowId === state.windowId) refresh();
    });
    ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!tab || !tab.active) return;
      if (state.windowId !== null && tab.windowId !== state.windowId) return;
      if (!isNavigationUpdate(changeInfo)) return;
      refresh();
    });
  } catch {
    /* without tab events the sidebar still scans on demand */
  }
}

/** Decide what the sidebar shows for the tab it has just looked at. */
async function followActiveTab() {
  const generation = ++followGeneration;
  const d = state.detection;
  if (!d || !d.ok) {
    showView('idle');
    return;
  }
  const prev = state.target ? state.target.address : null;
  if (d.address === prev && state.analysis) {
    showView('result');
    return;
  }
  if (!shouldRescan(prev, d, state.settings)) {
    showView('idle');
    return;
  }
  // Single-page trading apps swap the URL first and fill in the header a
  // moment later. Give the page's own name one more chance before scanning
  // without it - unless reading the page needs a permission we lack.
  const hasName = d.identityHints && d.identityHints.symbolHint;
  if (!hasName && !d.needsHostPermission) {
    await sleep(1200);
    if (generation !== followGeneration) return;
    await detect();
    if (generation !== followGeneration) return;
    if (!state.detection || !state.detection.ok) {
      showView('idle');
      return;
    }
  }
  await onScanClick();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------
// Per-site read permission
// --------------------------------------------------------------------------

function renderHostPermissionPrompt(result) {
  const strip = $('host-permission');
  const origin = result && result.needsHostPermission;
  if (!origin) {
    strip.hidden = true;
    return;
  }
  $('host-permission-text').textContent = result.ok
    ? `Allow SCAN to read ${result.hostname} so the token's name shows here automatically.`
    : `Allow SCAN to read ${result.hostname} to look for a contract address on the page.`;
  strip.hidden = false;
}

async function onAllowSite() {
  const d = state.detection;
  if (!d || !d.needsHostPermission) return;
  let granted = false;
  try {
    granted = await ext.permissions.request({ origins: [d.needsHostPermission] });
  } catch {
    granted = false;
  }
  if (!granted) return;
  await detect();
  if (state.detection && state.detection.ok) await onScanClick();
}

async function onOpenSidebar() {
  try {
    await ext.sidebarAction.open();
    window.close();
  } catch {
    $('btn-sidebar').textContent = 'View \u203a Sidebar \u203a SCAN';
  }
}

function renderDetectPreview(result) {
  const box = $('detect-preview');
  box.textContent = '';
  const label = el('div', 'detect-label');
  if (result && result.ok && result.confidence === 'ambiguous') {
    renderCandidatePicker(box, label, result);
    return;
  }
  if (result && result.ok) {
    label.textContent = result.method === 'url'
      ? `Detected on ${result.site}`
      : result.matchedTicker && result.identityHints && result.identityHints.symbolHint
        ? `Matched to $${result.identityHints.symbolHint} on the page`
        : 'Detected from page content';
    const addr = el('div', 'detect-token', result.address);
    const chainLabel = (CHAINS[result.chain] || CHAINS.unknown).label;
    const kindNote = result.addressKind === 'token'
      ? ''
      : result.addressKind === 'unknown'
        ? ' - this route does not say whether the address is the mint or the pool'
        : ` - this is a ${result.addressKind} address, not the token contract`;
    const sub = el('div', 'detect-source',
      `${chainLabel}${kindNote}` +
      `${result.confidence === 'ambiguous' ? ' - several candidates found, verify before trusting' : ''}`);
    box.append(label, addr, sub);
    $('btn-scan').disabled = false;
  } else {
    label.textContent = 'No token detected';
    const msg = el('div', 'detect-source', (result && result.message) || 'Unable to automatically identify this token.');
    box.append(label, msg);
    $('btn-scan').disabled = true;
  }
}

/**
 * The page lists several tokens and nothing singles one out (a feed, a
 * watchlist). Scanning whichever sorted first would be a confident wrong
 * answer, so the choice is put to the user instead.
 */
function renderCandidatePicker(box, label, result) {
  const shown = result.identityHints && result.identityHints.symbolHint;
  const n = (result.candidates || []).length;
  label.textContent = 'Several tokens on this page';
  const msg = el('div', 'detect-source', shown
    ? `This page is showing $${shown}, but SCAN could not tell which of the ${n} addresses on it belongs to that token. `
      + 'Open the token\u2019s own page for an exact match, paste its address, or pick one below only if you know it is right.'
    : `${n} token addresses were found on this page and none stands out. `
      + 'Open the token\u2019s own page, paste its address, or pick one below only if you know it is right.');
  box.append(label, msg);

  const list = el('div', 'candidate-list');
  for (const c of result.candidates || []) {
    const row = el('button', 'candidate', shortenAddress(c.address, 6, 6));
    row.type = 'button';
    row.title = `${c.address}\nfound in: ${c.origins.join(', ')}`;
    row.append(el('span', 'candidate-origin', c.origins.join(', ')));
    row.addEventListener('click', () => scanCandidate(c.address));
    list.append(row);
  }
  box.append(list);
  $('btn-scan').disabled = true;
}

async function scanCandidate(address) {
  const family = inferChainFromAddress(address);
  // A hand-picked candidate is not necessarily the token the page is about,
  // so the page's name is deliberately NOT attached to it.
  await startScan({
    address,
    chain: family === 'solana' ? 'solana' : 'unknown',
    addressKind: 'token',
    method: 'picked',
    identityHints: null,
  });
}

async function onScanClick() {
  if (!state.detection || !state.detection.ok) return;
  await startScan({
    address: state.detection.address,
    chain: state.detection.chain,
    addressKind: state.detection.addressKind,
    identityHints: state.detection.identityHints ?? null,
    site: state.detection.site,
    method: state.detection.method,
  });
}

async function onManualScan() {
  const raw = $('manual-address').value;
  const chainChoice = $('manual-chain').value;
  const parsed = validateManualInput(raw, chainChoice === 'auto' ? undefined : chainChoice);
  const errBox = $('manual-error');
  if (!parsed.ok) {
    errBox.textContent = parsed.error;
    errBox.hidden = false;
    return;
  }
  errBox.hidden = true;
  await startScan({ address: parsed.address, chain: parsed.chain, addressKind: 'token', method: 'manual' });
}

async function startScan(target) {
  state.scanning = true;
  state.analysis = null;
  state.snapshot = null;
  state.target = target;
  showView('result');
  renderScanningPlaceholder(target);
  try {
    const res = await ext.runtime.sendMessage({ type: 'SCAN', target });
    if (res && res.ok === false) showError(res.message || 'Scan failed.');
  } catch (err) {
    showError(String((err && err.message) || err));
  }
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

// Element ids are written out in full rather than assembled from fragments, so
// tools/validate-manifest.mjs can prove every lookup resolves against the HTML.
const VIEWS = { idle: 'view-idle', manual: 'view-manual', result: 'view-result', error: 'view-error' };

function showView(name) {
  for (const [view, id] of Object.entries(VIEWS)) {
    $(id).hidden = view !== name;
  }
  $('btn-rescan').hidden = name !== 'result';
}

function showError(message) {
  $('error-message').textContent = message;
  showView('error');
}

function renderScanningPlaceholder(target) {
  $('token-name').textContent = 'Loading…';
  $('token-ticker').textContent = shortenAddress(target.address, 6, 6);
  $('token-chain').textContent = (CHAINS[target.chain] || CHAINS.unknown).label;
  $('token-source').textContent = describeSource(target, target);
  $('token-address').textContent = shortenAddress(target.address);
  for (const id of ['m-price', 'm-mcap', 'm-liq', 'm-vol', 'm-age', 'm-chg']) {
    const node = $(id);
    node.textContent = '…';
    node.className = 'metric-v unknown';
  }
}

function render() {
  const a = state.analysis;
  const s = state.snapshot;
  if (!a || !s) return;

  $('demo-banner').hidden = !a.isMockData;
  // Every stage refused for want of a provider: the user switched demo data
  // off without enabling anything else. Say so instead of showing "--" everywhere.
  const unserved = (s.meta.errors || []).filter((e) => /No data provider available/.test(e.message)).length;
  $('source-banner').hidden = !(unserved > 0 && s.meta.stagesComplete.length === 0 && s.meta.stagesPending.length === 0);

  // --- identity ---
  // With no metadata provider registered there is often no name at all. Say so
  // rather than inventing one - the address is the identifier that matters.
  const name = s.identity.name;
  const symbol = s.identity.symbol;
  const fromPage = typeof s.identity.identitySource === 'string' && s.identity.identitySource.startsWith('page');
  const nameNode = $('token-name');
  const headline = name || symbol || 'Name unavailable';
  nameNode.textContent = headline;
  nameNode.className = name || symbol ? 'token-name' : 'token-name token-name-missing';
  nameNode.title = fromPage
    ? `Read from the page (${s.identity.identitySource}), not from a data provider`
    : '';
  // Do not print the ticker twice when it is standing in as the headline.
  $('token-ticker').textContent = symbol && name
    ? `$${symbol}`
    : shortenAddress(s.identity.address, 6, 6);
  $('token-chain').textContent = (CHAINS[s.identity.chain] || CHAINS.unknown).label;
  $('token-source').textContent = describeSource(state.target, s.identity);
  $('token-address').textContent = shortenAddress(s.identity.address);
  $('token-address').title = s.identity.address || '';

  // --- metrics ---
  setMetric('m-price', formatUsd(pick(s, 'market.priceUsd')));
  setMetric('m-mcap', formatUsd(pick(s, 'market.marketCapUsd')));
  setMetric('m-liq', formatUsd(pick(s, 'market.liquidityUsd')));
  setMetric('m-vol', formatUsd(pick(s, 'market.volume.h24')));
  setMetric('m-age', pick(s, 'market.createdAt') ? formatAge(pick(s, 'market.createdAt'), a.generatedAt) : 'Unknown');
  const chg = pick(s, 'market.priceChange.h1');
  setMetric('m-chg', formatPercent(chg, { signed: true }), isMissing(chg) ? '' : chg >= 0 ? 'up' : 'down');

  // --- scores ---
  renderScore($('opp-score'), $('opp-bar'), $('opp-band'), a.opportunity, a.bands.opportunity);
  renderScore($('risk-score'), $('risk-bar'), $('risk-band'), a.risk, a.bands.risk);

  renderKeySignals(a.keySignals);
  renderAlerts(a);
  renderList('why-list', a.why, 'No standout strengths measured.');
  renderList('concerns-list', a.concerns, 'No concerns triggered.');
  renderBreakdown();
  renderProgress(s);

  const sources = [...new Set((s.meta.sources || []).map((x) => x.split(':')[0]))];
  $('footer-sources').textContent = sources.length ? `src: ${sources.join(', ')}` : 'src: none';
  $('footer-time').textContent = state.scanning ? 'scanning…' : formatRelativeTime(a.generatedAt, Date.now());
}

const KIND_LABELS = {
  pair: 'pair address',
  pool: 'pool address',
  unknown: 'unresolved address',
};

/** "axiom - url - pool address": where the address came from, and what it is.
 *  Lets you check at a glance that the scan is pointed at the right thing. */
function describeSource(target, identity) {
  if (!target) return '--';
  const parts = [];
  if (target.site && target.site !== 'generic') parts.push(target.site);
  if (target.method) {
    parts.push(target.method === 'dom' ? 'page scan' : target.method === 'picked' ? 'picked from page' : target.method);
  }
  const kind = identity && identity.addressKind;
  if (kind && kind !== 'token') parts.push(KIND_LABELS[kind] ?? kind);
  if (identity && identity.resolvedBy) parts.push(`resolved via ${identity.resolvedBy}`);
  return parts.length ? parts.join(' \u00b7 ') : '--';
}

function setMetric(id, text, extra = '') {
  const node = $(id);
  node.textContent = text;
  node.className = `metric-v${text === 'Unknown' ? ' unknown' : ''}${extra ? ` ${extra}` : ''}`;
}

function renderScore(valueNode, barNode, bandNode, score, band) {
  if (score.insufficientData || !Number.isFinite(score.score)) {
    valueNode.textContent = '--';
    valueNode.className = 'lvl-unknown';
    barNode.style.width = '0%';
    barNode.className = 'score-bar-fill bg-unknown';
    bandNode.textContent = 'Insufficient data';
    bandNode.className = 'score-band lvl-unknown';
    return;
  }
  valueNode.textContent = String(score.score);
  valueNode.className = `lvl-${band.level}`;
  barNode.style.width = `${score.score}%`;
  barNode.className = `score-bar-fill bg-${band.level}`;
  const cov = Math.round((score.coverage ?? 1) * 100);
  bandNode.textContent = cov < 100 ? `${band.label} - ${cov}% data` : band.label;
  bandNode.className = `score-band lvl-${band.level}`;
}

function renderKeySignals(signals) {
  const box = $('key-signals');
  box.textContent = '';
  for (const sig of signals) {
    const row = el('div', 'signal-row');
    row.append(el('span', `dot bg-${sig.level}`), el('span', 'signal-name', sig.label));
    const text = el('span', `signal-text lvl-${sig.level}`, sig.text);
    text.title = sig.text;
    row.append(text);
    box.append(row);
  }
}

function renderAlerts(analysis) {
  const box = $('alerts');
  box.textContent = '';
  const all = analysis.alerts || [];
  const shown = state.showAllAlerts ? all : all.slice(0, 5);
  if (!shown.length) {
    box.append(el('div', 'alert level-unknown', 'No signals generated - not enough data.'));
  }
  for (const alert of shown) {
    const node = el('div', `alert level-${alert.level}`);
    node.append(el('span', 'alert-icon', iconFor(alert)));
    const body = el('div', 'alert-body');
    body.append(el('div', 'alert-text', alert.text));
    if (alert.detail) body.append(el('div', 'alert-detail', alert.detail));
    node.append(body);
    box.append(node);
  }
  const more = $('btn-more-alerts');
  more.hidden = all.length <= 5;
  more.textContent = state.showAllAlerts ? 'Show fewer signals' : `Show all ${all.length} signals`;
}

function iconFor(alert) {
  if (alert.level === 'bad') return '\u{1F6A8}';
  if (alert.level === 'warn') return '⚠';
  if (alert.level === 'good') return '✓';
  return '?';
}

function renderList(id, items, emptyText) {
  const list = $(id);
  list.textContent = '';
  if (!items || !items.length) {
    list.append(el('li', 'empty', emptyText));
    return;
  }
  for (const item of items) list.append(el('li', '', item));
}

function toggleBreakdown(which) {
  state.expanded = state.expanded === which ? null : which;
  $('card-opp').setAttribute('aria-expanded', String(state.expanded === 'opportunity'));
  $('card-risk').setAttribute('aria-expanded', String(state.expanded === 'risk'));
  renderBreakdown();
}

function renderBreakdown() {
  const box = $('breakdown');
  box.textContent = '';
  if (!state.expanded || !state.analysis) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const a = state.analysis;

  if (state.expanded === 'opportunity') {
    const o = a.opportunity;
    box.append(el('div', 'bd-title',
      `OPPORTUNITY SCORE: ${o.insufficientData ? 'INSUFFICIENT DATA' : o.score}`));
    for (const c of o.components) {
      const row = el('div', 'bd-row');
      const head = el('div', 'bd-head');
      head.append(el('span', 'bd-name', c.label));
      const right = el('span', '');
      right.append(el('span', `bd-num ${c.available ? levelClass(c.score) : 'lvl-unknown'}`,
        c.available ? String(c.score) : 'n/a'));
      right.append(el('span', 'bd-weight', ` w${c.weight}${c.available ? ` → ${c.effectiveWeight}%` : ''}`));
      head.append(right);
      row.append(head);
      if (c.available) {
        for (const reason of c.reasons.slice(0, 2)) row.append(el('div', 'bd-reason', reason));
      } else {
        row.append(el('div', 'bd-reason bd-missing', `Insufficient data: missing ${c.missing.join(', ')}.`));
      }
      box.append(row);
    }
    box.append(el('div', 'bd-note',
      `Weights are normalised over the ${Math.round(o.coverage * 100)}% of inputs that returned data. ` +
      'This is a standardised measurement of current conditions, not a prediction of price.'));
  } else {
    const r = a.risk;
    box.append(el('div', 'bd-title', `RISK SCORE: ${r.insufficientData ? 'INSUFFICIENT DATA' : r.score}`));
    for (const f of r.factors) {
      const row = el('div', 'bd-row');
      const head = el('div', 'bd-head');
      head.append(el('span', 'bd-name', f.label));
      const right = el('span', '');
      right.append(el('span', `bd-num ${f.severity >= 0.6 ? 'lvl-bad' : f.severity >= 0.25 ? 'lvl-warn' : 'lvl-good'}`,
        `${f.points}/${f.maxPoints}`));
      head.append(right);
      row.append(head, el('div', 'bd-reason', f.message));
      if (f.evidence) row.append(el('div', 'bd-reason bd-missing', f.evidence));
      box.append(row);
    }
    for (const u of r.unverified) {
      const row = el('div', 'bd-row');
      const head = el('div', 'bd-head');
      head.append(el('span', 'bd-name', u.label));
      head.append(el('span', 'bd-num lvl-unknown', 'n/a'));
      row.append(head, el('div', 'bd-reason bd-missing', u.message));
      box.append(row);
    }
    box.append(el('div', 'bd-note',
      'Risk is scored only over checks that could be evaluated. Unverified checks are not counted as safe.'));
  }
}

function levelClass(score) {
  if (score >= 70) return 'lvl-good';
  if (score >= 45) return 'lvl-warn';
  return 'lvl-bad';
}

function renderProgress(snapshot) {
  const box = $('progress');
  box.textContent = '';
  const done = new Set(snapshot.meta.stagesComplete || []);
  const empty = new Set(snapshot.meta.stagesEmpty || []);
  const failed = new Set((snapshot.meta.errors || []).map((e) => e.stage));
  const pending = new Set(snapshot.meta.stagesPending || []);
  const labels = { identity: 'token', market: 'market', holders: 'holders', contract: 'contract', dev: 'dev', social: 'social' };
  for (const [stage, label] of Object.entries(labels)) {
    // "no data" is dim, not red: the provider worked, the data is not there.
    let cls = '';
    let mark = '\u2026';
    if (done.has(stage)) { cls = 'done'; mark = '\u2713'; }
    else if (empty.has(stage)) { cls = 'empty'; mark = 'no data'; }
    else if (failed.has(stage)) { cls = 'failed'; mark = '\u2717'; }
    else if (pending.has(stage)) { cls = 'pending'; }
    const chip = el('span', `stage ${cls}`, `${label} ${mark}`);
    if (failed.has(stage)) {
      const err = (snapshot.meta.errors || []).find((e) => e.stage === stage);
      if (err) chip.title = err.message;
    }
    box.append(chip);
  }
}

/**
 * Everything needed to diagnose a wrong name or a blank panel without a
 * screenshot: what the page exposes, what detection decided, and what each
 * scan stage did. Copied to the clipboard only; nothing leaves the machine.
 */
async function copyDebugReport() {
  const d = state.detection || {};
  const s = state.snapshot;
  const a = state.analysis;
  const report = {
    generated: new Date().toISOString(),
    extension: (ext.runtime.getManifest && ext.runtime.getManifest().version) || null,
    tabUrl: d.tabUrl || null,
    detection: d.ok
      ? { address: d.address, chain: d.chain, addressKind: d.addressKind, site: d.site, method: d.method, confidence: d.confidence ?? null, matchedTicker: d.matchedTicker ?? null, candidates: d.candidates ?? null }
      : { ok: false, reason: d.reason, message: d.message },
    identityHints: d.identityHints || null,
    page: d.pageDebug || null,
    scan: s ? {
      identity: s.identity,
      stagesComplete: s.meta.stagesComplete,
      stagesEmpty: s.meta.stagesEmpty,
      stagesPending: s.meta.stagesPending,
      errors: s.meta.errors,
      sources: s.meta.sources,
      isMockData: s.meta.isMockData,
    } : null,
    scores: a ? {
      opportunity: { score: a.opportunity.score, coverage: a.opportunity.coverage, insufficient: a.opportunity.insufficientData },
      risk: { score: a.risk.score, coverage: a.risk.coverage, insufficient: a.risk.insufficientData },
      completeness: a.completeness,
    } : null,
  };
  const btn = $('btn-debug');
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    btn.textContent = 'copied';
  } catch {
    btn.textContent = 'copy failed';
  }
  setTimeout(() => { btn.textContent = 'copy debug'; }, 1200);
}

async function copyAddress() {
  const address = state.snapshot && state.snapshot.identity.address;
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
    const node = $('token-address');
    const original = node.textContent;
    node.textContent = 'copied';
    setTimeout(() => { node.textContent = original; }, 900);
  } catch {
    /* clipboard denied - not worth an error state */
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
