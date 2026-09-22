/**
 * Content-script entry point.
 *
 * Injected on demand by the background via scripting.executeScript when the
 * user presses SCAN - there is no persistent content script and no broad host
 * permission, so the extension reads a page only when explicitly asked to.
 *
 * The value of the final expression is what executeScript returns to the
 * background, so no message passing is needed here.
 */
(function () {
  const adapter = globalThis.ScanDomAdapter;
  const result = {
    ok: false,
    url: location.href,
    hostname: location.hostname,
    candidates: [],
    pageMetrics: {},
    identityHints: {},
    debug: null,
    error: null,
  };
  try {
    const rawCandidates = adapter.collectCandidates();
    result.pageMetrics = adapter.extractVisibleMetrics();
    result.identityHints = adapter.extractIdentityHints();

    // A site-specific extractor, where one exists, beats the generic guess.
    const sites = globalThis.ScanSiteAdapters;
    const fromSite = sites ? sites.identityFor(location.hostname) : null;
    if (fromSite) {
      result.identityHints = {
        ...result.identityHints,
        symbolHint: fromSite.symbol,
        nameHint: fromSite.name ?? result.identityHints.nameHint ?? null,
        symbolSource: fromSite.source,
        siteAdapter: fromSite.site,
      };
    }

    // With a ticker in hand, the address sitting next to it on the page beats
    // every other candidate. This is how a feed page resolves to the token
    // that is actually selected rather than to any row in the list.
    const ticker = result.identityHints ? result.identityHints.symbolHint : null;
    const nearTicker = adapter.boostNearTicker(rawCandidates, ticker);
    result.candidates = [...adapter.stripElements(rawCandidates), ...nearTicker];

    try {
      result.debug = adapter.collectDebug();
      if (result.debug) {
        result.debug.siteAdapter = fromSite ? fromSite.site : null;
        result.debug.candidateCount = rawCandidates.length;
        result.debug.nearTicker = nearTicker.map((c) => c.address);
      }
    } catch {
      result.debug = null;
    }
    result.ok = true;
  } catch (err) {
    result.error = String((err && err.message) || err);
  }
  return result;
})();
