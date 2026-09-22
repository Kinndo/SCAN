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

  function push(out, address, origin, el) {
    if (base.isAddress(address)) out.push({ address, origin, chain: null, el: el || null });
  }

  function fromUrl(out) {
    base.scanText(location.href).forEach((a) => push(out, a, 'url'));
  }

  function fromCanonical(out) {
    document.querySelectorAll('link[rel="canonical"]').forEach((el) => {
      base.scanText(el.getAttribute('href') || '').forEach((a) => push(out, a, 'canonical', el));
    });
  }

  function fromMeta(out) {
    const sel = 'meta[property^="og:"], meta[name^="twitter:"], meta[name="description"]';
    document.querySelectorAll(sel).forEach((el) => {
      base.scanText(el.getAttribute('content') || '').forEach((a) => push(out, a, 'meta', el));
    });
  }

  function fromJsonLd(out) {
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      base.scanText((el.textContent || '').slice(0, 20000)).forEach((a) => push(out, a, 'jsonld', el));
    });
  }

  function fromAttributes(out) {
    const sel = '[data-address],[data-token],[data-mint],[data-contract],[data-token-address],[data-copy],[data-clipboard-text]';
    document.querySelectorAll(sel).forEach((el) => {
      for (const attr of el.attributes) {
        if (!/^data-/.test(attr.name)) continue;
        base.scanText(attr.value).forEach((a) => push(out, a, 'attribute', el));
      }
    });
  }

  function fromLinks(out) {
    // Explorer and trading-site links are a strong hint even on unsupported
    // sites, and a feed page links every one of its rows to a token.
    const sel = 'a[href*="solscan.io"],a[href*="etherscan.io"],a[href*="basescan.org"],a[href*="bscscan.com"],'
      + 'a[href*="dexscreener.com"],a[href*="birdeye.so"],a[href*="pump.fun"],a[href*="/meme/"],a[href*="/token/"],a[href*="/coin/"]';
    document.querySelectorAll(sel).forEach((el) => {
      base.scanText(el.getAttribute('href') || '').forEach((a) => push(out, a, 'link', el));
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
   * On a feed page every row carries a token address, so a plain scan finds
   * dozens and cannot say which one the page is showing. But the SELECTED
   * token's ticker is on screen, and an address that sits inside the same
   * small container as that ticker is almost certainly its address. Such
   * candidates get a 'near-ticker' origin, which outranks every other
   * page-derived origin (see CANDIDATE_WEIGHTS in core/detect.js).
   */
  function boostNearTicker(candidates, ticker) {
    if (!ticker || typeof ticker !== 'string') return [];
    const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i');
    const out = [];
    const seen = new Set();
    for (const c of candidates) {
      if (!c.el || seen.has(c.address)) continue;
      let node = c.el;
      for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
        const text = node.textContent || '';
        if (text.length > 1500) break; // a container that big is not "adjacent"
        if (re.test(text)) {
          out.push({ address: c.address, origin: 'near-ticker', chain: null });
          seen.add(c.address);
          break;
        }
      }
    }
    return out;
  }

  /** Element references cannot cross the executeScript boundary. */
  function stripElements(candidates) {
    return candidates.map(({ address, origin, chain }) => ({ address, origin, chain }));
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

  // Words that are never a token name, plus the site's own branding. Without
  // this an "Axiom" or "DEX Screener" title reads as the token's name.
  const NAME_STOPLIST = new Set([
    'chart', 'charts', 'price', 'prices', 'buy', 'sell', 'swap', 'trade', 'trading',
    'token', 'tokens', 'coin', 'coins', 'dex', 'screener', 'terminal', 'dashboard',
    'explorer', 'scan', 'home', 'app', 'pair', 'pairs', 'market', 'markets', 'memescope',
    'marketcap', 'mcap', 'volume', 'liquidity', 'supply', 'holders',
    // Quote currencies: "USD/SOL" is a display toggle, not a token.
    'usd', 'usdc', 'usdt', 'sol', 'eth', 'weth', 'bnb', 'wsol', 'usd1',
  ]);

  const QUOTES = 'SOL|USD|USDC|USDT|ETH|WETH|BNB';
  const NUMBERISH = /^[\d.,]+\s*[KMBT]?$/i;

  function siteWords() {
    // "axiom.trade" -> {axiom, trade}
    const host = (location.hostname || '').replace(/^www\./, '').toLowerCase();
    return new Set(host.split('.').filter(Boolean));
  }

  function plausibleName(value, site) {
    if (!value) return false;
    const v = value.trim();
    if (v.length < 2 || v.length > 40) return false;
    if (!/[A-Za-z]/.test(v)) return false;        // must contain a letter
    if (NUMBERISH.test(v)) return false;          // "139K", "1.25M" - a price, not a name
    if (!/^[A-Za-z0-9 ._-]+$/.test(v)) return false;
    const lower = v.toLowerCase();
    if (NAME_STOPLIST.has(lower)) return false;
    if (site.has(lower)) return false;
    return true;
  }

  /**
   * Identity read off the page.
   *
   * Only two strong patterns are accepted:
   *   1. a "$TICKER" mention in the title, and
   *   2. a chart-legend line: "<name>/<quote> on <venue>", anchored to the
   *      start of a line.
   *
   * The " on " suffix and the line anchor matter. A bare "X/USD" scan over page
   * text is far too loose on a trading UI: it matched the "USD/SOL" display
   * toggle, and a market-cap figure sitting next to a slash, reporting a token
   * called "139K". There is deliberately no "use the page title" fallback
   * either - titles are branding. When nothing strong matches, this returns
   * null and the UI says the name is unavailable.
   */
  function extractIdentityHints() {
    const title = (document.title || '').trim();
    const og = document.querySelector('meta[property="og:title"]');
    const ogTitle = og ? (og.getAttribute('content') || '').trim() : '';
    const site = siteWords();

    // Multi-word names are normal ("VERY Looong Cat"), so the capture allows
    // spaces - which is exactly why it needs the anchor and the " on " suffix.
    const legendRe = new RegExp(
      `^\\s*([A-Za-z0-9][A-Za-z0-9 ._-]{1,39}?)\\s*/\\s*(?:${QUOTES})\\b\\s+on\\s+`,
      'im',
    );
    const cashRe = /\$([A-Za-z0-9]{2,12})\b/;

    let symbolHint = null;
    let nameHint = null;
    let symbolSource = null;

    for (const [text, label] of [[ogTitle, 'og:title'], [title, 'title']]) {
      if (!text) continue;
      const cash = text.match(cashRe);
      if (cash && plausibleName(cash[1], site)) {
        symbolHint = cash[1];
        symbolSource = label;
        break;
      }
    }

    const sources = [[ogTitle, 'og:title'], [title, 'title'],
      [document.body ? (document.body.innerText || '').slice(0, 30000) : '', 'chart legend']];
    for (const [text, label] of sources) {
      if (!text) continue;
      const m = text.match(legendRe);
      if (m && plausibleName(m[1], site)) {
        nameHint = m[1].trim();
        if (!symbolHint) symbolSource = label;
        break;
      }
    }

    return {
      pageTitle: title || null,
      ogTitle: ogTitle || null,
      symbolHint,
      nameHint,
      symbolSource,
    };
  }

  /**
   * What the page actually exposes, for the popup's "Copy debug" button. This
   * is the raw material the name heuristic works from, so a wrong or missing
   * name can be diagnosed from a pasted report instead of a screenshot.
   */
  function collectDebug() {
    const og = document.querySelector('meta[property="og:title"]');
    const body = document.body ? (document.body.innerText || '') : '';
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const slashLines = lines
      .filter((l) => /\/\s*(?:SOL|USD|USDC|USDT|ETH|WETH|BNB)\b/i.test(l))
      .slice(0, 12);
    const buyLines = lines.filter((l) => /^Buy\s+\S+$/.test(l)).slice(0, 6);
    return {
      title: document.title || null,
      ogTitle: og ? og.getAttribute('content') : null,
      hostname: location.hostname,
      bodyChars: body.length,
      bodyLineCount: lines.length,
      firstLines: lines.slice(0, 15),
      slashLines,
      buyLines,
      hasCanvas: document.querySelectorAll('canvas').length,
    };
  }

  return { collectCandidates, boostNearTicker, stripElements, extractVisibleMetrics, extractIdentityHints, collectDebug, parseMoney };
})();
