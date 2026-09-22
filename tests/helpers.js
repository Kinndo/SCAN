import { emptySnapshot } from '../src/core/model.js';
import { field } from '../src/core/model.js';

export const F = (v) => field(v, 'test');

/** Build a snapshot with sensible, internally consistent defaults. */
export function makeSnapshot(over = {}) {
  const now = over.now ?? 1_700_000_000_000;
  const s = emptySnapshot({ chain: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' });
  s.identity.symbol = 'TEST';
  s.identity.name = 'Test Token';
  s.market.priceUsd = F(0.000123);
  s.market.marketCapUsd = F(420000);
  s.market.liquidityUsd = F(84000);
  s.market.createdAt = F(now - 2 * 60 * 60 * 1000);
  s.market.volume = { m5: F(3000), h1: F(30000), h6: F(120000), h24: F(190000) };
  s.market.priceChange = { m5: F(1.2), h1: F(12), h6: F(28), h24: F(60) };
  s.market.txns = { m5: F({ buys: 12, sells: 8 }), h1: F({ buys: 120, sells: 80 }), h6: F({ buys: 400, sells: 300 }), h24: F({ buys: 900, sells: 700 }) };
  s.holders.count = F(1200);
  s.holders.countChange1h = F(8);
  s.holders.top10Pct = F(28);
  s.holders.top20Pct = F(35);
  s.holders.largestPct = F(9);
  s.holders.largestNonLpPct = F(6);
  s.contract.mintAuthorityActive = F(false);
  s.contract.freezeAuthorityActive = F(false);
  s.contract.lpBurnedOrLockedPct = F(95);
  s.contract.honeypot = F(false);
  s.contract.buyTaxPct = F(0);
  s.contract.sellTaxPct = F(0);
  s.dev.deployerHoldingPct = F(1.2);
  s.dev.deployerSoldPct = F(0);
  s.social.hasWebsite = F(true);
  s.social.hasTwitter = F(true);
  s.social.hasTelegram = F(false);
  s.meta.stagesPending = [];
  s.meta.partial = false;

  for (const [group, values] of Object.entries(over.set || {})) {
    Object.assign(s[group], values);
  }
  return s;
}

export const NOW = 1_700_000_000_000;
