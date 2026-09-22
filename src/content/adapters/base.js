/**
 * Content-script shared base. Classic script (content scripts cannot be ES
 * modules in Firefox), so everything hangs off a namespace on globalThis.
 *
 * The four regexes below are a VERBATIM copy of the canonical definitions in
 * src/utils/validation.js. tests/adapters.test.js fails the build if they drift.
 */
globalThis.ScanContentBase = (function () {
  const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
  const SOLANA_SCAN_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  const EVM_SCAN_RE = /\b0x[a-fA-F0-9]{40}\b/g;

  function isSolana(v) {
    return typeof v === 'string' && SOLANA_ADDRESS_RE.test(v);
  }
  function isEvm(v) {
    return typeof v === 'string' && EVM_ADDRESS_RE.test(v);
  }
  function isAddress(v) {
    return isSolana(v) || isEvm(v);
  }

  /** Pull every address-shaped token out of a blob of text. */
  function scanText(text, limit = 40) {
    if (typeof text !== 'string' || !text) return [];
    const out = [];
    for (const re of [EVM_SCAN_RE, SOLANA_SCAN_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null && out.length < limit) out.push(m[0]);
    }
    return out;
  }

  return { SOLANA_ADDRESS_RE, EVM_ADDRESS_RE, SOLANA_SCAN_RE, EVM_SCAN_RE, isSolana, isEvm, isAddress, scanText };
})();
