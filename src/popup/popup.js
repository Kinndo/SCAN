/**
 * Popup controller.
 *
 * Renders whatever the background has so far and re-renders on every stage
 * update, so the dashboard fills in progressively instead of blocking on the
 * slowest request. All text goes in via textContent - page-derived strings are
 * never interpolated as HTML.
 */

import { formatUsd, formatPercent, formatAge, formatRelativeTime, shortenAddress, isMissing } from '../utils/formatting.js';
import { validateManualInput } from '../utils/validation.js';
import { pick } from '../core/model.js';
import { CHAINS } from '../core/constants.js';

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
};

let port = null;

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

init();

async function init() {
  wireEvents();
  connect();
  await detect();
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
}

// --------------------------------------------------------------------------
// Detection + scanning
// --------------------------------------------------------------------------

async function detect() {
  try {
    const result = await ext.runtime.sendMessage({ type: 'DETECT' });
    state.detection = result;
    renderDetectPreview(result);
  } catch (err) {
    state.detection = { ok: false, message: String((err && err.message) || err) };
    renderDetectPreview(state.detection);
  }
}

function renderDetectPreview(result) {
  const box = $('detect-preview');
  box.textContent = '';
  const label = el('div', 'detect-label');
  if (result && result.ok) {
    label.textContent = result.method === 'url'
      ? `Detected on ${result.site}`
      : 'Detected from page content';
    const addr = el('div', 'detect-token', result.address);
    const chainLabel = (CHAINS[result.chain] || CHAINS.unknown).label;
    const sub = el('div', 'detect-source',
      `${chainLabel}${result.addressKind !== 'token' ? ` - ${result.addressKind} address` : ''}` +
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

async function onScanClick() {
  if (!state.detection || !state.detection.ok) return;
  await startScan({
    address: state.detection.address,
    chain: state.detection.chain,
    addressKind: state.detection.addressKind,
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
  await startScan({ address: parsed.address, chain: parsed.chain, addressKind: 'token' });
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

  // --- identity ---
  $('token-name').textContent = s.identity.name || 'Unknown token';
  $('token-ticker').textContent = s.identity.symbol ? `$${s.identity.symbol}` : shortenAddress(s.identity.address, 6, 6);
  $('token-chain').textContent = (CHAINS[s.identity.chain] || CHAINS.unknown).label;
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
  const failed = new Set((snapshot.meta.errors || []).map((e) => e.stage));
  const pending = new Set(snapshot.meta.stagesPending || []);
  const labels = { identity: 'token', market: 'market', holders: 'holders', contract: 'contract', dev: 'dev', social: 'social' };
  for (const [stage, label] of Object.entries(labels)) {
    const cls = done.has(stage) ? 'done' : failed.has(stage) ? 'failed' : pending.has(stage) ? 'pending' : '';
    const mark = done.has(stage) ? '✓' : failed.has(stage) ? '✗' : '…';
    box.append(el('span', `stage ${cls}`, `${label} ${mark}`));
  }
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
