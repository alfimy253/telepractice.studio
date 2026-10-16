import * as pageEditModule from '../public/_scaffold/templates/shared/public/page-edits.js';
import { mountOwnerPages } from '../public/_scaffold/templates/shared/public/owner-pages.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { normalizeContentGallery, paragraphs, imageUrl, contentHtml, GalleryEditor, emptyGallery, galleryCss } from '../public/_scaffold/templates/shared/public/content-gallery.js';
import { normalizePageEdits, applyPageEdits, generateBundle } from '../public/package-core.js';

const body = 'First paragraph\ncontinues here.\n\nSecond paragraph.\n\nThird.';
const images = [
  { id: 'one', url: 'https://example.test/one.jpg', paragraph: 0 },
  { id: 'two', url: '/images/two.jpg', paragraph: 0 },
  { id: 'three', url: 'https://example.test/three.jpg', paragraph: null }
];
const gallery = () => ({ title: 'Care photos', images: structuredClone(images) });
const readTemplate = (file) => readFile(new URL(`../public/_scaffold/templates/${file}`, import.meta.url), 'utf8');
const account = { adminUsername: 'galleryowner', adminEmail: 'owner@example.test', adminPassword: 'CanopyOwner!8' };
function unzip(bytes) {
  const files = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  for (let at = 0; at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true), length = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true), start = at + 30 + length + extra;
    files.set(decoder.decode(bytes.subarray(at + 30, at + 30 + length)), decoder.decode(bytes.subarray(start, start + size)));
    at = start + size;
  }
  return files;
}

test('219: paragraphs require two newlines, including CRLF and blank whitespace lines', () => {
  assert.deepEqual(paragraphs(body), ['First paragraph\ncontinues here.', 'Second paragraph.', 'Third.']);
  assert.deepEqual(paragraphs('One\r\n\r\nTwo\n \nThree'), ['One', 'Two', 'Three']);
  assert.deepEqual(paragraphs(''), []);
  assert.deepEqual(paragraphs('First\n\n'), ['First', ''], 'two newlines immediately create a new paragraph');
});

test('219: one titled gallery, unique valid URLs/IDs and two images per existing paragraph enforced', () => {
  assert.equal(normalizeContentGallery(gallery(), body).images.length, 3);
  assert.deepEqual(normalizeContentGallery(null, body), emptyGallery());
  assert.throws(() => normalizeContentGallery([gallery(), gallery()], body), /one gallery/);
  assert.throws(() => normalizeContentGallery({ title: '', images }, body), /title/);
  assert.throws(() => normalizeContentGallery({ title: 'Title', images: [] }, body), /at least one/);
  assert.throws(() => normalizeContentGallery({ title: 'Title', images: images.map((image) => ({ ...image, paragraph: 0 })) }, body), /two images/);
  assert.throws(() => normalizeContentGallery({ title: 'Title', images: [{ ...images[0], paragraph: 3 }] }, body), /existing paragraph/);
  assert.throws(() => normalizeContentGallery({ title: 'Title', images: [images[0], images[0]] }, body), /unique/);
  for (const url of ['javascript:alert(1)', '//evil.test/i.jpg', '/\\evil.test/a', 'data:image/svg+xml,x', 'https://user:password@example.test/i']) {
    assert.equal(imageUrl(url), '');
    assert.throws(() => normalizeContentGallery({ title: 'Title', images: [{ id: 'x', url }] }, body), /valid/);
  }
});

test('219: public HTML inserts only placed images, directly after the correct paragraph, side by side at 50%', () => {
  const html = contentHtml(body, normalizeContentGallery(gallery(), body));
  const dom = new JSDOM(`<div id="body">${html}</div>`);
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('img').length, 2, 'unused images never appear automatically');
    assert.equal(doc.querySelector('.content-paragraph').nextElementSibling.className, 'paragraph-images');
    assert.equal(doc.querySelector('.paragraph-images').children.length, 2);
    assert.match(galleryCss, /flex:0 0 50%;width:50%;max-width:50%/);
    assert.match(galleryCss, /gap:0/);
    assert.match(contentHtml('<script>alert(1)</script>', emptyGallery()), /&lt;script&gt;/);
  } finally { dom.window.close(); }
});

function editorHarness(initial = emptyGallery()) {
  const dom = new JSDOM('<textarea></textarea><div id="host"></div>', { url: 'https://builder.test/' });
  const doc = dom.window.document, input = doc.querySelector('textarea'), host = doc.getElementById('host');
  input.value = body;
  let saved = structuredClone(initial);
  const editor = new GalleryEditor({ host, input, getGallery: () => saved, onChange: (next) => { saved = next; } });
  const button = (label, root = doc) => [...root.querySelectorAll('button')].find((button) => button.textContent === label);
  return { dom, doc, input, host, editor, button, saved: () => saved, event: (type) => new dom.window.Event(type, { bubbles: true }) };
}

test('219: paragraph link opens creation modal; title and successful URL preview gate create/insert', () => {
  const h = editorHarness();
  try {
    h.host.querySelector('[data-paragraph="0"]').click();
    const modal = h.doc.querySelector('[role="dialog"]');
    assert.ok(modal);
    const title = modal.querySelector('[name="galleryTitle"]');
    const url = modal.querySelector('.gallery-image-row input');
    const create = h.button('Create gallery', modal);
    assert.equal(create.disabled, true);
    url.value = 'https://example.test/one.jpg'; url.dispatchEvent(h.event('input'));
    assert.equal(create.disabled, true, 'URL alone cannot enable save');
    title.value = 'My gallery'; title.dispatchEvent(h.event('input'));
    assert.equal(create.disabled, true, 'must wait for a visible image preview');
    modal.querySelector('.gallery-image-row img').dispatchEvent(h.event('load'));
    assert.equal(create.disabled, false);
    const insert = h.button('Add Image Next To Paragraph', modal);
    assert.equal(insert.disabled, false);
    insert.click();
    assert.equal(h.saved().title, 'My gallery');
    assert.equal(h.saved().images[0].paragraph, 0);
    assert.equal(h.doc.querySelector('[role="dialog"]'), null);
    assert.equal(h.host.querySelectorAll('.gallery-add-link').length, 0, 'no unused images: insertion links disappear');
    assert.ok(h.button('Edit gallery: My gallery'), 'gallery still editable after images are exhausted');
  } finally { h.editor.destroy(); h.dom.window.close(); }
});

test('219: dynamic image rows, failed previews, cancel, maximum two and image reuse controls', () => {
  const h = editorHarness(gallery());
  try {
    assert.equal(h.host.querySelector('[data-paragraph="0"]'), null, 'full paragraph has no insertion link');
    h.host.querySelector('[data-paragraph="1"]').click();
    let modal = h.doc.querySelector('[role="dialog"]');
    h.button('Add image URL', modal).click();
    assert.equal(modal.querySelectorAll('.gallery-image-row input').length, 4);
    const input = [...modal.querySelectorAll('.gallery-image-row input')].at(-1);
    input.value = 'https://example.test/four.jpg'; input.dispatchEvent(h.event('input'));
    input.closest('.gallery-image-row').querySelector('img').dispatchEvent(h.event('error'));
    assert.equal(h.button('Save gallery', modal).disabled, true);
    h.button('Cancel', modal).click();
    assert.equal(h.saved().images.length, 3, 'cancel must not mutate the gallery');
    h.host.querySelector('[data-paragraph="1"]').click(); modal = h.doc.querySelector('[role="dialog"]');
    modal.querySelectorAll('img').forEach((img) => img.dispatchEvent(h.event('load')));
    const insertions = [...modal.querySelectorAll('.gallery-image-row')].map((row) => h.button('Add Image Next To Paragraph', row));
    assert.equal(insertions[0].disabled, true, 'already placed image cannot be reused');
    assert.equal(insertions[2].disabled, false);
    insertions[2].click();
    assert.equal(h.saved().images[2].paragraph, 1);
    assert.equal(h.host.querySelectorAll('.gallery-add-link').length, 0);
    h.button('Remove from paragraph', h.host).click();
    assert.ok(h.host.querySelector('[data-paragraph="0"]'), 'returning image makes links available');
  } finally { h.editor.destroy(); h.dom.window.close(); }
});

test('219: removing paragraphs returns stranded images to the same gallery', () => {
  const initial = gallery(); initial.images[2].paragraph = 2;
  const h = editorHarness(initial);
  try {
    h.input.value = 'Only one paragraph now'; h.input.dispatchEvent(h.event('input'));
    assert.equal(h.saved().images[2].paragraph, null);
    assert.equal(h.saved().images.length, 3);
  } finally { h.editor.destroy(); h.dom.window.close(); }
});

for (const target of ['cloudflare', 'vercel']) test(`219: ${target} custom page gallery survives normalization and appears inline in generated HTML`, async () => {
  const files = unzip((await generateBundle({ target, ...account, businessName: 'Gallery Practice', customPages: [
    { id: 'care', menuName: 'Care', url: '/our-care', pageTitle: 'Our care', pageContent: body, contentGallery: gallery() }
  ] }, readTemplate)).buffer);
  const prefix = target === 'cloudflare' ? 'public/' : '';
  const html = files.get(`${prefix}our-care.html`);
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.querySelectorAll('.custom-page-content img').length, 2);
    assert.equal(dom.window.document.querySelector('.paragraph-images').previousElementSibling.textContent, 'First paragraphcontinues here.');
    assert.ok(files.has(`${prefix}content-gallery.js`));
    assert.ok(files.get('lib/content-gallery.js').includes('normalizeContentGallery'));
  } finally { dom.window.close(); }
});

test('219: one page-level gallery persists with text edits, multiple targets, and stable selector indexes', () => {
  const first = { selector: 'span', index: 0, text: 'One\n\nTwo' }, second = { selector: 'span', index: 1, text: 'Other block' };
  const pageGallery = { title: 'Page images', images: [{ ...images[0], target: 'span::0', paragraph: 1 }, { ...images[1], target: 'span::1', paragraph: 0 }] };
  const edits = normalizePageEdits([{ ...first, pageGallery }, second]);
  assert.equal(edits[0].pageGallery.images.length, 2);
  assert.throws(() => normalizePageEdits([{ ...first, pageGallery }, { ...second, pageGallery }]), /one gallery/);
  const html = applyPageEdits('<body><span>Old first</span><span>Old second</span></body>', edits, true);
  const dom = new JSDOM(html);
  try {
    const nodes = dom.window.document.querySelectorAll('body > span');
    assert.ok(nodes[0].textContent.includes('OneTwo'));
    assert.ok(nodes[1].textContent.includes('Other block'));
    assert.equal(nodes[0].querySelectorAll('img').length, 1);
    assert.equal(nodes[1].querySelectorAll('img').length, 1);
  } finally { dom.window.close(); }
});

test('219: iframe paragraph panel inserts an image and exports one shared gallery into both ZIPs', async () => {
  const dom = new JSDOM(await readFile(new URL('../public/page-editor.html', import.meta.url), 'utf8'), { url: 'https://builder.test/', runScripts: 'outside-only' });
  try {
    const win = dom.window;
    Object.assign(win, pageEditModule, { GalleryEditor, emptyGallery, normalizePageEdits, PAGE_EDIT_EXCLUDED_IDS: new Set() });
    const doc = win.document.getElementById('editorFrame').contentDocument;
    doc.body.innerHTML = '<p id="heroText">First paragraph.</p>';
    Object.defineProperty(doc.defaultView.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    const source = (await readFile(new URL('../public/page-editor.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/init\(\);\s*$/, 'window.editor = { markEditable, bindEditing, currentEdits };');
    win.eval(source);
    win.editor.markEditable(doc); win.editor.bindEditing(doc);
    doc.getElementById('heroText').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    const input = win.document.getElementById('pageGalleryText');
    input.value = 'First paragraph.\n\n'; input.dispatchEvent(new win.Event('input', { bubbles: true }));
    const host = win.document.getElementById('pageGalleryControls');
    assert.equal(host.querySelectorAll('[data-paragraph]').length, 2, 'new paragraph gains its insertion link');
    host.querySelector('[data-paragraph="1"]').click();
    const modal = win.document.querySelector('[role="dialog"]');
    const title = modal.querySelector('[name="galleryTitle"]'); title.value = 'Page photos'; title.dispatchEvent(new win.Event('input'));
    const url = modal.querySelector('.gallery-image-row input'); url.value = 'https://example.test/page.jpg'; url.dispatchEvent(new win.Event('input'));
    modal.querySelector('img').dispatchEvent(new win.Event('load'));
    [...modal.querySelectorAll('button')].find((button) => button.textContent === 'Add Image Next To Paragraph').click();
    const edits = JSON.parse(JSON.stringify(win.editor.currentEdits()));
    assert.equal(edits[0].pageGallery.images[0].target, '#heroText::0');
    assert.equal(edits[0].pageGallery.images[0].paragraph, 1);
    for (const target of ['cloudflare', 'vercel']) {
      const files = unzip((await generateBundle({ target, ...account, businessName: 'Gallery Practice', pageEdits: edits }, readTemplate)).buffer);
      const prefix = target === 'cloudflare' ? 'public/' : '';
      const rendered = new JSDOM(files.get(`${prefix}index.html`));
      try {
        const hero = rendered.window.document.getElementById('heroText');
        assert.equal(hero.querySelectorAll('img').length, 1);
        assert.equal(hero.querySelector('img').getAttribute('src'), 'https://example.test/page.jpg');
        assert.equal(hero.querySelector('.paragraph-images').previousElementSibling.textContent, '');
      } finally { rendered.window.close(); }
    }
  } finally { dom.window.close(); }
});
