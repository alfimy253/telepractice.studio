import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyPasswordHash } from '../public/_scaffold/templates/shared/lib/admin-security.js';
import worker from '../src/index.js';

const origin = 'https://builder.example';
const adminInput = {
  adminUsername: 'practiceowner',
  adminEmail: 'owner@example.test',
  adminPassword: 'CanopyOwner!8'
};
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
function generate(env, auth, headers = {}, target = 'vercel', adminOverrides = {}) {
  return worker.fetch(new Request(`${origin}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin,
      Cookie: auth.cookie, 'X-CSRF-Token': auth.token, ...headers },
    body: JSON.stringify({ target, businessName: 'Test Practice', ...adminInput, ...adminOverrides })
  }), env);
}
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
    files.set(name, decoder.decode(bytes.subarray(dataStart, dataEnd)));
    offset = dataEnd;
  }
  return files;
}
test('builder and owner UI contain edit-page navigation but no admin-key connection flow', async () => {
  const [builderHtml, ownerHtml, ownerJs] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/_scaffold/templates/shared/public/admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/_scaffold/templates/shared/public/admin.js', import.meta.url), 'utf8')
  ]);
  assert.match(builderHtml, /id="adminUsername"/);
  assert.match(builderHtml, /id="adminEmail"/);
  assert.match(builderHtml, /id="adminPassword"/);
  for (const pageId of ['identity', 'appearance', 'blog', 'gallery', 'availability', 'appointments']) {
    assert.match(ownerHtml, new RegExp(`data-admin-page-link="${pageId}"`));
    assert.match(ownerHtml, new RegExp(`data-admin-page="${pageId}"`));
  }
  assert.doesNotMatch(`${builderHtml}\n${ownerHtml}\n${ownerJs}`, /ADMIN_API_KEY|adminKey|keyForm|sessionStorage|Bearer/i);
});
for (const secret of ['', 'test-only-secret']) {
  for (const target of ['vercel', 'cloudflare']) {
    test(`downloads ${target} ZIP ${secret ? 'with' : 'without'} a configured builder CSRF secret`, async () => {
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
  test(`rejects invalid builder CSRF requests ${secret ? 'with' : 'without'} signing`, async () => {
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
test('generated Vercel and Cloudflare packages include private admin login settings and no admin API key', async () => {
  for (const target of ['vercel', 'cloudflare']) {
    const env = { ASSETS: assets };
    const auth = await session(env);
    const response = await generate(env, auth, {}, target);
    assert.equal(response.status, 200, await response.clone().text());
    const files = zipEntries(new Uint8Array(await response.arrayBuffer()));
    const envName = target === 'cloudflare' ? '.dev.vars' : '.env';
    const variables = files.get(envName);
    assert.ok(variables, `expected generated ${envName}`);
    assert.match(variables, /^ADMIN_USERNAME="?practiceowner"?$/m);
    assert.match(variables, /^ADMIN_EMAIL="?owner@example\.test"?$/m);
    const passwordHash = variables.match(/^ADMIN_PASSWORD_HASH="?([^\r\n"]+)"?$/m)?.[1];
    assert.ok(passwordHash, 'expected an administrator password hash in the environment file');
    assert.equal(await verifyPasswordHash(adminInput.adminPassword, passwordHash), true);
    assert.doesNotMatch(variables, /ADMIN_API_KEY=/);
    assert.doesNotMatch(variables, new RegExp(adminInput.adminPassword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(files.get('.gitignore'), new RegExp(`^${envName.replace('.', '\\.')}\\n`, 'm'));

    const adminHtmlPath = target === 'cloudflare' ? 'public/admin.html' : 'admin.html';
    const adminHtml = files.get(adminHtmlPath);
    assert.ok(adminHtml, 'expected the admin login page');
    assert.match(adminHtml, /action="\/api\/admin\/login"/);
    assert.doesNotMatch(adminHtml, new RegExp(`value="${adminInput.adminUsername}"`));
    assert.doesNotMatch(adminHtml, new RegExp(`value="${adminInput.adminPassword}"`));
    for (const pageId of ['identity', 'appearance', 'blog', 'gallery', 'availability', 'appointments']) {
      assert.match(adminHtml, new RegExp(`data-admin-page-link="${pageId}"`));
      assert.match(adminHtml, new RegExp(`data-admin-page="${pageId}"`));
    }
    const adminJsPath = target === 'cloudflare' ? 'public/admin.js' : 'admin.js';
    const adminJs = files.get(adminJsPath);
    assert.match(adminJs, /showAdminPage/);
    assert.match(adminJs, /pushState/);
    assert.doesNotMatch(`${adminHtml}\n${adminJs}\n${files.get(target === 'cloudflare' ? 'public/admin.css' : 'admin.css')}`, /ADMIN_API_KEY|adminKey|keyForm|sessionStorage|Bearer/i);

    const publicConfigPath = target === 'cloudflare' ? 'public/site-config.js' : 'site-config.js';
    assert.doesNotMatch(files.get(publicConfigPath), /owner@example\.test|practiceowner/);
    assert.doesNotMatch(files.get('db/seed.sql'), /owner@example\.test|practiceowner|ADMIN_PASSWORD_HASH/);
    const siteFiles = [...files.values()].join('\n');
    assert.doesNotMatch(siteFiles, new RegExp(adminInput.adminPassword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(files.get('README.md'), /Tuesday.*rat.*Wednesday.*ant/s);
    assert.match(files.get('README.md'), /\/tadmin8\/dashboard/);
    assert.doesNotMatch(files.get('README.md'), /practiceowner|owner@example\.test|CanopyOwner!8/);
    const deployableFiles = [...files.entries()]
      .filter(([path]) => path !== envName && path !== 'README.md' && !path.startsWith('db/'))
      .map(([, contents]) => contents).join('\n');
    assert.doesNotMatch(deployableFiles, /practiceowner|owner@example\.test|CanopyOwner!8/);
    assert.match(files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js'), /adminDashboardPath/);
    if (target === 'cloudflare') assert.match(files.get('wrangler.jsonc'), /"run_worker_first": true/);
    else assert.match(files.get('vercel.json'), /:adminSegment\/dashboard/);
  }
});

test('builder rejects weak or incomplete administrator credentials before creating a ZIP', async () => {
  const env = { ASSETS: assets };
  const auth = await session(env);
  const invalidAccounts = [
    { adminPassword: 'Abcdef1!234' },
    { adminPassword: 'ABCDEFGHIJ1!' },
    { adminPassword: 'abcdefghij1!' },
    { adminPassword: 'Abcdefghij!!' },
    { adminPassword: 'Abcdefghij12' },
    { adminUsername: 'x' },
    { adminEmail: 'bad-address' }
  ];
  for (const invalid of invalidAccounts) {
    const response = await generate(env, auth, {}, 'vercel', invalid);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /administrator/i);
  }
});

test('configured signing rejects forged matching CSRF cookie and header', async () => {
  const token = `${'a'.repeat(32)}.${'b'.repeat(43)}`;
  assert.equal((await generate({ CSRF_SECRET: 'secret' }, {
    token, cookie: `__Host-canopy_builder_csrf=${token}`
  })).status, 403);
});
test('builder CSRF token issuance rejects cross-origin requests', async () => {
  const response = await worker.fetch(new Request(`${origin}/api/csrf`, {
    headers: { Origin: 'https://evil.example' }
  }), {});
  assert.equal(response.status, 403);
});
test('builder CSRF tokens are random and HTTP localhost remains supported', async () => {
  const a = await session({}, 'http://localhost:8787');
  const b = await session({}, 'http://localhost:8787');
  assert.notEqual(a.token, b.token);
  assert.match(a.cookie, /^canopy_builder_csrf=/);
});
