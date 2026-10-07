import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.js';

const origin = 'https://builder.example';
const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    return new Response(await readFile(new URL(`../public${path}`, import.meta.url)));
  }
};
async function session(env = {}, base = origin) {
  const response = await worker.fetch(new Request(`${base}/api/csrf`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const { token } = await response.json();
  const setCookie = response.headers.get('Set-Cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  if (base.startsWith('https:')) {
    assert.match(setCookie, /^__Host-canopy_builder_csrf=/);
    assert.match(setCookie, /; Secure/);
    assert.doesNotMatch(setCookie, /Domain=/i);
  }
  return { token, cookie: setCookie.split(';')[0] };
}
function generate(env, session, headers = {}, target = 'vercel') {
  return worker.fetch(new Request(`${origin}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin,
      Cookie: session.cookie, 'X-CSRF-Token': session.token, ...headers },
    body: JSON.stringify({ target, businessName: 'Test Practice' })
  }), env);
}
for (const secret of ['', 'test-only-secret']) {
  for (const target of ['vercel', 'cloudflare']) {
    test(`downloads ${target} ZIP ${secret ? 'with' : 'without'} a configured secret`, async () => {
      const env = { CSRF_SECRET: secret, ASSETS: assets };
      const auth = await session(env);
      const response = await generate(env, auth, {}, target);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('Content-Type'), 'application/zip');
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
      assert.ok(bytes.length > 1000);
    });
  }
  test(`rejects invalid CSRF requests ${secret ? 'with' : 'without'} signing`, async () => {
    const env = { CSRF_SECRET: secret };
    const auth = await session(env);
    for (const headers of [
      { Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
      { Cookie: '' },
      { Cookie: `canopy_builder_csrf=${auth.token}` },
      { 'X-CSRF-Token': '' },
      { 'X-CSRF-Token': `${auth.token}tampered` }
    ]) assert.equal((await generate(env, auth, headers)).status, 403);
    const invalid = 'invalid';
    assert.equal((await generate(env, { token: invalid, cookie: `__Host-canopy_builder_csrf=${invalid}` })).status, 403);
  });
}
test('configured signing rejects forged matching cookie and header', async () => {
  const token = `${'a'.repeat(32)}.${'b'.repeat(43)}`;
  assert.equal((await generate({ CSRF_SECRET: 'secret' }, {
    token, cookie: `__Host-canopy_builder_csrf=${token}`
  })).status, 403);
});
test('token issuance rejects cross-origin requests', async () => {
  const response = await worker.fetch(new Request(`${origin}/api/csrf`, {
    headers: { Origin: 'https://evil.example' }
  }), {});
  assert.equal(response.status, 403);
});
test('tokens are random and HTTP localhost remains supported', async () => {
  const a = await session({}, 'http://localhost:8787');
  const b = await session({}, 'http://localhost:8787');
  assert.notEqual(a.token, b.token);
  assert.match(a.cookie, /^canopy_builder_csrf=/);
});
