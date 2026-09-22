/**
 * URL-based token detection.
 *
 * URL parsing is the primary detection strategy because it is far more stable
 * than DOM scraping - trading sites restyle constantly but rarely change their
 * route shape. The DOM adapter (content script) is only the fallback.
 *
 * NOTE ON VERIFICATION: these route patterns were written offline and have NOT
 * been confirmed against the live sites in this build. That is deliberately
 * low-risk: a wrong pattern simply fails to match, and detection falls through
 * to the DOM adapter and then to manual entry. Every candidate must still pass
 * address validation before it is used. Add or fix a site by editing SITES
 * below - nothing else needs to change.
 */

import { isValidAddress, normalizeAddress, isNonTokenAddress, inferChainFromAddress } from '../utils/validation.js';

/** Map a site's chain slug onto our canonical chain id. */
const CHAIN_SLUGS = {
  solana: 'solana', sol: 'solana',
  ethereum: 'ethereum', eth: 'ethereum', ether: 'ethereum',
  base: 'base',
  bsc: 'bsc', bnb: 'bsc', binance: 'bsc', 'binance-smart-chain': 'bsc',
  arbitrum: 'arbitrum', arb: 'arbitrum', 'arbitrum-one': 'arbitrum',
  polygon: 'polygon', matic: 'polygon', 'polygon-pos': 'polygon',
  avalanche: 'avalanche', avax: 'avalanche',
};

export function normalizeChainSlug(slug) {
  if (!slug) return null;
  return CHAIN_SLUGS[String(slug).toLowerCase()] ?? null;
}

/**
 * Each site declares how to pull {chain, address, addressKind} out of a URL.
 * addressKind: 'token' (the mint/contract itself) or 'pair'/'pool' (an AMM pool
 * address that must be resolved to its base token by a data provider).
 */
export const SITES = [
  {
    id: 'dexscreener',
    match: /(^|\.)dexscreener\.com$/i,
    // /{chainSlug}/{pairAddress}
    extract: (u) => {
      const [chainSlug, addr] = pathParts(u);
      const chain = normalizeChainSlug(chainSlug);
      return chain && addr ? { chain, address: addr, addressKind: 'pair' } : null;
    },
  },
  {
    id: 'geckoterminal',
    match: /(^|\.)geckoterminal\.com$/i,
    // /{network}/pools/{poolAddress}
    extract: (u) => {
      const p = pathParts(u);
      const chain = normalizeChainSlug(p[0]);
      if (chain && p[1] === 'pools' && p[2]) return { chain, address: p[2], addressKind: 'pool' };
      if (chain && p[1] === 'tokens' && p[2]) return { chain, address: p[2], addressKind: 'token' };
      return null;
    },
  },
  {
    id: 'birdeye',
    match: /(^|\.)birdeye\.so$/i,
    // /token/{address}?chain=solana
    extract: (u) => {
      const p = pathParts(u);
      const idx = p.indexOf('token');
      if (idx === -1 || !p[idx + 1]) return null;
      const chain = normalizeChainSlug(u.searchParams.get('chain')) ?? 'solana';
      return { chain, address: p[idx + 1], addressKind: 'token' };
    },
  },
  {
    id: 'pumpfun',
    match: /(^|\.)pump\.fun$/i,
    // /coin/{mint}  (also bare /{mint} on some routes)
    extract: (u) => {
      const p = pathParts(u);
      const addr = p[0] === 'coin' ? p[1] : p[0];
      return addr ? { chain: 'solana', address: addr, addressKind: 'token' } : null;
    },
  },
  {
    id: 'gmgn',
    match: /(^|\.)gmgn\.(ai|cc)$/i,
    // /{chainSlug}/token/{address}
    extract: (u) => {
      const p = pathParts(u);
      const chain = normalizeChainSlug(p[0]);
      const idx = p.indexOf('token');
      if (chain && idx !== -1 && p[idx + 1]) return { chain, address: p[idx + 1], addressKind: 'token' };
      return null;
    },
  },
  {
    id: 'dextools',
    match: /(^|\.)dextools\.io$/i,
    // /app/{lang}/{chainSlug}/pair-explorer/{pairAddress}
    extract: (u) => {
      const p = pathParts(u);
      const idx = p.indexOf('pair-explorer');
      if (idx === -1 || !p[idx + 1]) return null;
      const chain = normalizeChainSlug(p[idx - 1]);
      return chain ? { chain, address: p[idx + 1], addressKind: 'pair' } : null;
    },
  },
  {
    id: 'photon',
    match: /photon(-sol)?\.tinyastro\.io$/i,
    // /en/lp/{poolAddress}
    extract: (u) => {
      const p = pathParts(u);
      const idx = p.indexOf('lp');
      return idx !== -1 && p[idx + 1]
        ? { chain: 'solana', address: p[idx + 1], addressKind: 'pool' }
        : null;
    },
  },
  {
    id: 'axiom',
    match: /(^|\.)axiom\.trade$/i,
    // /meme/{address}
    extract: (u) => {
      const p = pathParts(u);
      const idx = p.indexOf('meme');
      return idx !== -1 && p[idx + 1]
        ? { chain: 'solana', address: p[idx + 1], addressKind: 'token' }
        : null;
    },
  },
  {
    id: 'solscan',
    match: /(^|\.)solscan\.io$/i,
    extract: (u) => {
      const p = pathParts(u);
      const idx = p.indexOf('token');
      return idx !== -1 && p[idx + 1]
        ? { chain: 'solana', address: p[idx + 1], addressKind: 'token' }
        : null;
    },
  },
  {
    id: 'evm-explorer',
    match: /(^|\.)(etherscan\.io|basescan\.org|bscscan\.com|arbiscan\.io|polygonscan\.com|snowscan\.xyz)$/i,
    extract: (u) => {
      const p = pathParts(u);
      const idx = p.indexOf('token');
      if (idx === -1 || !p[idx + 1]) return null;
      const host = u.hostname.toLowerCase();
      const chain = host.includes('basescan') ? 'base'
        : host.includes('bscscan') ? 'bsc'
        : host.includes('arbiscan') ? 'arbitrum'
        : host.includes('polygonscan') ? 'polygon'
        : host.includes('snowscan') ? 'avalanche'
        : 'ethereum';
      return { chain, address: p[idx + 1], addressKind: 'token' };
    },
  },
  {
    id: 'jupiter',
    match: /(^|\.)jup\.ag$/i,
    // /swap/{input}-{output} or ?outputMint=
    extract: (u) => {
      const q = u.searchParams.get('outputMint') || u.searchParams.get('outputCurrency');
      if (q) return { chain: 'solana', address: q, addressKind: 'token' };
      const p = pathParts(u);
      const idx = p.indexOf('swap');
      if (idx !== -1 && p[idx + 1] && p[idx + 1].includes('-')) {
        const parts = p[idx + 1].split('-');
        const out = parts[parts.length - 1];
        return out ? { chain: 'solana', address: out, addressKind: 'token' } : null;
      }
      return null;
    },
  },
];

function pathParts(url) {
  return url.pathname.split('/').filter(Boolean);
}

/**
 * Detect a token from a page URL.
 * @returns {{address:string, chain:string, addressKind:string, site:string, method:string}|null}
 */
export function detectFromUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  for (const site of SITES) {
    if (!site.match.test(url.hostname)) continue;
    let hit = null;
    try {
      hit = site.extract(url);
    } catch {
      hit = null;
    }
    if (!hit || !hit.address) continue;

    const address = normalizeAddress(hit.address);
    if (!address || isNonTokenAddress(address)) continue;

    // Sanity: a Solana-slug route must carry a base58 address, an EVM one a 0x address.
    const family = inferChainFromAddress(address);
    const expectSolana = hit.chain === 'solana';
    if (expectSolana && family !== 'solana') continue;
    if (!expectSolana && family !== 'evm-family') continue;

    return { address, chain: hit.chain, addressKind: hit.addressKind, site: site.id, method: 'url' };
  }
  return null;
}

/** Is this a site we have a URL adapter for at all? Drives the UI message. */
export function isSupportedSite(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return SITES.some((s) => s.match.test(url.hostname));
  } catch {
    return false;
  }
}

/**
 * Rank candidates gathered from the DOM by the content script. URL beats
 * canonical link beats meta tag beats copy-button beats body text.
 */
export const CANDIDATE_WEIGHTS = { url: 100, canonical: 80, meta: 70, jsonld: 65, attribute: 55, link: 40, text: 20 };

export function rankCandidates(candidates = []) {
  const byAddress = new Map();
  for (const c of candidates) {
    const address = normalizeAddress(c.address);
    if (!address || !isValidAddress(address) || isNonTokenAddress(address)) continue;
    const entry = byAddress.get(address) ?? { address, origins: new Set(), chain: c.chain ?? null };
    entry.origins.add(c.origin);
    if (!entry.chain && c.chain) entry.chain = c.chain;
    byAddress.set(address, entry);
  }

  return [...byAddress.values()]
    .map((c) => {
      const origins = [...c.origins];
      // Strength is decided by the BEST place the address appeared - not by
      // whichever the DOM happened to yield first, which would make ranking
      // depend on document order. Appearing in several independent places is
      // weak corroboration on top, capped so repetition can never beat a
      // genuinely authoritative location.
      const best = Math.max(...origins.map((o) => CANDIDATE_WEIGHTS[o] ?? 10));
      const corroboration = Math.min((origins.length - 1) * 5, 15);
      return { address: c.address, chain: c.chain, origins, score: best + corroboration };
    })
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}
