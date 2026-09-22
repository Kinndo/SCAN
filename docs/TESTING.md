# Testing SCAN

## 1. Without a browser (30 seconds)

```bash
npm run verify     # validator + 69 tests + package
```

The validator catches what unit tests cannot: a manifest pointing at a missing file,
an HTML page referencing a stylesheet that does not exist, a script looking up an
element id the markup does not define, a syntax error, a hard-coded credential, or any
wallet/signing API sneaking into an analysis-only tool.

See a real scan run through the real modules:

```bash
node tools/demo-scan.mjs                                   # a DexScreener URL
node tools/demo-scan.mjs https://pump.fun/coin/<mint>      # any supported site URL
node tools/demo-scan.mjs <contract-address>                # manual path
```

It prints the dashboard as text plus per-stage arrival times, so you can confirm the
stages land progressively rather than all at once.

## 2. In Firefox

```bash
git pull
npm run verify
```

`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select
`manifest.json` from the repo root. The add-on stays loaded until you restart Firefox.

Keep the add-on's own console open while testing — **Inspect** next to the entry on
that page gives you the background console. Right-click inside the popup → **Inspect**
for the popup's own console.

## 3. Test fixtures

```bash
node tools/demo-addresses.mjs
```

Prints a fictional but format-valid address for each of the six mock archetypes. Paste
one into the popup's manual-entry box to reach that UI state deliberately:

| Archetype | What should appear |
| --- | --- |
| `earlyRunner` | High opportunity, red **Token Age** chip |
| `establishedMeme` | Low risk, modest opportunity, mature age |
| `thinAndRisky` | Liquidity and concentration alerts near the top |
| `dangerSignals` | Risk ~80+; mint/freeze live, deployer selling, LP unlocked |
| `fading` | Momentum reads "decline"/"fading", sellers dominant |
| `sparseData` | **Both scores show `Insufficient data`**; unknown fields read `Unknown`, never `$0` |

## 4. What to actually click

**Detection**

1. Open a supported site (`dexscreener.com/solana/<pair>`, `pump.fun/coin/<mint>`,
   `birdeye.so/token/<mint>`, `etherscan.io/token/0x…`). The popup should name the site
   it matched and show the address before you press SCAN.
2. Open an unsupported page (a news article mentioning a contract address). Detection
   should fall back to reading the page — the preview says "Detected from page content".
3. Open `about:config`. It must say the page cannot be read and offer manual entry,
   not throw.
4. Paste a whole URL into the manual box — it should extract the address. Paste two
   addresses — it should refuse and say so. Paste the WSOL mint — it should refuse.

**Dashboard**

5. Watch the stage chips at the bottom fill in (`token ✓ market ✓ holders …`). Market
   data should appear well before holder/dev data — that is the parallel-stage design
   working, not a glitch.
6. Tap the **Opportunity** card. Every component should show a score, a weight, an
   effective weight, and a reason. Any component without data must say what is missing.
7. Tap the **Risk** card. Confirm unevaluable checks are listed as *Unable to verify*
   and are **not** contributing points.
8. Scan the `sparseData` fixture and confirm nothing invents a number.

**Popup lifecycle** (the Firefox-specific one)

9. Press SCAN, then immediately click the page to dismiss the popup. Reopen it — the
   finished result should be there instantly. The scan lives in the background
   precisely because Firefox destroys the popup on blur.

**Sidebar** (the "always out" mode)

13. Click **Sidebar** in the popup (or press Alt+Shift+S). The same panel should open in
    Firefox's sidebar, full width, and stay open when you click the page.
14. With the sidebar open, navigate to a different coin on the same site. Within a second
    or two the panel should show the new token and rescan by itself — no clicking. If the
    name is missing but the address is right, the panel is waiting on a site permission:
    press **Allow** once and it should fill in.
15. Switch to a tab with no token (e.g. a news site). The panel should drop to "No token
    detected", not keep showing the previous coin.
16. Turn off "Scan automatically" in Settings. Navigating to a new coin should now show
    the detected token with a SCAN button, and wait for you.
17. Restart Firefox. The sidebar should reopen on its own.

**Settings**

10. Set minimum liquidity to `$5,000,000`, save, rescan. A "below your minimum" signal
    should appear — and the Opportunity score must **not** change. Thresholds surface
    as their own signals; they never silently rescore.
11. Set the `mintAuthority` risk weight to `0`, save, rescan the `dangerSignals`
    fixture. That check should disappear from the breakdown and the risk score drop.
12. Switch profile Conservative ↔ Aggressive and confirm the thresholds change.

## 5. When something looks wrong

Press **copy debug** in the popup footer and paste the result. It contains the tab URL,
what detection decided, the page's title and the text lines the name heuristic saw, and
what every scan stage did (complete / no data / failed, with the error). It is copied to
the clipboard only - nothing is transmitted. This is far more useful than a screenshot:
a wrong name or a blank panel can be diagnosed from it directly.

Stage chips at the bottom of the panel mean:

| Chip | Meaning |
| --- | --- |
| `holders ✓` (green) | Provider returned data |
| `holders no data` (grey) | Provider ran fine and had nothing - honest, not broken |
| `holders ✗` (red) | A provider failed; hover for the error |
| `holders …` (amber) | Still loading |

Note the demo provider never puts a real-looking address on the near-empty panel -
that state is reached only through the sentinel fixtures from `demo-addresses.mjs`.

## 6. What has not been tested

The scoring and data layers are covered by 69 tests, and the validator proves every
element reference resolves. But **no part of this has executed inside Firefox** — the
build environment had no browser and no network. Untested in a real browser:

- the `runtime.connect` port between popup and background,
- `sidebarAction.open()` from the popup button, `extension.getViews({type: 'sidebar'})`
  for detecting sidebar mode, and `tabs.onUpdated` firing on single-page navigation,
- `scripting.executeScript` injection and its return value,
- `browser.storage.local` persistence,
- actual popup rendering and layout at 392px.

Step 5 and step 9 above are the two most likely to surface a problem. If the popup
opens blank, check the background console first — a message-passing failure will show
there, not in the popup.
