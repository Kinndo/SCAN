#!/usr/bin/env node
/**
 * Pre-package checks. Catches the class of mistakes that only show up as a
 * silent failure after loading the add-on in Firefox:
 *  - manifest references a file that does not exist
 *  - an HTML page references a stylesheet or script that does not exist
 *  - a source file does not parse
 *  - a credential was hard-coded into the bundle
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const problems = [];
const notes = [];

const rel = (p) => p.replace(`${root}/`, '');

function requireFile(path, why) {
  if (!existsSync(join(root, path))) problems.push(`missing file: ${path} (${why})`);
}

// --- manifest --------------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
if (!manifest.browser_specific_settings?.gecko?.id) {
  problems.push('browser_specific_settings.gecko.id is required for a Firefox add-on');
}
if (manifest.background?.service_worker) {
  problems.push('Firefox MV3 uses background.scripts (event page), not background.service_worker');
}

for (const script of manifest.background?.scripts ?? []) requireFile(script, 'background.scripts');
if (manifest.action?.default_popup) requireFile(manifest.action.default_popup, 'action.default_popup');
if (manifest.options_ui?.page) requireFile(manifest.options_ui.page, 'options_ui.page');
for (const icon of Object.values(manifest.icons ?? {})) requireFile(icon, 'icons');
for (const icon of Object.values(manifest.action?.default_icon ?? {})) requireFile(icon, 'action.default_icon');

// Files the background injects on demand are not listed in the manifest, so
// check them against the background source directly.
const backgroundSrc = readFileSync(join(root, 'src/background/background.js'), 'utf8');
const injected = [...backgroundSrc.matchAll(/'(src\/content\/[^']+\.js)'/g)].map((m) => m[1]);
if (injected.length === 0) problems.push('background does not reference any content script files');
for (const file of injected) requireFile(file, 'injected by scripting.executeScript');

// --- HTML asset references -------------------------------------------------
for (const page of ['src/popup/popup.html', 'src/settings/settings.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  const dir = dirname(join(root, page));
  const refs = [
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const ref of refs) {
    if (/^https?:/.test(ref)) {
      problems.push(`${page} loads a remote asset (${ref}); extension pages must bundle everything`);
      continue;
    }
    if (!existsSync(resolve(dir, ref))) problems.push(`${page} references missing asset: ${ref}`);
  }
  if (/<script(?![^>]*\bsrc=)/.test(html)) {
    problems.push(`${page} contains an inline <script>, which the extension CSP blocks`);
  }
}

// --- source files parse ----------------------------------------------------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const sources = walk(join(root, 'src'));
for (const file of sources) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`syntax error in ${rel(file)}: ${String(err.stderr || err).split('\n')[0]}`);
  }
}
notes.push(`${sources.length} source files parsed`);

// --- no hard-coded credentials --------------------------------------------
const SECRET_PATTERNS = [
  /(api[_-]?key|apikey|secret|token|password|mnemonic|seed[_-]?phrase|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i,
  /\bsk-[A-Za-z0-9]{16,}\b/,
];
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) problems.push(`possible hard-coded credential in ${rel(file)}`);
  }
}
notes.push('no hard-coded credentials found');

// --- privacy guarantee -----------------------------------------------------
// The extension must have no wallet/signing surface at all.
const FORBIDDEN_APIS = /\b(window\.ethereum|window\.solana|eth_sendTransaction|personal_sign|signTransaction|signAllTransactions|Keypair\.fromSecretKey)\b/;
for (const file of sources) {
  if (FORBIDDEN_APIS.test(readFileSync(file, 'utf8'))) {
    problems.push(`${rel(file)} touches a wallet/signing API; this extension must be analysis-only`);
  }
}
notes.push('no wallet or signing APIs referenced');

// --- report ----------------------------------------------------------------
for (const note of notes) console.log(`  ok  ${note}`);
if (problems.length) {
  console.error('\nvalidation FAILED:');
  for (const p of problems) console.error(`  x  ${p}`);
  process.exit(1);
}
console.log(`  ok  manifest and page references resolve\n\nvalidate: PASS (${manifest.name} v${manifest.version})`);
