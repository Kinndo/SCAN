/**
 * Generic DOM adapter: the fallback used when no URL pattern matched.
 *
 * It gathers address CANDIDATES tagged with where they came from, and lets the
 * background rank them (src/core/detect.js#rankCandidates). It deliberately
 * does not decide - a body-text address on a listings page is a much weaker
 * claim than one in a canonical link, and only the ranker knows that.
 */
globalThis.ScanDomAdapter = (function () {
  const base = globalThis.ScanContentBase;

  function push(out, address, origin, chain) {
    if (base.isAddress(address)) out.push({ address, origin, chain: chain || null });
  }

  function fromUrl(out) {
    base.scanText(location.href).forEach((a) => push(out, a, 'url'));
  }

  function fromCanonical(out) {
    document.querySelectorAll('link[rel="canonical"]').forEach((el) => {
      base.scanText(el.getAttribute('href') || '').forEach((a) => push(out, a, 'canonical'));
    });
  }

  function fromMeta(out) {
    const sel = 'meta[property^="og:"], meta[name^="twitter:"], meta[name="description"]';
    document.querySelectorAll(sel).forEach((el) => {
      base.scanText(el.getAttribute('content') || '').forEach((a) => push(out, a, 'meta'));
    });
  }

  function fromJsonLd(out) {
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      base.scanText((el.textContent || '').slice(0, 20000)).forEach((a) => push(out, a, 'jsonld'));
    });
  }

  function fromAttributes(out) {
    const sel = '[data-address],[data-token],[data-mint],[data-contract],[data-token-address],[data-copy],[data-clipboard-text]';
    document.querySelectorAll(sel).forEach((el) => {
      for (const attr of el.attributes) {
        if (!/^data-/.test(attr.name)) continue;
        base.scanText(attr.value).forEach((a) => push(out, a, 'attribute'));
      }
    });
  }

  function fromLinks(out) {
    // Explorer links are a strong hint even on unsupported sites.
    const sel = 'a[href*="solscan.io"],a[href*="etherscan.io"],a[href*="basescan.org"],a[href*="bscscan.com"],a[href*="dexscreener.com"],a[href*="birdeye.so"],a[href*="pump.fun"]';
    document.querySelectorAll(sel).forEach((el) => {
      base.scanText(el.getAttribute('href') || '').forEach((a) => push(out, a, 'link'));
    });
  }

  function fromText(out) {
    // Cap the sweep: some trading pages have enormous DOMs.
    const text = (document.body ? document.body.innerText || '' : '').slice(0, 120000);
    base.scanText(text, 25).forEach((a) => push(out, a, 'text'));
  }

  function collectCandidates() {
    const out = [];
    const steps = [fromUrl, fromCanonical, fromMeta, fromJsonLd, fromAttributes, fromLinks, fromText];
    for (const step of steps) {
      try {
        step(out);
      } catch {
        // One broken step must not abort detection.
      }
    }
    return out;
  }

  /**
   * Best-effort page metrics. These are a HINT only - labelled as low
   * confidence and never allowed to override a provider value, because every
   * site formats differently and a mis-read number is worse than no number.
   */
  function extractVisibleMetrics() {
    const LABELS = {
      priceUsd: /^price$/i,
      marketCapUsd: /^(market\s*cap|mcap|mkt\s*cap)$/i,
      liquidityUsd: /^(liquidity|liq|pooled)$/i,
      volumeH24: /^(24h\s*vol(ume)?|volume\s*24h?|vol\s*24h?)$/i,
      holders: /^holders$/i,
    };
    const found = {};
    const nodes = document.querySelectorAll('div,span,td,th,dt,dd,p,li');
    const limit = Math.min(nodes.length, 4000);
    for (let i = 0; i < limit; i += 1) {
      const el = nodes[i];
      const label = (el.textContent || '').trim();
      if (!label || label.length > 24) continue;
      for (const [key, re] of Object.entries(LABELS)) {
        if (found[key] || !re.test(label)) continue;
        const value = readNeighbourValue(el);
        if (value !== null) found[key] = value;
      }
    }
    return found;
  }

  function readNeighbourValue(el) {
    const candidates = [el.nextElementSibling, el.parentElement && el.parentElement.nextElementSibling];
    for (const node of candidates) {
      if (!node) continue;
      const parsed = parseMoney((node.textContent || '').trim());
      if (parsed !== null) return parsed;
    }
    return null;
  }

  function parseMoney(text) {
    if (!text) return null;
    const m = text.replace(/,/g, '').match(/^\$?\s*(\d+(?:\.\d+)?)\s*([KMB])?$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return null;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] ?? 1;
    return n * mult;
  }

  function extractIdentityHints() {
    const title = (document.title || '').trim();
    const og = document.querySelector('meta[property="og:title"]');
    const ogTitle = og ? (og.getAttribute('content') || '').trim() : '';
    const source = ogTitle || title;

    // Real trading pages write tickers in mixed case ("Nuts/USD on Pump AMM",
    // "$Nuts"), so an uppercase-only pattern silently matches nothing.
    const ticker = source.match(/\$([A-Za-z0-9]{2,12})\b/) ||
      source.match(/\b([A-Za-z0-9]{2,12})\s*\/\s*(?:SOL|USD|USDC|USDT|ETH|WETH|BNB)\b/i);

    // Fall back to the leading segment of the title, then drop any trading-pair
    // tail: "Nuts/USD on Pump AMM - axiom.trade" -> "Nuts".
    let nameHint = null;
    if (source) {
      const lead = source
        .split(/\s+[|\u00b7\u2013\u2014-]\s+/)[0]
        .replace(/\s*\/\s*(?:SOL|USD|USDC|USDT|ETH|WETH|BNB)\b.*$/i, '')
        .trim();
      if (lead && lead.length <= 40) nameHint = lead;
    }

    return {
      pageTitle: title || null,
      ogTitle: ogTitle || null,
      symbolHint: ticker ? ticker[1] : null,
      nameHint,
    };
  }

  return { collectCandidates, extractVisibleMetrics, extractIdentityHints, parseMoney };
})();
