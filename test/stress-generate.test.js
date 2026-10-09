import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.js';

// Stress test: 40 users generate a package at the same time. Every user gets
// their own CSRF session (cookie + token), half build the Vercel target and
// half the Cloudflare target, and all 40 requests run concurrently against the
// real Worker fetch handler. Asserts that concurrency corrupts nothing: every
// user gets a valid ZIP that carries their own site content and their own
// freshly generated secrets.
//
// Note on the deployed Workers Free plan: the platform kills each server-side
// build that exceeds 10ms of CPU (error 1102), which is a per-request platform
// cap, not a concurrency bug — the builder's browser fallback absorbs those
// refusals. This test proves the Worker code itself is safe under 40-way
// concurrency: no shared-state races, per-session CSRF, distinct outputs.

const origin = 'https://builder.example';
const CONCURRENT_USERS = 40;
const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    return new Response(await readFile(new URL(`../public${path}`, import.meta.url)));
  }
};
const env = { ASSETS: assets };

function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    files.set(name, { size, text: decoder.decode(bytes.subarray(dataStart, dataEnd)) });
    offset = dataEnd;
  }
  return files;
}

async function oneUser(index) {
  const target = index % 2 === 0 ? 'vercel' : 'cloudflare';
  const businessName = `Stress User ${index + 1}`;
  const csrf = await worker.fetch(new Request(`${origin}/api/csrf`), env);
  assert.equal(csrf.status, 200);
  const cookie = csrf.headers.get('Set-Cookie').split(';')[0];
  const { token } = await csrf.json();
  const started = performance.now();
  const response = await worker.fetch(new Request(`${origin}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'X-CSRF-Token': token },
    body: JSON.stringify({
      target, businessName,
      adminUsername: 'practiceowner', adminEmail: 'owner@example.test', adminPassword: 'CanopyOwner!8'
    })
  }), env);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { index, target, businessName, status: response.status, contentType: response.headers.get('Content-Type'), ms: performance.now() - started, bytes };
}

test(`${CONCURRENT_USERS} concurrent users can generate packages simultaneously`, async () => {
  const wallStart = performance.now();
  const users = await Promise.all(Array.from({ length: CONCURRENT_USERS }, (_, index) => oneUser(index)));
  const wallMs = performance.now() - wallStart;

  const csrfSecrets = new Set();
  const adminHashes = new Set();
  for (const user of users) {
    assert.equal(user.status, 200, `user ${user.index + 1} (${user.target}) failed with ${user.status}`);
    assert.match(user.contentType, /application\/zip/);
    const entries = zipEntries(user.bytes);
    assert.ok(entries.size > 20, `user ${user.index + 1}: expected a full package, got ${entries.size} entries`);
    // The ZIP is this user's package, not another user's.
    const readme = entries.get('README.md');
    assert.ok(readme.text.includes(user.businessName), `user ${user.index + 1}: README carries the wrong practice`);
    const manifest = JSON.parse(entries.get('manifest.json').text);
    assert.equal(manifest.siteId, user.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    // Every user gets their own freshly generated secrets — no shared state.
    const envFile = entries.get(user.target === 'cloudflare' ? '.dev.vars' : '.env').text;
    csrfSecrets.add(/CSRF_SECRET="?([^"\n]+)"?/.exec(envFile)[1]);
    adminHashes.add(/ADMIN_PASSWORD_HASH="?([^"\n]+)"?/.exec(envFile)[1]);
  }
  assert.equal(csrfSecrets.size, CONCURRENT_USERS, 'CSRF secrets were shared between concurrent builds');
  assert.equal(adminHashes.size, CONCURRENT_USERS, 'password hashes were shared between concurrent builds');

  const times = users.map((user) => user.ms).sort((a, b) => a - b);
  const percentile = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
  console.log(`stress: ${CONCURRENT_USERS}/${CONCURRENT_USERS} builds ok in ${wallMs.toFixed(0)}ms wall — `
    + `p50 ${percentile(50).toFixed(0)}ms, p95 ${percentile(95).toFixed(0)}ms, max ${times[times.length - 1].toFixed(0)}ms per build`);
  assert.ok(wallMs < 120_000, `stress run took too long (${wallMs.toFixed(0)}ms)`);
});
