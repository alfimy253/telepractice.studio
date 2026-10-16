import * as pageEditModule from '../public/_scaffold/templates/shared/public/page-edits.js';
import { mountOwnerPages } from '../public/_scaffold/templates/shared/public/owner-pages.js';
import * as galleryModule from '../public/_scaffold/templates/shared/public/content-gallery.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { normalizePageEdits, normalizeConfig, generateBundle } from '../public/package-core.js';
const readTemplate = (file) => readFile(new URL(`../public/_scaffold/templates/${file}`, import.meta.url), 'utf8');
const account = { adminUsername: 'owner214', adminEmail: 'owner@example.test', adminPassword: 'CanopyOwner!8' };
function unzip(bytes) {
  const files = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  for (let at = 0; at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true), length = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true), start = at + 30 + length + extra;
    files.set(decoder.decode(bytes.subarray(at + 30, at + 30 + length)), decoder.decode(bytes.subarray(start, start + size)));
    at = start + size;
  }
  return files;
}
function browser(html, url = 'https://practice.test/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window; Object.assign(win, galleryModule, pageEditModule, { mountOwnerPages });
  win.HTMLElement.prototype.scrollIntoView = () => {};
  return dom;
}

test('214: real iframe-realm clicks and input capture text before export, retaining seeded edits', async () => {
  const dom = browser('<iframe id="editorFrame"></iframe><span id="editorStatus"></span><button id="exportButton"></button><span id="editCount"></span>');
  try {
    const win = dom.window, frame = win.document.getElementById('editorFrame'), doc = frame.contentDocument; Object.assign(win, galleryModule, pageEditModule, { mountOwnerPages });
    doc.body.innerHTML = '<p id="heroText">Already saved text</p>';
    Object.defineProperty(frame.contentWindow.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    win.localStorage.setItem('canopy-preview-meta', JSON.stringify({ pageEdits: [{ selector: '#heroText', index: 0, text: 'Already saved text' }] }));
    win.normalizePageEdits = normalizePageEdits;
    win.PAGE_EDIT_EXCLUDED_IDS = new Set();
    const source = (await readFile(new URL('../public/page-editor.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/init\(\);\s*$/, 'window.editor = { markEditable, bindEditing, currentEdits, seedAppliedEdits };');
    win.eval(source);
    win.editor.seedAppliedEdits(); win.editor.markEditable(doc); win.editor.bindEditing(doc);
    const p = doc.getElementById('heroText');
    assert.equal(p instanceof win.Element, false, 'test must use a distinct iframe realm');
    p.dispatchEvent(new frame.contentWindow.MouseEvent('click', { bubbles: true }));
    assert.equal(p.contentEditable, 'true', 'iframe text must enter edit mode');
    p.textContent = 'Updated from iframe';
    p.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
    assert.equal(win.editor.currentEdits()[0].text, 'Updated from iframe', 'typing must be captured before focusout/export');
    p.textContent = 'Already saved text';
    p.dispatchEvent(new frame.contentWindow.FocusEvent('focusout', { bubbles: true }));
    assert.equal(win.editor.currentEdits()[0].text, 'Already saved text', 'reverting this session must retain the previously saved edit');
  } finally { dom.window.close(); }
});

for (const target of ['cloudflare', 'vercel']) for (const theme of ['canopy', 'brivon-light']) test(`214: ${target}/${theme} page edits survive both initial and refreshed runtime content`, async () => {
  const input = { target, theme, businessName: 'Runtime Clinic', ...account, pageEdits: [
    { selector: '#heroText', index: 0, text: 'Edited introduction <safe>' },
    { selector: '.service-title', index: 0, text: 'My custom service' },
    { selector: '#heroHeadline', index: 0, text: 'Custom headline\nSecond line' }
  ] };
  const files = unzip((await generateBundle(input, readTemplate)).buffer), prefix = target === 'cloudflare' ? 'public/' : '';
  const dom = browser(files.get(`${prefix}index.html`));
  try {
    const win = dom.window; Object.assign(win, galleryModule, pageEditModule, { mountOwnerPages });
    win.eval(files.get(`${prefix}site-config.js`));
    win.fetch = async (url) => ({ ok: true, json: async () => url === '/api/site' ? { config: { heroText: 'Database text', services: ['Database service'] } } : { posts: [], items: [] } });
    win.eval(files.get(`${prefix}site.js`).replace(/^import .*;\n/gm, ''));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(win.document.getElementById('heroText').textContent, 'Edited introduction <safe>');
    assert.equal(win.document.querySelector('.service-title').textContent, 'My custom service');
    assert.match(win.document.getElementById('heroHeadline').innerHTML, /Custom headline<br>Second line/);
    assert.equal(win.document.querySelector('#heroText safe'), null, 'edited text must stay escaped');
  } finally { dom.window.close(); }
});

test('214: CMS keeps its cover URL preview and has no image upload controls', async () => {
  const html = await readTemplate('shared/public/admin.html');
  const dom = browser(html);
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('#postForm input[name="featureImageUrl"]').length, 1);
    assert.equal(doc.querySelector('#postForm input[name="featureImageUrl"]').type, 'text');
    assert.equal(doc.querySelector('#postForm input[type="file"]'), null);
    assert.equal(doc.querySelector('#postGalleryRows'), null);
    assert.ok(doc.getElementById('postImagePreview'));
    const win = dom.window; Object.assign(win, galleryModule, pageEditModule, { mountOwnerPages });
    win.SITE_CONFIG = normalizeConfig({ target: 'cloudflare', businessName: 'CMS Test', ...account });
    win.fetch = async () => ({ ok: true, json: async () => ({ config: win.SITE_CONFIG, authenticated: false }) });
    win.eval((await readTemplate('shared/public/admin.js')).replace(/^import .*;\n/gm, ''));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const preview = () => doc.querySelector('[name="featureImageUrl"]').dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.querySelector('[name="featureImageUrl"]').value = 'https://example.test/image.jpg';
    preview();
    assert.equal(doc.getElementById('postImagePreview').getAttribute('src'), 'https://example.test/image.jpg');
    doc.querySelector('[name="featureImageUrl"]').value = 'javascript:alert(1)';
    preview();
    assert.equal(doc.getElementById('postImagePreview').hasAttribute('src'), false);
    doc.querySelector('[name="featureImageUrl"]').value = '/images/blog-welcome.svg';
    preview();
    assert.equal(doc.getElementById('postImagePreview').getAttribute('src'), '/images/blog-welcome.svg');
    doc.getElementById('postImagePreview').dispatchEvent(new win.Event('error'));
    assert.match(doc.getElementById('postImagePreviewMessage').textContent, /Could not load/);
    doc.querySelector('[name="featureImageUrl"]').value = '';
    preview();
    assert.equal(doc.getElementById('postImagePreviewWrap').hidden, true);
  } finally { dom.window.close(); }
});

test('214: public article links have dynamic URLs and deep links load the requested article', async () => {
  const dom = browser(await readTemplate('shared/public/index.html'), 'https://practice.test/blog/holiday-hours');
  try {
    const win = dom.window; Object.assign(win, galleryModule, pageEditModule, { mountOwnerPages });
    win.SITE_CONFIG = { features: { blog: true }, demoPosts: [] };
    const calls = [];
    win.fetch = async (url) => { calls.push(url); return { ok: true, json: async () => url === '/api/posts/holiday-hours' ? { post: { title: 'Holiday hours', slug: 'holiday-hours', body: 'Monday hours', featureImageUrl: 'https://example.test/cover.jpg' } } : { config: {}, posts: [{ title: 'Holiday hours', slug: 'holiday-hours' }], items: [] } }; };
    win.eval((await readTemplate('shared/public/site.js')).replace(/^import .*;\n/gm, ''));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(calls.includes('/api/posts/holiday-hours'));
    assert.equal(win.document.getElementById('articleTitle').textContent, 'Holiday hours');
    assert.ok(win.document.querySelector('#postGrid a[href="/blog/holiday-hours"]'));
    assert.equal(win.document.querySelectorAll('#articleModal img').length, 1);
    win.document.getElementById('articleClose').click();
    assert.equal(win.location.pathname, '/');
  } finally { dom.window.close(); }
});

test('214: Vercel deep links rewrite to the runtime and package the shared HTML shell', async () => {
  const config = JSON.parse(await readTemplate('vercel/vercel.json'));
  assert.ok(config.rewrites.some((route) => route.source === '/blog/:slug' && route.destination === '/api/index.js'));
  assert.equal(config.functions['api/index.js'].includeFiles, 'index.html');
});
