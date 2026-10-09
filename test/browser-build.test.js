import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.js';
import { requestGeneratedPackage } from '../public/download.js';
import { generateBundle } from '../public/package-core.js';

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
async function session(env) {
  const response = await worker.fetch(new Request(`${origin}/api/csrf`), env);
  assert.equal(response.status, 200);
  const { token } = await response.json();
  return { token, cookie: response.headers.get('Set-Cookie').split(';')[0] };
}
async function generateViaWorker(env, target, extra = {}) {
  const auth = await session(env);
  const response = await worker.fetch(new Request(`${origin}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: auth.cookie, 'X-CSRF-Token': auth.token },
    body: JSON.stringify({ target, businessName: 'Fallback Practice', ...adminInput, ...extra })
  }), env);
  assert.equal(response.status, 200, await response.clone().text());
  return zipEntries(new Uint8Array(await response.arrayBuffer()));
}
// Mirrors the browser's fetch-based template reader: every template is read
// through the Worker's public /_scaffold/templates/ route, exactly like
// package-builder.js does in the fallback build.
function browserReadTemplate() {
  return async (filename) => {
    const response = await worker.fetch(new Request(
      `${origin}/_scaffold/templates/${filename.split('/').map(encodeURIComponent).join('/')}`
    ), { ASSETS: assets });
    if (!response.ok) throw new Error(`Missing build scaffold file: ${filename}`);
    return response.text();
  };
}

test('worker serves scaffold templates for the browser build but hides the rest of /_scaffold/', async () => {
  const env = { ASSETS: assets };
  const manifest = await worker.fetch(new Request(`${origin}/_scaffold/templates/manifest.json`), env);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('Cache-Control'), 'no-store');
  assert.ok(Array.isArray(JSON.parse(await manifest.text()).sharedPublic));
  for (const file of ['shared/lib/admin-security.js', 'shared/public/site.js', 'cloudflare/src/index.js']) {
    const response = await worker.fetch(new Request(`${origin}/_scaffold/templates/${file}`), env);
    assert.equal(response.status, 200, `expected ${file} to be readable by the browser build`);
    assert.ok((await response.text()).length > 0);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await worker.fetch(new Request(`${origin}/_scaffold/other.txt`), env)).status, 404);
  assert.equal((await worker.fetch(new Request(`${origin}/_scaffold/templates/manifest.json`, { method: 'POST' }), env)).status, 404);
});

test('browser-side package build through served templates matches the worker ZIP structure', async () => {
  const env = { ASSETS: assets };
  for (const target of ['vercel', 'cloudflare']) {
    const viaWorker = await generateViaWorker(env, target, {
      customPages: [{ id: 'rates', menuName: 'Rates', url: '/rates.html', pageTitle: 'Rates', pageContent: 'Our rates.' }]
    });
    const built = await generateBundle({
      target, businessName: 'Fallback Practice', ...adminInput,
      customPages: [{ id: 'rates', menuName: 'Rates', url: '/rates.html', pageTitle: 'Rates', pageContent: 'Our rates.' }]
    }, browserReadTemplate());
    const locally = zipEntries(built.buffer);
    assert.equal(built.filename, `fallback-practice-${target}.zip`);
    assert.deepEqual([...locally.keys()], [...viaWorker.keys()], `${target}: entry lists diverged`);
    for (const [name, entry] of viaWorker) {
      assert.equal(locally.get(name).size, entry.size, `${target}: ${name} size diverged`);
    }
    // Deterministic files must be byte-identical between both build paths.
    for (const name of ['.gitignore', target === 'cloudflare' ? 'wrangler.jsonc' : 'vercel.json', 'db/schema.sql']) {
      assert.equal(locally.get(name).text, viaWorker.get(name).text, `${target}: ${name} content diverged`);
    }
  }
});

test('generate failures report the actual error string instead of a generic 500', async () => {
  const brokenAssets = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith('manifest.json')) return new Response('nope', { status: 404 });
      return assets.fetch(request);
    }
  };
  const env = { ASSETS: brokenAssets };
  const auth = await session({ ASSETS: assets });
  const response = await worker.fetch(new Request(`${origin}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: auth.cookie, 'X-CSRF-Token': auth.token },
    body: JSON.stringify({ target: 'cloudflare', businessName: 'Broken', ...adminInput })
  }), env);
  assert.equal(response.status, 500);
  const { error } = await response.json();
  assert.match(error, /Missing build scaffold file: manifest\.json/);
});

test('browser Generate client surfaces plain-text platform errors like CPU-limit kills', async () => {
  const fetcher = async (path, options) => {
    if (path === '/api/csrf') {
      return new Response(JSON.stringify({ token: 'csrf-token-value' }), { status: 200 });
    }
    assert.equal(options.headers['X-CSRF-Token'], 'csrf-token-value');
    return new Response('error code: 1102\nRay ID: abc\n', { status: 503 });
  };
  await assert.rejects(
    requestGeneratedPackage('cloudflare', {}, 'Cloudflare', fetcher),
    /error code: 1102[\s\S]*Ray ID: abc \(\/api\/generate → 503\)/
  );
  const jsonFetcher = async (path) => {
    if (path === '/api/csrf') return new Response(JSON.stringify({ token: 't' }), { status: 200 });
    return new Response(JSON.stringify({ error: 'The configuration is too large.' }), { status: 413 });
  };
  await assert.rejects(
    requestGeneratedPackage('vercel', {}, 'Vercel', jsonFetcher),
    /The configuration is too large\. \(\/api\/generate → 413\)/
  );
});

test('Generate keeps a click-time snapshot and locks the builder while the ZIP is prepared', async () => {
  const [app, html, styles, builder] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/package-builder.js', import.meta.url), 'utf8')
  ]);
  // The payload is captured once at click time and drives both build paths.
  assert.match(app, /const payload = configForPackage\(\);/);
  assert.match(app, /buildPackageLocally\(\{ \.\.\.payload, target \}\)/);
  assert.match(app, /import \{ buildPackageLocally, buildPreviewLocally \} from '\.\/package-builder\.js';/);
  // Every control is locked for the whole generation window and restored after.
  assert.match(app, /function setBuilderLocked\(locked\)/);
  assert.match(app, /document\.body\.classList\.add\('builder-locked'\)/);
  assert.match(app, /document\.body\.classList\.remove\('builder-locked'\)/);
  assert.match(app, /setBuilderLocked\(true\);/);
  assert.match(app, /setBuilderLocked\(false\);/);
  assert.match(app, /event\.preventDefault\(\);\s*\n\s*event\.stopPropagation\(\);/);
  assert.match(html, /id="generatingChip"[^>]*hidden/);
  assert.match(styles, /body\.builder-locked/);
  assert.match(styles, /\.generating-chip/);
  // The shared core is what the fallback runs — one implementation, two hosts.
  assert.match(builder, /import \{ buildPreviewDocument, generateBundle \} from '\.\/package-core\.js';/);
  assert.match(builder, /async function buildPackageLocally\(payload\)/);
});

test('editorial accent buttons map their swatch colors to the stored accent key', async () => {
  const [app, html] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8')
  ]);
  assert.match(html, /data-editorial-accent="#202522"/);
  assert.match(html, /data-editorial-accent="#187c78"/);
  assert.match(html, /data-editorial-accent="#2e6049"/);
  // The click handler passes the swatch color; setEditorialAccent must resolve
  // it back to the 'black'/'teal'/'forest' key instead of bailing out.
  assert.match(app, /setEditorialAccent\(button\.dataset\.editorialAccent\)/);
  assert.match(app, /Object\.hasOwn\(EDITORIAL_ACCENTS, accent\)/);
  assert.match(app, /EDITORIAL_ACCENTS\[name\]\.toLowerCase\(\) === String\(accent \|\| ''\)\.toLowerCase\(\)/);
  assert.match(app, /config\.editorialAccent = key;/);
});

test('package-builder template cache serves warm builds without re-fetching', async () => {
  const { buildPackageLocally } = await import('../public/package-builder.js');
  const realFetch = globalThis.fetch;
  const realLocation = globalThis.location;
  const calls = new Map();
  globalThis.location = new URL(origin + '/');
  globalThis.fetch = async (url, options) => {
    const path = new URL(url, origin).pathname;
    assert.equal(options.cache, 'no-store', `${path} must not reuse templates from an older deployment`);
    calls.set(path, (calls.get(path) || 0) + 1);
    return worker.fetch(new Request(new URL(path, origin), options), { ASSETS: assets });
  };
  try {
    const input = { target: 'vercel', businessName: 'Cache Practice', ...adminInput };
    const cold = await buildPackageLocally(input);
    const warm = await buildPackageLocally(input);
    assert.ok(cold.buffer.length > 1000);
    assert.ok(warm.buffer.length > 1000);
    for (const [path, count] of calls) assert.equal(count, 1, `${path} was re-fetched on the warm build`);
  } finally {
    globalThis.fetch = realFetch;
    if (realLocation === undefined) delete globalThis.location; else globalThis.location = realLocation;
  }
});

test('discrete builder controls refresh the preview immediately while typing stays debounced', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /function scheduleLivePreview\(immediate = false\)/);
  for (const control of ['blogToggle', 'galleryToggle', 'bookingToggle']) {
    assert.match(app, new RegExp(`\\$\\('${control}'\\)\\.addEventListener\\('change',[^\\n]*updatePreview\\(true\\)`), control);
  }
  assert.match(app, /function saveConfig\(immediate = false\)/);
  assert.match(app, /function updatePreview\(immediate = false\)/);
  assert.match(app, /livePreviewController\?\.abort\(\)/);
  assert.match(app, /await buildPreviewLocally\(config\)/);
  assert.match(app, /\/api\/preview\?config=/);
});
