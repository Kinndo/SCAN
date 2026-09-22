/**
 * Address validation and chain inference.
 *
 * CANONICAL SOURCE for the address regexes. The content script cannot import ES
 * modules, so src/content/adapters/base.js repeats these two patterns verbatim.
 * tests/adapters.test.js asserts the two copies have not drifted apart.
 */

import { CHAINS, NON_TOKEN_ADDRESSES } from '../core/constants.js';

// Base58 alphabet: no 0, O, I, l. Solana mints are 32-44 chars.
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// EVM: 0x + 40 hex chars.
export const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Loose scanning patterns (unanchored) used when sweeping page text. */
export const SOLANA_SCAN_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
export const EVM_SCAN_RE = /\b0x[a-fA-F0-9]{40}\b/g;

export function isSolanaAddress(value) {
  return typeof value === 'string' && SOLANA_ADDRESS_RE.test(value);
}

export function isEvmAddress(value) {
  return typeof value === 'string' && EVM_ADDRESS_RE.test(value);
}

export function isValidAddress(value) {
  return isSolanaAddress(value) || isEvmAddress(value);
}

/**
 * Infer the address *family* from its shape. This can distinguish Solana from
 * EVM, but NOT one EVM chain from another - every EVM chain shares the format.
 * Returns 'unknown' when the shape is EVM but the specific chain is unproven.
 */
export function inferChainFromAddress(value) {
  if (isSolanaAddress(value)) return 'solana';
  if (isEvmAddress(value)) return 'evm-family';
  return 'unknown';
}

/** EVM addresses are case-insensitive; lowercase them so cache keys match. */
export function normalizeAddress(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (isEvmAddress(trimmed)) return trimmed.toLowerCase();
  if (isSolanaAddress(trimmed)) return trimmed; // base58 IS case sensitive
  return null;
}

export function isNonTokenAddress(value) {
  if (typeof value !== 'string') return false;
  return NON_TOKEN_ADDRESSES.has(value) || NON_TOKEN_ADDRESSES.has(value.toLowerCase());
}

export function isKnownChain(chain) {
  return typeof chain === 'string' && Object.prototype.hasOwnProperty.call(CHAINS, chain);
}

/**
 * Validate free-text the user pasted into the manual-entry box.
 * Accepts a bare address, or a URL/blob of text containing exactly one.
 * @returns {{ok: boolean, address?: string, chain?: string, error?: string}}
 */
export function validateManualInput(raw, preferredChain) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Enter a contract address.' };
  }
  const text = raw.trim();

  let address = normalizeAddress(text);
  if (!address) {
    // Pull candidates out of a pasted URL or sentence.
    const found = [...(text.match(EVM_SCAN_RE) || []), ...(text.match(SOLANA_SCAN_RE) || [])]
      .map(normalizeAddress)
      .filter((a) => a && !isNonTokenAddress(a));
    const unique = [...new Set(found)];
    if (unique.length === 0) {
      return { ok: false, error: 'No valid Solana or EVM contract address found in that text.' };
    }
    if (unique.length > 1) {
      return { ok: false, error: `Found ${unique.length} possible addresses. Paste just the one you want.` };
    }
    address = unique[0];
  }

  if (isNonTokenAddress(address)) {
    return { ok: false, error: 'That is a system / wrapped-asset address, not a memecoin contract.' };
  }

  const family = inferChainFromAddress(address);
  let chain;
  if (family === 'solana') {
    chain = 'solana';
  } else if (family === 'evm-family') {
    // Cannot tell Ethereum from Base from BSC by shape alone. Use the user's
    // preferred chain if they gave one, otherwise flag it as unresolved.
    chain = isKnownChain(preferredChain) && CHAINS[preferredChain].addressKind === 'evm'
      ? preferredChain
      : 'unknown';
  } else {
    return { ok: false, error: 'Address format not recognised.' };
  }

  return { ok: true, address, chain, addressKind: 'token' };
}
