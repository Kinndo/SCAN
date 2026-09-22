/**
 * Scoring configuration. Everything tunable lives here so weights can be
 * exposed in Settings and changed without touching scoring logic.
 */

/** Opportunity sub-score weights. Need not sum to 100 - they are normalised. */
export const DEFAULT_OPPORTUNITY_WEIGHTS = {
  momentum: 20,
  volumeToMcap: 15,
  liquidity: 15,
  buySellPressure: 10,
  holderGrowth: 10,
  marketCapContext: 10,
  socialPresence: 10,
  walletActivity: 10,
};

/** Internal weights inside the momentum sub-score. */
export const DEFAULT_MOMENTUM_WEIGHTS = {
  priceChange: 30,
  volumeAcceleration: 30,
  buySellRatio: 20,
  transactionActivity: 10,
  holderGrowth: 10,
};

/**
 * Risk factors. `max` is the penalty points a fully-triggered factor
 * contributes; the final risk score is points / points-available * 100, so a
 * factor we cannot evaluate lowers confidence instead of lowering risk.
 */
export const DEFAULT_RISK_WEIGHTS = {
  lowLiquidityAbsolute: 14,
  liquidityToMarketCap: 10,
  holderConcentration: 16,
  singleWhale: 12,
  devHoldings: 10,
  devSelling: 12,
  tokenAge: 10,
  mintAuthority: 12,
  freezeAuthority: 10,
  lpNotSecured: 10,
  honeypotOrTax: 14,
  abnormalVolume: 8,
  sellPressure: 8,
};

/** User-facing thresholds. These gate "fits my profile", never the raw scores. */
export const DEFAULT_SETTINGS = {
  profile: 'balanced', // conservative | balanced | aggressive | custom
  minLiquidityUsd: 40000,
  minMarketCapUsd: 20000,
  maxMarketCapUsd: 50000000,
  maxTop10ConcentrationPct: 40,
  minTokenAgeMinutes: 60,
  preferredChains: ['solana', 'ethereum', 'base', 'bsc'],
  preferredDexIds: [],
  opportunityWeights: { ...DEFAULT_OPPORTUNITY_WEIGHTS },
  riskWeights: { ...DEFAULT_RISK_WEIGHTS },
  minCoverage: 0.5,
  maxSignalsShown: 5,
  autoScanInSidebar: true, // sidebar rescans on its own when the active tab changes token
};

export const PROFILE_PRESETS = {
  conservative: {
    minLiquidityUsd: 100000,
    minMarketCapUsd: 250000,
    maxMarketCapUsd: 50000000,
    maxTop10ConcentrationPct: 25,
    minTokenAgeMinutes: 1440,
  },
  balanced: {
    minLiquidityUsd: 40000,
    minMarketCapUsd: 20000,
    maxMarketCapUsd: 50000000,
    maxTop10ConcentrationPct: 40,
    minTokenAgeMinutes: 60,
  },
  aggressive: {
    minLiquidityUsd: 20000,
    minMarketCapUsd: 5000,
    maxMarketCapUsd: 250000000,
    maxTop10ConcentrationPct: 55,
    minTokenAgeMinutes: 5,
  },
};

export function applyProfile(settings, profile) {
  const preset = PROFILE_PRESETS[profile];
  if (!preset) return { ...settings, profile: 'custom' };
  return { ...settings, ...preset, profile };
}
