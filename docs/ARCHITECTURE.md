# Architecture

## Data flow

```
 user clicks SCAN
        |
 background/background.js
        |-- core/detect.js           URL adapters   (preferred: routes are stable)
        |-- scripting.executeScript  DOM adapter    (fallback, activeTab only)
        |-- popup manual entry       validation.js  (last resort)
        v
 services/marketData.js  runScan()
        |  asks providerRegistry for candidates per (stage, chain)
        |  fires all six stages IN PARALLEL, each cached with its own TTL
        v
 core/model.js  TokenSnapshot        <- the ONLY contract across the seam
        v
 scoring/index.js  analyze()         <- pure: snapshot + settings + clock
        v
 popup/popup.js                      <- renders, re-renders on every stage
```

The same `popup.html` also serves as the **sidebar panel** (`sidebar_action`). In sidebar
mode (`src/popup/sidebar.js` decides, via `extension.getViews({type:'sidebar'})`) the page
additionally listens to `tabs.onActivated` / `tabs.onUpdated`, re-detects on navigation
only — not on the title churn a live price ticker causes — and rescans when the token
changes. Because activeTab is never granted to a sidebar, reading a page there needs a
per-site host permission, requested from the panel's **Allow** button; URL detection and
scoring do not.

The background owns scan state because a Firefox popup is destroyed when it loses focus.
A scan started before the popup closes keeps running, and reopening re-renders instantly
from `SCAN_UPDATE`/`SCAN_COMPLETE` replayed over the `scan` port.

### Resolution before fan-out

Pages hand over pool addresses (Axiom, DexScreener, DEXTools routes) or addresses of
unknown chain (a pasted `0x…`). `runScan` therefore asks the registry's **resolvers** —
providers exposing `resolve(target)` — to turn the target into a token on a known chain
*before* any stage runs, so every provider, cache key and the header agree on the token.
The result is cached for a day (a pool's base token never changes) and recorded on the
snapshot as `identity.resolvedBy`, `resolvedFrom` and `pairAddress`. If nothing resolves,
the scan proceeds with the address as given and the kind stays honest.

### Switching providers on

Every provider answers `isConfigured(config)` from `providerConfig` in local storage
(Settings › Data providers). The mock is on unless `demoData === false`; a real provider
is on when the user has enabled it, which also requests its API origin from Firefox and
switches demo data off. A provider may also expose `test(ctx)` — a self-diagnostic the
Settings page runs against a known token, returning live status, timing and response
keys. That is the verification path for providers written without network access.

## The TokenSnapshot contract

Every metric is either `null` (unknown) or `{ value, source, confidence, asOf }`. There is
no third state, and `0` is never used to mean "we could not fetch it" — for liquidity those
two readings lead to opposite decisions.

`mergeSnapshot()` will not overwrite a known value with `null`, so a later stage that
returns nothing cannot erase an earlier one's data.

## Adding a data provider

1. Copy `src/services/providers/httpProvider.template.js`.
2. Implement `fetch(stage, target, ctx)` returning a **partial** snapshot, or `null` for
   data you cannot obtain. Never return a zero for missing data.
3. Register it in `background.js`: `registry.register(createMyProvider())`.
4. Add the host to `optional_host_permissions` in `manifest.json` and request it at runtime
   from a user gesture in Settings (`browser.permissions.request`).

Priority ordering, chain filtering, key-configured filtering, caching, timeouts and error
isolation are all handled by the registry and orchestrator. A provider that throws is
recorded against its stage and the other five stages continue.

API keys live in `browser.storage.local` under `providerConfig.<id>.apiKey`, entered by the
user in Settings, and reach the provider as `ctx.config`. `npm run check` fails if a
credential-looking literal appears in `src/`.

> The endpoints a real provider would call were **not verified** during this build — the
> development environment had no outbound network access, so no API was probed. Confirm
> response shapes against live responses before trusting a field map.

## Adding a site adapter

Add an entry to `SITES` in `src/core/detect.js` with a hostname `match` and an `extract(url)`
returning `{chain, address, addressKind}`. `addressKind` is `token`, `pair` or `pool` — pair
and pool addresses need a provider to resolve them to their base token, which is a Phase 2
job. Detection sanity-checks that the address family matches the chain, so a wrong pattern
degrades to "unable to identify" rather than scanning the wrong token.

There are two kinds of site adapter, and they live in different places because they run
in different worlds:

| Kind | Where | Runs in | Answers |
| --- | --- | --- | --- |
| URL adapter | `src/core/detect.js` → `SITES` | background | *which address, which chain* |
| Identity adapter | `src/content/adapters/siteAdapters.js` → `SITES` | content script | *what is it called* |

An identity adapter must be built from **observed** markup, never from a guess about what
a site probably renders. Have the user press **copy debug** in the popup on that site and
paste the report; it contains the title, og:title and the header lines. Record that
evidence in a comment on the adapter, as the Axiom entry does. The reason this rule
exists: three successive generic heuristics reported the wrong name on Axiom ("Pep Doge",
"Axiom", "139K") before a report showed the chart legend was not even in the DOM.

Content-script files cannot be ES modules, so `src/content/adapters/base.js` repeats the
address regexes from `src/utils/validation.js`. `tests/adapters.test.js` fails if the two
copies drift.

## Scoring

Opportunity and Risk are computed independently.

**Opportunity** — eight components, each returning `{score, weight, reasons[], missing[]}`.
The total is the weight-normalised mean over components that *have data*; missing weight is
redistributed, and `coverage` records how much was missing. Below `minCoverage` (default
50%) the score is `null` with `insufficientData: true`.

**Risk** — thirteen factors, each returning a severity in `[0,1]`. The score is
`points / points-available × 100`. A factor that cannot be evaluated is pushed to
`unverified[]` and excluded from the denominator, so **missing data never reads as safe**.

**Momentum** cross-reads price against volume pace, buy/sell balance, transaction count and
holder growth, then states the interpretation in words — "price up on heavy volume while
sellers outnumber buyers" is a different situation from "price up on rising volume", and the
module says which one it is.

Guarantees enforced by tests: every component that emits a score also emits at least one
reason; every unavailable component names what it is missing; user thresholds surface as
their own signals and never silently move a score.
