/**
 * Settings page. Everything written here is local-only (browser.storage.local)
 * and is read by the background on the next scan.
 */

import { getSettings, saveSettings, resetSettings, clearAllLocalData } from '../storage/storage.js';
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
  let providers = [];
  try {
    const res = await ext.runtime.sendMessage({ type: 'PROVIDERS' });
    providers = (res && res.providers) || [];
  } catch {
    providers = [];
  }
  if (!providers.length) {
    box.append(rowEl('No providers registered.', ''));
    return;
  }
  for (const p of providers) {
    box.append(rowEl(`${p.label} - stages: ${p.stages.join(', ')}`, p.isMock ? 'DEMO DATA' : p.requiresKey ? 'NEEDS KEY' : 'LIVE'));
  }
}

function rowEl(text, tag) {
  const node = document.createElement('div');
  node.className = 'provider';
  const left = document.createElement('span');
  left.textContent = text;
  node.append(left);
  if (tag) {
    const right = document.createElement('span');
    right.className = 'provider-tag';
    right.textContent = tag;
    node.append(right);
  }
  return node;
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
