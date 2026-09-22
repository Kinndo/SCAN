# SCAN — memecoin research assistant (Firefox)

Compresses the scattered signals around a memecoin into one dashboard you can read in
5–10 seconds. It does **not** tell you to buy or sell. It gives you a standardised,
explainable read on what is measurable right now — and says plainly when something
could not be measured.

> **Status:** the full pipeline (detection → data layer → scoring → UI) is built and
> working in Firefox. Out of the box it runs on a **built-in mock** whose figures are
> placeholder data, labelled `DEMO DATA`. A real **DexScreener** provider (price, market
> cap, liquidity, volume, transactions, age, socials, pair→token resolution, every chain,
> no key) is included and switched on from Settings — see *Enabling real data* below.

## What it does

- **SCAN COIN** from whatever token page you are on. URL adapters cover DexScreener,
  GeckoTerminal, Birdeye, pump.fun, GMGN, DEXTools, Photon, Axiom, Solscan, the EVM
  explorers and Jupiter; anything else falls back to reading the page, then to manual entry.
- **Opportunity Score** and **Risk Score** (0–100), computed separately, from eight and
  thirteen weighted inputs respectively.
- **Every score is explainable.** Tap a score to see each component, its score, its
  effective weight and the reason in plain language.
- **Never invents data.** A missing figure renders as `Unknown`, not `$0`. If too little
  data is available, the score is `Insufficient data` rather than a guess. Risk checks that
  could not be run are listed as *Unable to verify* and are **not** counted as safe.
- **Progressive rendering.** All six data stages are requested in parallel and each is
  drawn the moment it lands.

## It is an analysis tool only

No trading, no wallet connection, no transaction signing. It never requests, stores or
reads private keys, seed phrases, wallet passwords or signing credentials — there is no
wallet code in it at all, and `npm run check` fails the build if any is introduced.
Everything (settings, cache, last scan) stays in `browser.storage.local` on your machine.

Permissions it asks for: `tabs` (to see the active tab's URL so the sidebar can follow
you between coins), `activeTab` + `scripting` (to read the page you pressed SCAN on), and
`storage`. Reading any other page requires you to approve that site explicitly.

## Enabling real data

Settings › **Data providers** › **Enable** next to DexScreener. Firefox asks once for
permission to contact `api.dexscreener.com` — that origin only. Demo data switches itself
off at the same time so live and placeholder figures are never mixed.

Then **Enable** RugCheck the same way (Solana only) for holder concentration, mint/freeze
authority, LP lock status and creator holdings — the Risk side.

Each provider has a **Test** button that fetches a known token and prints the live
status, timing, the response's keys and what the translator made of them. DexScreener's
shape was confirmed live on 2026-09-22; RugCheck's was written from its public report
format and awaits the same confirmation. **If a scan shows `Unknown` where the site shows
a number, paste the Test output** — a wrong field name is a one-line fix once the real
shape is visible.

A Risk Score is only ever emitted when at least one structural check (holders, authorities,
LP lock, creator) could be run. Market figures alone — liquidity, age, volume — never
produce one, because a low number computed while mint authority and holder concentration
are unknown would read as reassurance it has not earned.

## Keep it open: sidebar mode

The popup closes the moment you click the page. For a panel that stays put, open SCAN in
the Firefox **sidebar**: press **Alt+Shift+S**, click **Sidebar** in the popup, or use
View › Sidebar › SCAN. The sidebar follows the active tab — switch to another coin and it
re-detects and rescans on its own (toggle that in Settings) — and Firefox reopens it after
a restart.

Reading a page for the token's *name* needs a one-time permission per site; the panel
offers an **Allow** button when that is the case. Token detection from the URL, and every
score, work without it.

## Install for development

```bash
npm run verify          # validate + test + package
```

Then in Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on…** →
pick `manifest.json` from this directory. Open any token page and click the SCAN icon.

## See the pipeline without Firefox

```bash
node tools/demo-scan.mjs
node tools/demo-scan.mjs https://pump.fun/coin/<mint>
node tools/demo-scan.mjs <contract-address>
```

Runs a real scan through the real modules and prints the dashboard as text, including
per-stage arrival times.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | 69 unit/integration tests (Node's built-in runner, no dependencies) |
| `npm run check` | Validates the manifest, every file reference, syntax, and scans for hard-coded credentials or wallet APIs |
| `npm run build` | Packages `dist/scan-<version>.zip` |
| `npm run verify` | All three |

## Layout

```
manifest.json               MV3, Firefox event-page background
src/
  background/               detection, provider registry, scan state
  content/adapters/         DOM fallback adapter (injected on demand)
  core/                     constants, TokenSnapshot model, URL site adapters
  services/                 provider registry, mock provider, scan orchestrator
  scoring/                  momentum / opportunity / risk / signals, all pure
  storage/                  local-only storage
  utils/                    formatting, validation, TTL cache
  popup/  settings/         UI
tools/                      validate, build, demo
tests/                      unit + integration
```

## Design notes

- **Contract address is the identifier**, never the ticker — tickers collide constantly.
  URL parsing is preferred over DOM scraping because routes are far more stable than markup.
- **The data layer and the UI never touch.** Providers translate their responses into one
  normalised `TokenSnapshot`; scoring is a pure function of that snapshot; the UI renders
  the scoring output. Adding a data source touches exactly one new file.
- **Weights are configuration, not code.** Opportunity weights, risk-factor weights and all
  thresholds are editable in Settings; setting a risk weight to 0 disables that check.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/ROADMAP.md](docs/ROADMAP.md)
