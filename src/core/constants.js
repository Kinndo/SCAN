/**
 * Shared constants. No logic here - keep it data-only so it is safe to import
 * from every layer (background, popup, settings, scoring, tests).
 */

export const CHAINS = {
  solana: { id: 'solana', label: 'Solana', addressKind: 'base58', explorer: 'https://solscan.io/token/' },
  ethereum: { id: 'ethereum', label: 'Ethereum', addressKind: 'evm', explorer: 'https://etherscan.io/token/' },
  base: { id: 'base', label: 'Base', addressKind: 'evm', explorer: 'https://basescan.org/token/' },
  bsc: { id: 'bsc', label: 'BNB Chain', addressKind: 'evm', explorer: 'https://bscscan.com/token/' },
  arbitrum: { id: 'arbitrum', label: 'Arbitrum', addressKind: 'evm', explorer: 'https://arbiscan.io/token/' },
  polygon: { id: 'polygon', label: 'Polygon', addressKind: 'evm', explorer: 'https://polygonscan.com/token/' },
  avalanche: { id: 'avalanche', label: 'Avalanche', addressKind: 'evm', explorer: 'https://snowscan.xyz/token/' },
  unknown: { id: 'unknown', label: 'Unknown chain', addressKind: 'unknown', explorer: null },
};

export const CHAIN_IDS = Object.keys(CHAINS).filter((c) => c !== 'unknown');

/**
 * Addresses that are never the memecoin the user is researching. Detection must
 * filter these out or a generic DOM scan will "find" WSOL on every Solana page.
 */
export const NON_TOKEN_ADDRESSES = new Set([
  // Solana
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  '11111111111111111111111111111111', // System program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022 program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated token program
  // EVM
  '0x0000000000000000000000000000000000000000', // zero / burn
  '0x000000000000000000000000000000000000dead', // burn
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC (eth)
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT (eth)
  '0x4200000000000000000000000000000000000006', // WETH (base/op)
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
]);

/** Data-availability confidence attached to every metric we surface. */
export const CONFIDENCE = {
  MEASURED: 'measured', // came from a provider response
  DERIVED: 'derived', // computed from measured values
  MOCK: 'mock', // Phase 1 placeholder - must be labelled in the UI
  UNKNOWN: 'unknown', // no data
};

/** Minimum fraction of scoring weight that must have data before we emit a score. */
export const MIN_COVERAGE = 0.5;

export const SIGNAL_LEVEL = {
  GOOD: 'good',
  WARN: 'warn',
  BAD: 'bad',
  UNKNOWN: 'unknown',
};
