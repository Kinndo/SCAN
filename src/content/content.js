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
    error: null,
  };
  try {
    result.candidates = adapter.collectCandidates();
    result.pageMetrics = adapter.extractVisibleMetrics();
    result.identityHints = adapter.extractIdentityHints();
    result.ok = true;
  } catch (err) {
    result.error = String((err && err.message) || err);
  }
  return result;
})();
