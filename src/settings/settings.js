/**
 * Settings page. Everything written here is local-only (browser.storage.local)
 * and is read by the background on the next scan.
 */

import { getSettings, saveSettings, resetSettings, clearAllLocalData, getProviderConfig, saveProviderConfig } from '../storage/storage.js';
import { DEFAULT_OPPORTUNITY_WEIGHTS, DEFAULT_RISK_WEIGHTS, PROFILE_PRESETS, applyProfile } from '../scoring/config.js';
import { CHAIN_IDS, CHAINS } from '../core/constants.js';

const ext = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

const NUMERIC_FIELDS = [
  'minLiquidityUsd', 'minMarketCapUsd', 'maxMarketCapUsd',
  'maxTop10ConcentrationPct', 'minTokenAgeMinutes', 'maxSignalsShown',
];

const LABELS = {
  momentum: 'Momentum', volumeToMcap: 'Volume / Market Cap', liquidity: 'Liquidity',
  buySellPressure: 'Buy/Sell Pressure', holderGrowth: 'Holder Growth',
  marketCapContext: 'Market Cap Context', socialPresence: 'Social Presence', walletActivity: 'Wallet Activity',
  lowLiquidityAbsolute: 'Liquidity depth', liquidityToMarketCap: 'Liquidity vs market cap',
  holderConcentration: 'Holder concentration', singleWhale: 'Largest non-LP holder',
  devHoldings: 'Deployer holdings', devSelling: 'Deployer selling', tokenAge: 'Token age',
  mintAuthority: 'Mint authority', freezeAuthority: 'Freeze authority', lpNotSecured: 'Liquidity lock',
  honeypotOrTax: 'Honeypot / tax', abnormalVolume: 'Volume plausibility', sellPressure: 'Sell pressure',
};

let settings = null;

init();

async function init() {
  settings = await getSettings();
  buildChains();
  buildWeights('opp-weights', DEFAULT_OPPORTUNITY_WEIGHTS, 'opportunityWeights');
  buildWeights('risk-weights', DEFAULT_RISK_WEIGHTS, 'riskWeights');
  await buildProviders();
  populate();

  $('btn-save').addEventListener('click', onSave);
  $('demoData').addEventListener('change', onDemoToggle);
  $('btn-copy-test').addEventListener('click', copyTestOutput);
  $('btn-reset').addEventListener('click', onReset);
  $('btn-clear').addEventListener('click', onClear);
  for (const btn of document.querySelectorAll('.profile-btn')) {
    btn.addEventListener('click', () => {
      settings = applyProfile(collect(), btn.dataset.profile);
      populate();
    });
  }
}

function buildChains() {
  const box = $('chains');
  box.textContent = '';
  for (const id of CHAIN_IDS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = id;
    input.dataset.chain = id;
    label.append(input, document.createTextNode(CHAINS[id].label));
    box.append(label);
  }
}

function buildWeights(containerId, defaults, group) {
  const box = $(containerId);
  box.textContent = '';
  for (const key of Object.keys(defaults)) {
    const label = document.createElement('label');
    label.append(document.createTextNode(LABELS[key] || key));
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'input';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.dataset.group = group;
    input.dataset.key = key;
    input.addEventListener('input', updateTotals);
    label.append(input);
    box.append(label);
  }
}

async function buildProviders() {
  const box = $('providers');
  box.textContent = '';
  let info = { demoData: true, providers: [] };
  try {
    info = await ext.runtime.sendMessage({ type: 'PROVIDERS' });
  } catch {
    /* background unavailable */
  }
  $('demoData').checked = info.demoData !== false;

  const real = (info.providers || []).filter((p) => !p.isMock);
  if (!real.length) {
    box.append(rowEl('No data providers registered.', ''));
    return;
  }
  for (const p of real) {
    const row = document.createElement('div');
    row.className = 'provider';

    const main = document.createElement('div');
    main.className = 'provider-main';
    const name = document.createElement('span');
    name.className = 'provider-name';
    name.textContent = p.label;
    const sub = document.createElement('span');
    sub.className = 'provider-sub';
    sub.textContent = `${p.stages.join(', ')}${p.canResolve ? ' + pair\u2192token' : ''} \u00b7 ${p.chains === '*' ? 'all chains' : p.chains.join(', ')}${p.requiresKey ? ' \u00b7 needs key' : ' \u00b7 no key'}`;
    main.append(name, sub);

    const tag = document.createElement('span');
    tag.className = `provider-tag ${p.configured ? 'live' : 'off'}`;
    tag.textContent = p.configured ? 'ON' : 'OFF';

    const actions = document.createElement('div');
    actions.className = 'provider-actions';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn';
    toggle.textContent = p.configured ? 'Disable' : 'Enable';
    toggle.addEventListener('click', () => (p.configured ? disableProvider(p) : enableProvider(p)));
    actions.append(toggle);
    if (p.testable) {
      const test = document.createElement('button');
      test.type = 'button';
      test.className = 'icon-btn';
      test.textContent = 'Test';
      test.addEventListener('click', () => runProviderTest(p));
      actions.append(test);
    }

    row.append(main, tag, actions);
    box.append(row);
  }
}

/**
 * Enabling a real provider: ask Firefox for that API's origin (must run from a
 * click), record it, and switch demo data off so figures are never mixed.
 */
async function enableProvider(p) {
  let granted = true;
  if (p.origins && p.origins.length) {
    try {
      granted = await ext.permissions.request({ origins: p.origins });
    } catch (err) {
      flash(`Permission request failed: ${String((err && err.message) || err)}`);
      return;
    }
  }
  if (!granted) {
    flash(`${p.label} not enabled - permission was declined.`);
    return;
  }
  const config = await getProviderConfig();
  config[p.id] = { ...(config[p.id] || {}), enabled: true };
  config.demoData = false;
  await saveProviderConfig(config);
  flash(`${p.label} enabled. Demo data switched off.`);
  await buildProviders();
}

async function disableProvider(p) {
  const config = await getProviderConfig();
  config[p.id] = { ...(config[p.id] || {}), enabled: false };
  await saveProviderConfig(config);
  flash(`${p.label} disabled.`);
  await buildProviders();
}

async function runProviderTest(p) {
  const box = $('provider-test');
  const out = $('provider-test-output');
  $('provider-test-title').textContent = `${p.label} \u00b7 testing\u2026`;
  out.textContent = '';
  box.hidden = false;
  let result;
  try {
    result = await ext.runtime.sendMessage({ type: 'PROVIDER_TEST', id: p.id });
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }
  $('provider-test-title').textContent = `${p.label} \u00b7 ${result && result.ok ? 'OK' : 'FAILED'}${result && result.ms != null ? ` \u00b7 ${result.ms}ms` : ''}`;
  out.textContent = JSON.stringify(result, null, 2);
}

async function onDemoToggle() {
  const config = await getProviderConfig();
  config.demoData = $('demoData').checked;
  await saveProviderConfig(config);
  flash(config.demoData ? 'Demo data on.' : 'Demo data off.');
}

async function copyTestOutput() {
  try {
    await navigator.clipboard.writeText($('provider-test-output').textContent);
    flash('Test output copied.');
  } catch {
    flash('Copy failed - select the text and copy it manually.');
  }
}

function populate() {
  for (const key of NUMERIC_FIELDS) $(key).value = settings[key];
  $('autoScanInSidebar').checked = settings.autoScanInSidebar !== false;
  for (const input of document.querySelectorAll('[data-chain]')) {
    input.checked = settings.preferredChains.includes(input.dataset.chain);
  }
  for (const input of document.querySelectorAll('[data-group]')) {
    const group = settings[input.dataset.group] || {};
    input.value = group[input.dataset.key] ?? 0;
  }
  for (const btn of document.querySelectorAll('.profile-btn')) {
    btn.classList.toggle('active', btn.dataset.profile === settings.profile);
  }
  $('profile-current').textContent = `Current profile: ${settings.profile}`;
  updateTotals();
}

function collect() {
  const next = { ...settings };
  for (const key of NUMERIC_FIELDS) {
    const v = Number($(key).value);
    if (Number.isFinite(v)) next[key] = v;
  }
  next.autoScanInSidebar = $('autoScanInSidebar').checked;
  next.preferredChains = [...document.querySelectorAll('[data-chain]')]
    .filter((i) => i.checked).map((i) => i.dataset.chain);
  next.opportunityWeights = { ...next.opportunityWeights };
  next.riskWeights = { ...next.riskWeights };
  for (const input of document.querySelectorAll('[data-group]')) {
    const v = Number(input.value);
    next[input.dataset.group][input.dataset.key] = Number.isFinite(v) ? v : 0;
  }
  return next;
}

function updateTotals() {
  let total = 0;
  for (const input of document.querySelectorAll('[data-group="opportunityWeights"]')) {
    total += Number(input.value) || 0;
  }
  $('opp-total').textContent = String(total);
}

async function onSave() {
  settings = collect();
  // Editing a threshold by hand may no longer match any preset - re-derive it
  // rather than leaving a stale profile label on the page.
  settings.profile = inferProfile(settings);
  await saveSettings(settings);
  populate();
  flash('Settings saved.');
}

function inferProfile(next) {
  for (const [name, preset] of Object.entries(PROFILE_PRESETS)) {
    if (Object.entries(preset).every(([k, v]) => Number(next[k]) === v)) return name;
  }
  return 'custom';
}

async function onReset() {
  settings = await resetSettings();
  populate();
  flash('Reset to defaults.');
}

async function onClear() {
  await clearAllLocalData();
  settings = await getSettings();
  populate();
  flash('All local data cleared.');
}

function flash(message) {
  const node = $('status');
  node.textContent = message;
  node.hidden = false;
  setTimeout(() => { node.hidden = true; }, 2200);
}
