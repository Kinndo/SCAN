# What is built, and what is next

## Phase 1 — complete

| Requirement | Status |
| --- | --- |
| Firefox MV3 extension | Done — event-page background, `activeTab` + `scripting`, no broad host permissions |
| Token detection from the page | Done — 10 URL site adapters, ranked DOM fallback, address validation |
| Manual contract-address entry | Done — accepts a bare address or one pasted inside a URL/sentence |
| Dark, compact trading-terminal UI | Done — popup dashboard, breakdown panels, settings page |
| Placeholder data for all six metric groups | Done — deterministic mock provider with six token archetypes |
| Opportunity + Risk scoring | Done — 8 components, 13 risk factors, configurable weights |
| Every score explainable | Done — per-component score, weight, effective weight and reasons |
| Data layer separated from UI | Done — provider registry + normalised `TokenSnapshot` |
| No trading / no wallet access | Done — enforced by a build check |

69 tests, `npm run verify` green.

## Phase 2 — real data

The blocker is not code, it is verification: this build had **no outbound network access**,
so no API was probed and no endpoint, field name, rate limit or CORS behaviour was confirmed.
Before writing a provider, verify against live responses. The seams are already in place.

1. **Confirm the sources.** For each candidate, establish: does it work without a key, what
   `Access-Control-Allow-Origin` does it return, what is the rate limit, and — critically —
   which fields are present for a *10-minute-old, $18K-liquidity* token rather than for an
   established one. The failure mode this product must survive is a brand-new token where
   half the fields are absent.
2. **Market/DEX provider** → `market` + `identity` stages. Needs price, market cap,
   liquidity, volume and transaction counts across m5/h1/h6/h24 windows, plus pool creation
   time for token age.
3. **Resolve pair/pool addresses to tokens.** DexScreener and DEXTools routes carry a *pair*
   address; the snapshot already carries `addressKind` for this, and a provider must do the
   lookup.
4. **Holder provider** → `holders`. Top-10/20 concentration, largest non-LP holder, holder
   count over time. Distinguishing an AMM vault from a human whale is the hard part — until
   it is solved, report `largestPct` and leave `largestNonLpPct` null rather than guessing.
5. **Contract-security provider** → `contract`. Chain-specific: mint/freeze authority and
   Token-2022 extensions on Solana; honeypot, taxes, owner permissions and blacklist on EVM.
   Do not pretend the two chains have the same model.
6. **Deployer provider** → `dev`. Deployer holdings, selling, funding source.
7. **Social** → `social`. Keep it a small weight and only claim what is measurable. Channel
   *existence* is honest; inferred "engagement" from an unverified source is not.

## Phase 3 — deferred features

These were specified but are deliberately **not** in Phase 1, since they need real data to
be worth anything:

- **Watchlist** — saved tokens with sortable price/mcap/liquidity/scores. The storage layer
  is ready; needs a UI and a background refresh loop.
- **Scan history** — timestamped record of every scan. `setLastScan()` already persists the
  most recent one; extend to a capped list.
- **Time-series tracking** — holder count and volume at 15m/1h intervals. Requires storing
  snapshots over time, which only becomes meaningful with live data.
- **Related-wallet detection** — only ever with evidence, phrased as "possibly related".
- **Wash-trading detection** — the `abnormalVolume` risk factor is a crude first pass
  (volume/mcap ratio); real detection needs trade-level data.
- **Pair→token resolution cache**, **per-chain provider fallback chains**, **AMO signing**.

## Known limitations

- Site URL patterns were written offline and are unverified against the live sites. A wrong
  pattern fails safe (falls through to DOM, then manual entry) but should be checked.
- EVM chain cannot be inferred from an address shape. Manual entry of a `0x…` address
  without choosing a chain yields `chain: unknown`.
- EIP-55 checksum validation is not implemented; addresses are validated by format only.
- The DOM adapter's visible-metric extraction is a rough label-proximity heuristic and its
  output is not currently fed into scoring — provider data is trusted over scraped numbers.
