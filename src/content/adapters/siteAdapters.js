/**
 * Site-specific identity extractors.
 *
 * The generic heuristics in domAdapter.js are deliberately strict and will
 * often find nothing. Where a site's markup has been OBSERVED, a targeted
 * extractor here is both more reliable and more honest than widening the
 * generic patterns - every entry records the evidence it was built from.
 *
 * Classic script (content scripts cannot be ES modules): hangs off globalThis.
 */
globalThis.ScanSiteAdapters = (function () {
  const NUMBERISH = /^[\d.,]+\s*[KMBT%]?$/i;

  function textLines() {
    const body = document.body ? (document.body.innerText || '') : '';
    return body.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  function plausibleName(v) {
    if (!v || v.length < 2 || v.length > 40) return false;
    if (!/[A-Za-z]/.test(v)) return false;
    if (NUMBERISH.test(v)) return false;
    if (/[$%|]/.test(v)) return false;
    return true;
  }

  /**
   * Several terminals render the header as the ticker on one line and the
   * full name on the next ("CASHTAG" / "Cashtag", "VLOOONG" / "VERY Looong
   * Cat"). Given a ticker we already trust, take the line after its first
   * exact occurrence - and only if it looks like a name.
   */
  function nameAfterTicker(ticker, lines) {
    const idx = lines.findIndex((l) => l === ticker);
    if (idx === -1) return null;
    const next = lines[idx + 1];
    return plausibleName(next) ? next : null;
  }

  const QUOTE_WORDS = new Set(['sol', 'usd', 'usdc', 'usdt', 'eth', 'bnb', 'weth', 'wsol', 'now', 'more', 'token']);

  /**
   * The selected token's buy button reads "Buy <TICKER>" (observed: "Buy
   * Nuts", "Buy VLOOONG", "Buy Tempura", "Buy PUMPPHIL"). The bare "Buy" tab
   * does not match, and quote currencies are excluded.
   */
  function buyButtonTicker(lines) {
    for (const line of lines) {
      const m = line.match(/^Buy\s+\$?([A-Za-z0-9_.-]{1,24})$/);
      if (!m) continue;
      const t = m[1];
      if (NUMBERISH.test(t) || QUOTE_WORDS.has(t.toLowerCase())) continue;
      return t;
    }
    return null;
  }

  const SITES = [
    {
      id: 'axiom',
      match: /(^|\.)axiom\.trade$/i,
      // Evidence (debug report, 2026-09-22):
      //   document.title = "CASHTAG ↑ $92.3K | Axiom SOL"
      //   body lines      = [..., "CASHTAG", "Cashtag", ...]
      //   chart legend    = not present in innerText (canvas/iframe)
      // og:title is just "Axiom" and is useless.
      identity() {
        const title = document.title || '';
        const lines = textLines();
        const m = title.match(
          /^\s*([A-Za-z0-9_.-]{1,24})\s+(?:[↑↓→↗↘]\s*)?\$[\d.,]+\s*[KMBT]?\s*\|\s*Axiom\b/i,
        );
        let symbol = m && !NUMBERISH.test(m[1]) ? m[1] : null;
        let source = 'axiom title';
        if (!symbol) {
          // Feed pages ("Axiom SOL | Pulse") keep the ticker out of the title,
          // and token pages have a bare "Axiom" title for a moment after an
          // in-app navigation. The buy button covers both.
          symbol = buyButtonTicker(lines);
          source = 'axiom buy button';
        }
        if (!symbol) return null;
        return { symbol, name: nameAfterTicker(symbol, lines), source };
      },
    },
  ];

  /** Identity from the matching site adapter, or null. Never throws. */
  function identityFor(hostname) {
    for (const site of SITES) {
      if (!site.match.test(hostname || '')) continue;
      try {
        const r = site.identity();
        if (r && r.symbol) return { ...r, site: site.id };
      } catch {
        // A broken adapter must degrade to "no name", not break detection.
      }
    }
    return null;
  }

  return { SITES, identityFor, nameAfterTicker, buyButtonTicker, plausibleName };
})();
