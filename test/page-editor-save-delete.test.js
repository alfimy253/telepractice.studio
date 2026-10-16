import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as editsModule from '../public/_scaffold/templates/shared/public/page-edits.js';
import * as galleryModule from '../public/_scaffold/templates/shared/public/content-gallery.js';
import { mountOwnerPages } from '../public/_scaffold/templates/shared/public/owner-pages.js';
import { generateBundle, normalizeConfig, slugify } from '../public/package-core.js';
const { normalizePageEdits, applyPageEdits, applyPageEditsToDocument } = editsModule;
const readTemplate = (file) => readFile(new URL(`../public/_scaffold/templates/${file}`, import.meta.url), 'utf8');
const button = (root, label) => [...root.querySelectorAll('button')].find((node) => node.textContent === label);
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const account = { adminUsername: 'ownerpages', adminEmail: 'pages@example.test', adminPassword: 'CanopyOwner!8' };
const original = '<section id="first"><p class="copy">First</p><p class="copy">Second</p></section><section id="last"><p class="copy">Third</p></section>';
function unzip(bytes) {
  const files = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  for (let at = 0; at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true), length = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true), start = at + 30 + length + extra;
    files.set(decoder.decode(bytes.subarray(at + 30, at + 30 + length)), decoder.decode(bytes.subarray(start, start + size))); at = start + size;
  } return files;
}

test('page deletion validates explicit flags, removes content, preserves stable sibling identity and escapes later edits', () => {
  assert.throws(() => normalizePageEdits([{ selector: 'section', index: 0, text: 'Destroy markup' }]), /only be deleted/);
  assert.throws(() => normalizePageEdits([{ selector: 'p', index: 0, remove: 'true' }]), /true or false/);
  const edits = normalizePageEdits([{ selector: '#first', index: 0, remove: true }, { selector: 'p.copy', index: 2, text: 'Kept <safe>' }]);
  const dom = new JSDOM(applyPageEdits(original, edits, true));
  try {
    const doc = dom.window.document;
    assert.equal(doc.getElementById('first').hidden, true); assert.equal(doc.getElementById('first').textContent, '');
    assert.equal(doc.querySelector('#last p').textContent, 'Kept <safe>');
    assert.equal(doc.querySelector('#last p').dataset.pageEditKey, 'p.copy::2');
    applyPageEditsToDocument(doc, [{ selector: 'p.copy', index: 2, text: 'Saved after reopening' }]);
    assert.equal(doc.querySelector('#last p').textContent, 'Saved after reopening');
    assert.equal(doc.querySelector('safe'), null);
  } finally { dom.window.close(); }
});

test('builder iframe delete controls stage paragraph/section removal and Export saves the package edits locally without a builder tab', async () => {
  const dom = new JSDOM(await readFile(new URL('../public/page-editor.html', import.meta.url), 'utf8'), { url: 'https://builder.test/', runScripts: 'outside-only' });
  try {
    const win = dom.window; Object.assign(win, editsModule, galleryModule, { slugify }); win.BroadcastChannel = undefined;
    const doc = win.document.getElementById('editorFrame').contentDocument; doc.body.innerHTML = original;
    Object.defineProperty(doc.defaultView.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    const source = (await readFile(new URL('../public/page-editor.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/init\(\);\s*$/, 'window.editor = { markEditable, bindEditing, currentEdits, exportToBuilder };');
    win.eval(source); win.editor.markEditable(doc); win.editor.bindEditing(doc);
    doc.querySelector('p').click(); button(doc, '× Delete paragraph').click();
    assert.equal(doc.querySelector('p').hidden, true); assert.equal(win.editor.currentEdits()[0].remove, true);
    doc.querySelectorAll('p')[1].click(); button(doc, '× Delete section').click();
    const last = doc.querySelector('#last p'); last.click(); last.textContent = 'Edited after deletion'; last.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await win.editor.exportToBuilder();
    const saved = JSON.parse(win.localStorage.getItem('canopy-site-config')).pageEdits;
    assert.ok(saved.some((edit) => edit.selector === '#first' && edit.remove));
    assert.ok(saved.some((edit) => edit.selector === 'p.copy' && edit.index === 2 && edit.text === 'Edited after deletion'));
    const output = new JSDOM(applyPageEdits(original, saved, true));
    try { assert.equal(output.window.document.querySelector('#first').textContent, ''); assert.equal(output.window.document.querySelector('#last p').textContent, 'Edited after deletion'); assert.equal(output.window.document.querySelector('#pageEditorControls'), null); }
    finally { output.window.close(); }
  } finally { dom.window.close(); }
});

for (const target of ['cloudflare', 'vercel']) for (const theme of ['canopy', 'brivon-light']) test(`${target}/${theme}: package contains deletions/text; deployed pages use saved content without export`, async () => {
  const pageEdits = [{ selector: '#heroText', index: 0, remove: true }, { selector: '#heroHeadline', index: 0, text: 'Packaged headline' }];
  const customPages = [{ menuName: 'Care', pageTitle: 'Old title', url: '/care', pageContent: 'Old content' }];
  const files = unzip((await generateBundle({ target, theme, ...account, businessName: 'Save QA', pageEdits, customPages }, readTemplate)).buffer), prefix = target === 'cloudflare' ? 'public/' : '';
  assert.match(files.get(prefix + 'owner-pages.js'), /Save page/); assert.ok(files.has('lib/page-edits.js'));
  for (const filename of ['index.html', 'care.html']) {
    const dom = new JSDOM(files.get(prefix + filename), { url: `https://practice.test/${filename}`, runScripts: 'outside-only' });
    try {
      const win = dom.window; Object.assign(win, editsModule, galleryModule);
      win.eval(files.get(prefix + 'site-config.js'));
      if (filename === 'index.html') { assert.equal(win.document.getElementById('heroText').hidden, true); assert.equal(win.document.getElementById('heroText').textContent, ''); }
      win.fetch = async () => ({ ok: true, json: async () => ({ config: { pageEdits: [...pageEdits.slice(0, 1), { selector: '#heroHeadline', index: 0, text: 'Saved live headline' }], customPages: [{ ...customPages[0], url: '/care.html', pageTitle: 'Saved page title', pageContent: 'Saved live content', contentGallery: galleryModule.emptyGallery() }] }, posts: [], items: [] }) });
      win.eval(files.get(prefix + 'site.js').replace(/^import .*;\n/gm, '')); await tick();
      if (filename === 'index.html') { assert.equal(win.document.getElementById('heroHeadline').textContent, 'Saved live headline'); assert.equal(win.document.getElementById('heroText').hidden, true); }
      else { assert.equal(win.document.querySelector('.custom-page-copy h1').textContent, 'Saved page title'); assert.equal(win.document.querySelector('.custom-page-content').textContent, 'Saved live content'); }
    } finally { dom.window.close(); }
  }
});

function ownerHarness() {
  const dom = new JSDOM('<div id="owner"></div>', { url: 'https://practice.test/studio/', runScripts: 'outside-only' });
  let config = normalizeConfig({ target: 'vercel', ...account, businessName: 'Live Save', customPages: [{ menuName: 'Care', pageTitle: 'Care', url: '/care', pageContent: 'First paragraph.\n\nSecond paragraph.' }] });
  let fail = false; const writes = [];
  const api = async (path, options = {}) => {
    assert.equal(path, '/api/site', 'deployed saving must never call the builder export API');
    if (options.method === 'PUT') { writes.push(structuredClone(options.body)); if (fail) throw new Error('Database unavailable'); config = structuredClone(options.body); }
    return { config: structuredClone(config) };
  };
  const host = dom.window.document.getElementById('owner');
  const editor = mountOwnerPages({ host, api, getSite: () => config, setSite: (next) => { config = next; }, fetchPage: async () => `<html><head><script>throw new Error('Never execute in owner preview')</script></head><body>${original}</body></html>` });
  return { dom, host, editor, writes, config: () => config, fail: (value) => { fail = value; } };
}

test('deployed custom page: one Save click persists current text/deleted paragraph; failures retain the draft', async () => {
  const h = ownerHarness();
  try {
    h.host.querySelector('select').value = '/care.html'; await h.editor.load();
    const body = h.host.querySelector('textarea'); button(h.host, 'Delete paragraph').click(); assert.equal(body.value, 'Second paragraph.');
    h.host.querySelector('input').value = 'Saved title'; h.host.querySelector('input').dispatchEvent(new h.dom.window.Event('input'));
    const save = button(h.host, 'Save page'); save.click(); save.dispatchEvent(new h.dom.window.Event('click')); await tick();
    assert.equal(h.writes.length, 1); assert.equal(h.config().customPages[0].pageTitle, 'Saved title'); assert.equal(h.config().customPages[0].pageContent, 'Second paragraph.');
    assert.match(h.host.querySelector('[role=status]').textContent, /Page saved/);
    h.fail(true); body.value = 'Do not lose this failed save'; body.dispatchEvent(new h.dom.window.Event('input')); save.click(); await tick();
    assert.equal(body.value, 'Do not lose this failed save'); assert.match(h.host.querySelector('[role=status]').textContent, /Not saved/); assert.equal(save.disabled, false);
    assert.equal(h.config().customPages[0].pageContent, 'Second paragraph.');
    h.fail(false); body.value = ''; body.dispatchEvent(new h.dom.window.Event('input')); save.click(); await tick();
    assert.equal(h.config().customPages.length, 1); assert.equal(h.config().customPages[0].pageContent, '', 'last-paragraph deletion keeps an empty page');
  } finally { h.dom.window.close(); }
});

test('deployed homepage: live delete controls and text capture save once through the site API', async () => {
  const h = ownerHarness();
  try {
    await h.editor.load(); const frame = h.host.querySelector('iframe'), loaded = frame.onload; frame.onload = null;
    assert.doesNotMatch(frame.srcdoc, /<script/); assert.equal(frame.getAttribute('sandbox'), 'allow-same-origin');
    const doc = frame.contentDocument; doc.open(); doc.write(frame.srcdoc); doc.close(); loaded();
    doc.querySelector('p').click(); button(doc, '× Delete section').click();
    const last = doc.querySelector('#last p'); last.click(); last.textContent = 'Directly saved page text'; last.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    button(h.host, 'Save page').click(); await tick();
    assert.equal(h.writes.length, 1); const saved = h.config().pageEdits;
    assert.ok(saved.some((edit) => edit.selector === '#first' && edit.remove));
    assert.ok(saved.some((edit) => edit.selector === 'p.copy' && edit.index === 2 && edit.text === 'Directly saved page text'));
    const published = new JSDOM(original); try { applyPageEditsToDocument(published.window.document, saved); assert.equal(published.window.document.querySelector('#first').textContent, ''); assert.equal(published.window.document.querySelector('#last p').textContent, 'Directly saved page text'); } finally { published.window.close(); }
  } finally { h.dom.window.close(); }
});

test('deleting a logical paragraph shifts later image/set placements and returns removed placements to the bank', () => {
  const dom = new JSDOM('<textarea></textarea><div id="gallery"></div>');
  try {
    const doc = dom.window.document, input = doc.querySelector('textarea'); input.value = 'First\n\nSecond';
    let gallery = { title: 'Photos', images: [{ id: 'one', url: 'https://example.test/one.jpg', paragraph: null }], setPlacement: { paragraph: 1, style: 'grid' } };
    const editor = new galleryModule.GalleryEditor({ host: doc.getElementById('gallery'), input, getGallery: () => gallery, onChange: (next) => { gallery = next; } });
    button(doc, 'Delete paragraph').click(); assert.equal(input.value, 'Second'); assert.equal(gallery.setPlacement.paragraph, 0);
    button(doc, 'Delete paragraph').click(); assert.equal(input.value, ''); assert.equal(gallery.setPlacement, undefined); assert.equal(gallery.images.length, 1); editor.destroy();
  } finally { dom.window.close(); }
});

test('deployed post: one Save submission writes current text directly, locks duplicate submits and retains failed drafts', async () => {
  const dom = new JSDOM(await readTemplate('shared/public/admin.html'), { url: 'https://practice.test/studio/#blog', runScripts: 'outside-only' });
  try {
    const win = dom.window; Object.assign(win, editsModule, galleryModule, { mountOwnerPages });
    win.HTMLElement.prototype.scrollIntoView = () => {};
    win.SITE_CONFIG = normalizeConfig({ target: 'vercel', ...account, businessName: 'Post Save QA', features: { scheduling: false, gallery: false } });
    const writes = []; let finish, fail = false;
    win.fetch = async (path, options = {}) => {
      if (path === '/api/admin/posts' && options.method === 'POST') {
        writes.push({ body: JSON.parse(options.body), headers: options.headers, credentials: options.credentials });
        if (fail) return { ok: false, status: 503, json: async () => ({ error: 'Database unavailable' }) };
        await new Promise((resolve) => { finish = resolve; });
      }
      return { ok: true, json: async () => ({ token: 'csrf-qa', authenticated: true, email: account.adminEmail, config: win.SITE_CONFIG, posts: [], items: [], appointments: [], slots: [], schedule: {}, payments: [] }) };
    };
    win.eval((await readTemplate('shared/public/admin.js')).replace(/^import .*;\n/gm, '')); await tick();
    assert.equal(win.document.getElementById('adminWorkspace').hidden, false);
    assert.ok(button(win.document.getElementById('ownerPagesEditor'), 'Save page'), 'deployed owner Pages editor is initialized');
    const form = win.document.getElementById('postForm');
    form.elements.title.value = 'One save'; form.elements.title.dispatchEvent(new win.Event('input'));
    form.elements.body.value = 'Delete me.\n\nLatest text to save.'; form.elements.body.dispatchEvent(new win.Event('input'));
    button(win.document.getElementById('postParagraphGallery'), 'Delete paragraph').click();
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(writes.length, 1); assert.equal(writes[0].body.body, 'Latest text to save.');
    assert.equal(writes[0].headers['X-CSRF-Token'], 'csrf-qa'); assert.equal(writes[0].credentials, 'same-origin');
    assert.equal(form.querySelector('[type=submit]').disabled, true); finish(); await tick();
    assert.equal(form.querySelector('[type=submit]').disabled, false);
    fail = true; form.elements.title.value = 'Retry title'; form.elements.body.value = 'Keep this draft';
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(form.elements.body.value, 'Keep this draft'); assert.match(win.document.getElementById('postFormMessage').textContent, /Database unavailable/);
    assert.equal(form.querySelector('[type=submit]').disabled, false);
  } finally { dom.window.close(); }
});

test('exported identities retain an existing selector alias; duplicate aliases cannot corrupt markup', () => {
  const source = '<h3 class="service-title">Original</h3><p>Sibling</p>';
  const html = applyPageEdits(source, [{ selector: '.service-title', index: 0, text: 'Old edit' }, { selector: 'h3.service-title', index: 0, text: 'Latest edit' }], true);
  const dom = new JSDOM(html);
  try { assert.equal(dom.window.document.querySelector('h3').textContent, 'Latest edit'); assert.equal(dom.window.document.querySelector('p').textContent, 'Sibling'); }
  finally { dom.window.close(); }
  const alias = new JSDOM(applyPageEdits(source, [{ selector: '.service-title', index: 0, text: 'Saved alias' }], true));
  try { assert.equal(alias.window.document.querySelector('h3').dataset.pageEditKey, '.service-title::0'); }
  finally { alias.window.close(); }
});
