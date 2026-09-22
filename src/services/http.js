/**
 * Minimal JSON fetch with a hard timeout and typed errors, shared by every
 * HTTP provider. Runs in the background page, where host permissions apply
 * and the page's CORS rules do not.
 */

export class HttpError extends Error {
  constructor(message, { status = null, url = null, rateLimited = false } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.rateLimited = rateLimited;
  }
}

export async function fetchJson(url, { timeoutMs = 6000, signal = null, headers = {}, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new HttpError('fetch is not available in this context', { url });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    let res;
    try {
      res = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    } catch (err) {
      const timedOut = controller.signal.aborted && !(signal && signal.aborted);
      throw new HttpError(timedOut ? `Timed out after ${timeoutMs}ms` : `Network error: ${String((err && err.message) || err)}`, { url });
    }
    if (res.status === 429) throw new HttpError('Rate limited (HTTP 429)', { status: 429, url, rateLimited: true });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, { status: res.status, url });
    try {
      return await res.json();
    } catch {
      throw new HttpError('Response was not JSON', { status: res.status, url });
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
