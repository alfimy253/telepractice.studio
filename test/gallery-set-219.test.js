import * as pageEditModule from '../public/_scaffold/templates/shared/public/page-edits.js';
import { mountOwnerPages } from '../public/_scaffold/templates/shared/public/owner-pages.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { normalizePageEdits, applyPageEdits, generateBundle } from '../public/package-core.js';
import * as galleryModule from '../public/_scaffold/templates/shared/public/content-gallery.js';
const { normalizeContentGallery, contentHtml, galleryCss, GalleryEditor } = galleryModule;
const body = 'First paragraph.\n\nSecond paragraph.';
const images = [1, 2, 3].map((number) => ({ id: `image-${number}`, url: `https://example.test/${number}.jpg`, alt: `Photo ${number}`, paragraph: null }));
const set = (style = 'grid') => ({ title: 'All photos', images: structuredClone(images), setPlacement: { paragraph: 1, style } });
const button = (root, label) => [...root.querySelectorAll('button')].find((node) => node.textContent === label);
function editor(initial = { title: '', images: [] }) {
  const dom = new JSDOM('<textarea></textarea><div id="editor"></div>', { url: 'https://builder.test/' });
  const doc = dom.window.document, input = doc.querySelector('textarea'), host = doc.getElementById('editor');
  input.value = body;
  let value = structuredClone(initial);
  const instance = new GalleryEditor({ host, input, getGallery: () => value, onChange: (next) => { value = next; } });
  return { dom, doc, host, input, instance, value: () => value, event: (type) => new dom.window.Event(type, { bubbles: true }) };
}

test('219 follow-up: a single paragraph image fills 100%, two images remain 50% each', () => {
  for (const count of [1, 2]) {
    const gallery = { title: 'Photos', images: images.slice(0, count).map((image) => ({ ...image, paragraph: 0 })) };
    const dom = new JSDOM(`<style>${galleryCss}</style>${contentHtml(body, normalizeContentGallery(gallery, body))}`);
    try {
      const rendered = [...dom.window.document.querySelectorAll('.paragraph-images > img')];
      assert.equal(rendered.length, count);
      for (const image of rendered) assert.equal(dom.window.getComputedStyle(image).width, count === 1 ? '100%' : '50%');
    } finally { dom.window.close(); }
  }
});

test('219 follow-up: whole-gallery placement is validated as one exclusive set, not three individual images', () => {
  assert.deepEqual(normalizeContentGallery(set(), body).setPlacement, { paragraph: 1, style: 'grid' });
  assert.equal(normalizeContentGallery(set('strip'), body).setPlacement.style, 'strip');
  assert.throws(() => normalizeContentGallery(set('unsafe-class'), body), /layout/);
  assert.throws(() => normalizeContentGallery({ ...set(), setPlacement: { paragraph: 99, style: 'grid' } }, body), /existing paragraph/);
  const mixed = set(); mixed.images[0].paragraph = 0;
  assert.throws(() => normalizeContentGallery(mixed, body), /individual|exclusive/);
  assert.throws(() => normalizeContentGallery({ ...set(), images: [] }, body), /image/);
});

for (const style of ['grid', 'strip']) test(`219 follow-up: full ${style} set appears once after its selected paragraph`, () => {
  const dom = new JSDOM(contentHtml(body, normalizeContentGallery(set(style), body)));
  try {
    const doc = dom.window.document, group = doc.querySelector(`.gallery-set-${style}`);
    assert.ok(group);
    assert.equal(doc.querySelectorAll('.gallery-set').length, 1);
    assert.equal(group.querySelectorAll('img').length, 3);
    assert.equal(group.previousElementSibling.textContent, 'Second paragraph.');
    assert.equal(doc.querySelectorAll('.paragraph-images').length, 0);
  } finally { dom.window.close(); }
});

test('219 follow-up: modal can insert the entire gallery, choose CSS, edit, move and return it to the bank', () => {
  const h = editor();
  try {
    h.host.querySelector('[data-paragraph="0"]').click();
    let modal = h.doc.querySelector('[role="dialog"]');
    const insert = button(modal, 'Add entire gallery after this paragraph');
    assert.ok(insert); assert.equal(insert.disabled, true);
    const title = modal.querySelector('[name="galleryTitle"]'); title.value = 'All photos'; title.dispatchEvent(h.event('input'));
    for (let index = 0; index < 3; index++) {
      if (index) button(modal, 'Add image URL').click();
      const row = [...modal.querySelectorAll('.gallery-image-row')].at(-1);
      const url = row.querySelector('input'); url.value = images[index].url; url.dispatchEvent(h.event('input'));
      assert.equal(insert.disabled, true, 'wait for the new preview');
      row.querySelector('img').dispatchEvent(h.event('load'));
    }
    modal.querySelector('[name="galleryLayout"]').value = 'strip';
    assert.equal(insert.disabled, false); insert.click();
    assert.equal(h.value().images.length, 3);
    assert.deepEqual(h.value().setPlacement, { paragraph: 0, style: 'strip' });
    assert.ok(h.value().images.every((image) => image.paragraph === null));
    assert.equal(h.host.querySelectorAll('[data-paragraph]').length, 0, 'the set consumes all images');
    assert.equal(h.host.querySelectorAll('.gallery-set-strip img').length, 3);
    button(h.host, 'Edit gallery: All photos').click(); modal = h.doc.querySelector('[role="dialog"]');
    modal.querySelectorAll('img').forEach((image) => image.dispatchEvent(h.event('load')));
    const destination = modal.querySelector('[name="galleryParagraph"]'); destination.value = '1'; destination.dispatchEvent(h.event('change'));
    modal.querySelector('[name="galleryLayout"]').value = 'grid';
    button(modal, 'Add entire gallery after this paragraph').click();
    assert.deepEqual(h.value().setPlacement, { paragraph: 1, style: 'grid' });
    button(h.host, 'Remove gallery set').click();
    assert.equal(h.value().setPlacement, undefined);
    assert.equal(h.host.querySelectorAll('[data-paragraph]').length, 2);
  } finally { h.instance.destroy(); h.dom.window.close(); }
});

test('219 follow-up: deleting the destination paragraph releases a whole set', () => {
  const h = editor(set());
  try {
    h.input.value = 'Only first paragraph.'; h.input.dispatchEvent(h.event('input'));
    assert.equal(h.value().setPlacement, undefined);
    assert.equal(h.value().images.length, 3);
    assert.ok(h.host.querySelector('[data-paragraph="0"]'));
  } finally { h.instance.destroy(); h.dom.window.close(); }
});

test('219 follow-up: image viewer opens fullscreen, navigates, traps focus, restores scrolling/focus and isolates Escape', () => {
  const dom = new JSDOM(`<style>${galleryCss}</style>${contentHtml(body, set())}`, { url: 'https://practice.test/' });
  try {
    assert.equal(typeof galleryModule.bindGalleryLightbox, 'function');
    const doc = dom.window.document;
    const unbind = galleryModule.bindGalleryLightbox(doc);
    galleryModule.bindGalleryLightbox(doc); // must not create duplicate listeners/viewers
    let outerEscape = 0; doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') outerEscape++; });
    const trigger = doc.querySelector('.gallery-set img'); trigger.focus(); trigger.click();
    let viewer = doc.querySelector('.content-gallery-lightbox');
    assert.ok(viewer); assert.equal(doc.querySelectorAll('.content-gallery-lightbox').length, 1);
    assert.equal(viewer.getAttribute('role'), 'dialog');
    assert.equal(viewer.querySelector('img').src, images[0].url);
    viewer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(viewer.querySelector('img').src, images[1].url);
    button(viewer, 'Previous image').click(); assert.equal(viewer.querySelector('img').src, images[0].url);
    button(viewer, 'Next image').focus();
    button(viewer, 'Next image').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(doc.activeElement, button(viewer, 'Close image viewer'));
    button(viewer, 'Close image viewer').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(doc.querySelector('.content-gallery-lightbox'), null);
    assert.equal(doc.body.style.overflow, ''); assert.equal(doc.activeElement, trigger); assert.equal(outerEscape, 0);
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    viewer = doc.querySelector('.content-gallery-lightbox'); assert.ok(viewer);
    viewer.click(); assert.equal(doc.querySelector('.content-gallery-lightbox'), null);
    unbind(); trigger.click(); assert.equal(doc.querySelector('.content-gallery-lightbox'), null);
  } finally { dom.window.close(); }
});

test('219 follow-up: the gallery modal preview opens fullscreen without closing or saving the modal', () => {
  const h = editor();
  try {
    h.host.querySelector('[data-paragraph="0"]').click();
    const modal = h.doc.querySelector('[role="dialog"]');
    const input = modal.querySelector('.gallery-image-row input'); input.value = images[0].url; input.dispatchEvent(h.event('input'));
    const preview = modal.querySelector('img'); preview.dispatchEvent(h.event('load')); preview.click();
    const viewer = h.doc.querySelector('.content-gallery-lightbox'); assert.ok(viewer);
    viewer.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(h.doc.contains(modal));
    assert.equal(h.doc.activeElement, preview);
    assert.equal(h.value().images.length, 0, 'previewing must not persist an unfinished gallery');
    button(modal, 'Cancel').click();
  } finally { h.instance.destroy(); h.dom.window.close(); }
});


for (const target of ['cloudflare', 'vercel']) for (const style of ['grid', 'strip']) test(`219 follow-up: ${target}/${style} page and homepage sets survive ZIP export and open the public viewer`, async () => {
  const readTemplate = (file) => readFile(new URL(`../public/_scaffold/templates/${file}`, import.meta.url), 'utf8');
  const whole = set(style);
  const pageGallery = { ...whole, setPlacement: { ...whole.setPlacement, target: '#heroText::0' } };
  const pageEdits = normalizePageEdits([{ selector: '#heroText', index: 0, text: body, pageGallery }]);
  const { buffer: bytes } = await generateBundle({ target, businessName: 'Gallery Set QA', adminUsername: 'qaowner', adminEmail: 'qa@example.test', adminPassword: 'CanopyOwner!8', pageEdits, customPages: [
    { menuName: 'Gallery page', pageTitle: 'Gallery page', url: '/gallery-page', pageContent: body, contentGallery: whole }
  ] }, readTemplate);
  const files = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  for (let at = 0; at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true), length = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true), start = at + 30 + length + extra;
    files.set(decoder.decode(bytes.subarray(at + 30, at + 30 + length)), decoder.decode(bytes.subarray(start, start + size))); at = start + size;
  }
  const prefix = target === 'cloudflare' ? 'public/' : '';
  for (const [filename, path] of [['index.html', '/'], ['gallery-page.html', '/gallery-page.html'], ['index.html', '/blog/gallery-set']]) {
    const dom = new JSDOM(files.get(prefix + filename), { url: `https://practice.test${path}`, runScripts: 'outside-only' });
    try {
      const win = dom.window; Object.assign(win, galleryModule, pageEditModule, { mountOwnerPages });
      win.eval(files.get(prefix + 'site-config.js'));
      win.fetch = async (url) => ({ ok: true, json: async () => url === '/api/posts/gallery-set' ? { post: { title: 'Gallery article', slug: 'gallery-set', body, contentGallery: whole } } : { config: {}, posts: [], items: [] } });
      win.eval(files.get(prefix + 'site.js').replace(/^import .*;\n/gm, ''));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const root = path.startsWith('/blog/') ? win.document.getElementById('articleBody') : win.document;
      const group = root.querySelector(`.gallery-set-${style}`);
      assert.ok(group, filename);
      assert.equal(group.previousElementSibling.textContent, 'Second paragraph.');
      assert.equal(group.querySelectorAll('img').length, 3);
      group.querySelector('img').click();
      const viewer = win.document.querySelector('.content-gallery-lightbox'); assert.ok(viewer, 'site.js must bind the viewer without manual setup');
      assert.equal(viewer.querySelector('img').src, images[0].url);
      if (path.startsWith('/blog/')) {
        viewer.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.ok(win.document.getElementById('articleModal').classList.contains('open'), 'closing the viewer must not close the underlying article');
        assert.equal(win.location.pathname, '/blog/gallery-set');
      } else button(viewer, 'Close image viewer').click();
    } finally { dom.window.close(); }
  }
});

test('219 follow-up: a one-image set fills either layout and disables unnecessary viewer navigation', () => {
  for (const style of ['grid', 'strip']) {
    const dom = new JSDOM(`<style>${galleryCss}</style>${contentHtml(body, { ...set(style), images: images.slice(0, 1) })}`, { url: 'https://practice.test/' });
    try {
      const doc = dom.window.document, image = doc.querySelector('.gallery-set img');
      const css = dom.window.getComputedStyle(image);
      assert.equal(css.width, '100%');
      if (style === 'grid') assert.equal(css.gridColumn, '1/-1');
      else assert.equal(css.flexBasis, '100%');
      galleryModule.bindGalleryLightbox(doc); doc.body.style.overflow = 'hidden'; image.click();
      const viewer = doc.querySelector('.content-gallery-lightbox');
      assert.equal(button(viewer, 'Next image').disabled, true);
      assert.equal(button(viewer, 'Previous image').disabled, true);
      button(viewer, 'Close image viewer').click();
      assert.equal(doc.body.style.overflow, 'hidden', 'preserve an existing parent-dialog scroll lock');
    } finally { dom.window.close(); }
  }
});

test('219 follow-up: converting used images to a set is exclusive, preview-gated and cancelable; bank edits retain the set', () => {
  const original = { title: 'Used photos', images: images.map((image, n) => ({ ...image, paragraph: n < 2 ? 0 : 1 })) };
  const h = editor(original);
  try {
    assert.equal(h.host.querySelectorAll('[data-paragraph]').length, 0);
    const open = () => { button(h.host, 'Edit gallery: Used photos').click(); const modal = h.doc.querySelector('[role="dialog"]'); modal.querySelectorAll('img').forEach((image) => image.dispatchEvent(h.event('load'))); return modal; };
    let modal = open();
    let destination = modal.querySelector('[name="galleryParagraph"]'); destination.value = '1'; destination.dispatchEvent(h.event('change'));
    modal.querySelector('[name="galleryLayout"]').value = 'strip';
    const insert = button(modal, 'Add entire gallery after this paragraph'); assert.equal(insert.disabled, false);
    modal.querySelector('img').dispatchEvent(h.event('error')); assert.equal(insert.disabled, true);
    modal.querySelector('img').dispatchEvent(h.event('load')); assert.equal(insert.disabled, false);
    button(modal, 'Cancel').click(); assert.deepEqual(h.value(), original);
    modal = open(); destination = modal.querySelector('[name="galleryParagraph"]'); destination.value = '1'; destination.dispatchEvent(h.event('change'));
    button(modal, 'Add entire gallery after this paragraph').click();
    assert.deepEqual(h.value().setPlacement, { paragraph: 1, style: 'grid' });
    assert.ok(h.value().images.every((image) => image.paragraph === null));
    assert.equal(h.host.querySelectorAll('.paragraph-images').length, 0);
    modal = open(); modal.querySelector('[name="galleryLayout"]').value = 'strip';
    button([...modal.querySelectorAll('.gallery-image-row')].at(-1), 'Remove image').click();
    button(modal, 'Save gallery').click();
    assert.equal(h.value().images.length, 2);
    assert.deepEqual(h.value().setPlacement, { paragraph: 1, style: 'strip' });
    assert.equal(h.host.querySelectorAll('.gallery-set-strip img').length, 2);
  } finally { h.instance.destroy(); h.dom.window.close(); }
});

test('219 follow-up: actual iframe panel inserts a whole set and retains its target when another block is active', async () => {
  const dom = new JSDOM(await readFile(new URL('../public/page-editor.html', import.meta.url), 'utf8'), { url: 'https://builder.test/', runScripts: 'outside-only' });
  try {
    const win = dom.window; Object.assign(win, pageEditModule, { GalleryEditor, emptyGallery: galleryModule.emptyGallery, normalizePageEdits, PAGE_EDIT_EXCLUDED_IDS: new Set() });
    const doc = win.document.getElementById('editorFrame').contentDocument;
    doc.body.innerHTML = `<p id="heroText">${body}</p><p id="otherBlock">Another block.</p>`;
    Object.defineProperty(doc.defaultView.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    const source = (await readFile(new URL('../public/page-editor.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/init\(\);\s*$/, 'window.editor = { markEditable, bindEditing, currentEdits, captureEdit };');
    win.eval(source); win.editor.markEditable(doc); win.editor.bindEditing(doc);
    const first = doc.getElementById('heroText'); first.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    win.document.querySelector('#pageGalleryControls [data-paragraph="1"]').click();
    const modal = win.document.querySelector('[role="dialog"]');
    const title = modal.querySelector('[name="galleryTitle"]'); title.value = 'Page set'; title.dispatchEvent(new win.Event('input'));
    for (const [index, image] of images.entries()) {
      if (index) button(modal, 'Add image URL').click();
      const row = [...modal.querySelectorAll('.gallery-image-row')].at(-1), input = row.querySelector('input');
      input.value = image.url; input.dispatchEvent(new win.Event('input')); row.querySelector('img').dispatchEvent(new win.Event('load'));
    }
    button(modal, 'Add entire gallery after this paragraph').click();
    doc.getElementById('otherBlock').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    win.editor.captureEdit(first, doc); // Unchanged source must still retain the set's target record.
    const edits = JSON.parse(JSON.stringify(win.editor.currentEdits()));
    assert.ok(edits.some((edit) => edit.selector === '#heroText'));
    assert.deepEqual(edits.find((edit) => edit.pageGallery).pageGallery.setPlacement, { paragraph: 1, style: 'grid', target: '#heroText::0' });
    const rendered = new JSDOM(applyPageEdits('<p id="heroText">Old</p><p id="otherBlock">Other</p>', edits));
    try {
      assert.equal(rendered.window.document.querySelectorAll('#heroText .gallery-set img').length, 3);
      assert.equal(rendered.window.document.querySelectorAll('#otherBlock img').length, 0);
    } finally { rendered.window.close(); }
  } finally { dom.window.close(); }
});
