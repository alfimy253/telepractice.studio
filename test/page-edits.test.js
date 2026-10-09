import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.js';
import { generateBundle, buildPreviewDocument, normalizePageEdits, applyPageEdits } from '../public/package-core.js';

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
function kvStub() {
  const store = new Map();
  return {
    store,
    async put(key, value) { store.set(key, String(value)); },
    async get(key) { return store.has(key) ? store.get(key) : null; }
  };
}
const readDisk = (filename) => readFile(new URL(`../public/_scaffold/templates/${filename}`, import.meta.url), 'utf8');
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
async function postPageEdits(env, body, auth = null) {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  if (auth) { headers.Cookie = auth.cookie; headers['X-CSRF-Token'] = auth.token; }
  return worker.fetch(new Request(`${origin}/api/page-editor`, { method: 'POST', headers, body: JSON.stringify(body) }), env);
}

test('normalizePageEdits validates, deduplicates and bounds the edit list', () => {
  const edits = normalizePageEdits([
    { selector: '#heroText', index: 0, text: 'Edited hero text' },
    { selector: 'h3.service-title', index: 1, text: 'Second service' },
    { selector: '#heroText', index: 0, text: 'Last one wins' }
  ]);
  assert.equal(edits.length, 2);
  assert.deepEqual(edits[0], { selector: '#heroText', index: 0, text: 'Last one wins' });
  assert.deepEqual(edits[1], { selector: 'h3.service-title', index: 1, text: 'Second service' });
  assert.deepEqual(normalizePageEdits(null), []);
  assert.deepEqual(normalizePageEdits(undefined), []);
  assert.throws(() => normalizePageEdits('nope'), /must be a list/);
  assert.throws(() => normalizePageEdits([{ selector: 'h1:hover', index: 0, text: 'x' }]), /Unsupported page-edit target/);
  assert.throws(() => normalizePageEdits([{ selector: 'a', index: 0, text: 'x' }]), /cannot target <a>/);
  assert.throws(() => normalizePageEdits([{ selector: 'script', index: 0, text: 'x' }]), /cannot target <script>/);
  assert.throws(() => normalizePageEdits([{ selector: 'div p', index: 0, text: 'x' }]), /Unsupported page-edit target/);
  assert.throws(() => normalizePageEdits([{ selector: '#ok', index: -1, text: 'x' }]), /target position/);
  assert.throws(() => normalizePageEdits([{ selector: '#ok', index: 1.5, text: 'x' }]), /target position/);
  assert.throws(() => normalizePageEdits([{ selector: '#ok', index: 1000, text: 'x' }]), /target position/);
  assert.throws(() => normalizePageEdits(['nope']), /target\/text object/);
  assert.throws(() => normalizePageEdits(Array.from({ length: 65 }, (_, i) => ({ selector: `#e${i}`, index: 0, text: 'x' }))), /no more than 64/);
  // Missing text is allowed: it clears the element's text.
  assert.deepEqual(normalizePageEdits([{ selector: '#ok', index: 0 }]), [{ selector: '#ok', index: 0, text: '' }]);
  // Text is bounded.
  const long = normalizePageEdits([{ selector: '#a', index: 0, text: 'x'.repeat(5000) }]);
  assert.equal(long[0].text.length, 2000);
});

test('applyPageEdits edits by id, by tag.class+index, escapes text and keeps line breaks', () => {
  const html = `<body><h1 id="title">Original</h1><h3 class="service-title">First</h3><h3 class="service-title">Second</h3><p>Plain</p></body>`;
  const edited = applyPageEdits(html, [
    { selector: '#title', index: 0, text: 'New title' },
    { selector: 'h3.service-title', index: 1, text: 'Edited second' },
    { selector: 'p', index: 0, text: 'Line one\nLine two' }
  ]);
  assert.match(edited, /<h1 id="title">New title<\/h1>/);
  assert.match(edited, /<h3 class="service-title">First<\/h3>/);
  assert.match(edited, /<h3 class="service-title">Edited second<\/h3>/);
  assert.match(edited, /<p>Line one<br>Line two<\/p>/);
  // Markup in the new text is escaped, never injected.
  const hostile = applyPageEdits(html, [{ selector: '#title', index: 0, text: '<script>alert(1)</script>' }]);
  assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(hostile, /<script>alert/);
  // Out-of-range positions are skipped silently.
  assert.equal(applyPageEdits(html, [{ selector: '#missing', index: 0, text: 'x' }]), html);
  assert.equal(applyPageEdits(html, [{ selector: 'h3.service-title', index: 9, text: 'x' }]), html);
});

test('applyPageEdits ignores style/script bodies, comments and excluded live-data regions', () => {
  const html = `<head><style>h2 { color: red }</style><!-- <h2>comment</h2> --></head><body>`
    + `<div id="galleryGrid"><h2>Preview-only heading</h2></div>`
    + `<h2>Static heading</h2>`
    + `<div id="headerCta"><span>Request a visit</span></div><span>Standalone span</span>`
    + `</body>`;
  const edited = applyPageEdits(html, [
    { selector: 'h2', index: 0, text: 'Edited static' },
    { selector: 'span', index: 0, text: 'Edited span' }
  ]);
  // The style body and the comment are not elements: the only h2 match is the
  // static one, and the excluded #galleryGrid heading is not counted.
  assert.match(edited, /<h2>Edited static<\/h2>/);
  assert.match(edited, /<div id="galleryGrid"><h2>Preview-only heading<\/h2><\/div>/);
  assert.doesNotMatch(edited, /h2 \{ color: red \}<\/h2>|color: red<\/h2>/);
  // Spans inside the excluded CTA are not counted; the standalone span is index 0.
  assert.match(edited, /<div id="headerCta"><span>Request a visit<\/span><\/div><span>Edited span<\/span>/);
  // An index pointing into an excluded region changes nothing.
  assert.equal(applyPageEdits(html, [{ selector: 'h2', index: 1, text: 'x' }]), html);
});

test('applyPageEdits tracks nested same-name tags so wrappers stay intact', () => {
  const html = `<div class="outer"><p>Keep me</p><div class="inner">Inner text</div></div>`;
  const edited = applyPageEdits(html, [{ selector: 'div.inner', index: 0, text: 'Edited inner' }]);
  assert.equal(edited, `<div class="outer"><p>Keep me</p><div class="inner">Edited inner</div></div>`);
});

test('the live preview document applies page edits, including Brivon themes', async () => {
  const illustration = await buildPreviewDocument({
    theme: 'canopy',
    pageEdits: [{ selector: '#heroEyebrow', index: 0, text: 'EDITED ILLUSTRATION EYEBROW' }]
  }, readDisk);
  assert.match(illustration.html, /EDITED ILLUSTRATION EYEBROW/);
  assert.doesNotMatch(illustration.html, /A LITTLE MORE CARE, EVERY DAY/);

  const brivon = await buildPreviewDocument({
    theme: 'brivon-dark',
    pageEdits: [
      { selector: 'h3.service-title', index: 1, text: 'Edited diagnostics card' },
      { selector: '#heroText', index: 0, text: 'Edited hero sub' }
    ]
  }, readDisk);
  assert.match(brivon.html, /Edited diagnostics card/);
  assert.match(brivon.html, /Edited hero sub/);
  assert.doesNotMatch(brivon.html, /Gentle diagnostics/);
  // Edits never leak into the generated regions of the preview.
  assert.match(brivon.html, /id="galleryGrid"/);
});

test('the prepared ZIP homepage carries the page edits for every target and theme', async () => {
  const edits = [
    { selector: '#heroEyebrow', index: 0, text: 'ZIP EDITED EYEBROW' },
    { selector: 'h3.service-title', index: 2, text: 'ZIP third service' }
  ];
  for (const target of ['vercel', 'cloudflare']) {
    const built = await generateBundle({ target, businessName: 'Edit Practice', ...adminInput, pageEdits: edits }, readDisk);
    const entries = zipEntries(built.buffer);
    const homepage = entries.get(target === 'cloudflare' ? 'public/index.html' : 'index.html');
    assert.ok(homepage, `${target}: homepage missing from ZIP`);
    assert.match(homepage.text, /ZIP EDITED EYEBROW/);
    assert.match(homepage.text, /ZIP third service/);
    assert.doesNotMatch(homepage.text, /A LITTLE MORE CARE, EVERY DAY/);
    assert.doesNotMatch(homepage.text, /Everyday support/);
  }
  // Brivon themes package the design file as index.html with the same edits.
  const brivon = await generateBundle({ target: 'vercel', businessName: 'Edit Practice', theme: 'brivon-light', ...adminInput, pageEdits: edits }, readDisk);
  const brivonEntries = zipEntries(brivon.buffer);
  const brivonHome = brivonEntries.get('index.html');
  assert.match(brivonHome.text, /ZIP EDITED EYEBROW/);
  assert.match(brivonHome.text, /ZIP third service/);
  assert.match(brivonHome.text, /brivon-shell/);
});

test('the server preview route applies page edits from the config query', async () => {
  const env = { ASSETS: assets };
  const config = encodeURIComponent(JSON.stringify({
    theme: 'canopy',
    pageEdits: [{ selector: '#heroText', index: 0, text: 'SERVER PREVIEW EDIT' }]
  }));
  const response = await worker.fetch(new Request(`${origin}/api/preview?config=${config}`), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /SERVER PREVIEW EDIT/);
  assert.doesNotMatch(html, /Thoughtful care, built around the lives you share\./);
});

test('POST /api/page-editor saves edits to the KV store with CSRF protection', async () => {
  const PAGE_EDITOR = kvStub();
  const env = { ASSETS: assets, PAGE_EDITOR };
  // CSRF is required.
  assert.equal((await postPageEdits(env, { siteId: 'edit-practice', edits: [] })).status, 403);
  const auth = await session(env);
  const edits = [
    { selector: '#heroText', index: 0, text: 'Saved hero text' },
    { selector: 'h3.service-title', index: 0, text: 'Saved service' }
  ];
  const response = await postPageEdits(env, { siteId: 'Edit-Practice', edits }, auth);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, siteId: 'edit-practice', saved: 2 });
  const stored = JSON.parse(PAGE_EDITOR.store.get('page-edits:edit-practice'));
  assert.equal(stored.siteId, 'edit-practice');
  assert.equal(stored.edits.length, 2);
  assert.equal(stored.edits[0].text, 'Saved hero text');
  assert.ok(stored.updatedAt);
  // GET returns the saved record.
  const loaded = await worker.fetch(new Request(`${origin}/api/page-editor?siteId=edit-practice`), env);
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json()).edits, edits);
  // Unknown site and bad payloads are rejected.
  assert.equal((await worker.fetch(new Request(`${origin}/api/page-editor?siteId=nope`), env)).status, 404);
  assert.equal((await postPageEdits(env, { siteId: '../evil', edits }, auth)).status, 400);
  assert.equal((await postPageEdits(env, { siteId: 'ok-site', edits: [{ selector: 'a', index: 0, text: 'x' }] }, auth)).status, 400);
  assert.equal((await postPageEdits(env, { siteId: 'ok-site', edits: 'nope' }, auth)).status, 400);
});

test('POST /api/page-editor reports a missing storage binding without failing the builder', async () => {
  const env = { ASSETS: assets };
  const auth = await session(env);
  const response = await postPageEdits(env, { siteId: 'edit-practice', edits: [] }, auth);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/);
  const loaded = await worker.fetch(new Request(`${origin}/api/page-editor?siteId=edit-practice`), env);
  assert.equal(loaded.status, 503);
});
