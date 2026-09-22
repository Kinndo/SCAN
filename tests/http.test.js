import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, HttpError } from '../src/services/http.js';

const respond = (status, body, { json = true } = {}) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { if (!json) throw new Error('bad json'); return body; },
});

test('returns parsed JSON on success', async () => {
  assert.deepEqual(await fetchJson('https://x/y', { fetchImpl: respond(200, { a: 1 }) }), { a: 1 });
});

test('429 is a typed, rate-limited error', async () => {
  await assert.rejects(fetchJson('https://x/y', { fetchImpl: respond(429, {}) }), (err) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.rateLimited, true);
    assert.equal(err.status, 429);
    return true;
  });
});

test('other HTTP failures and non-JSON bodies are surfaced, not swallowed', async () => {
  await assert.rejects(fetchJson('https://x/y', { fetchImpl: respond(500, {}) }), /HTTP 500/);
  await assert.rejects(fetchJson('https://x/y', { fetchImpl: respond(200, null, { json: false }) }), /not JSON/);
});

test('a hung request times out instead of holding the scan', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  await assert.rejects(fetchJson('https://x/y', { fetchImpl: hang, timeoutMs: 20 }), /Timed out after 20ms/);
});

test('network errors are labelled as such', async () => {
  const dead = async () => { throw new TypeError('NetworkError when attempting to fetch resource.'); };
  await assert.rejects(fetchJson('https://x/y', { fetchImpl: dead }), /Network error/);
});
