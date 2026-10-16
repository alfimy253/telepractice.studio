import { installDeletionControls, releaseDeletedGalleryTargets } from './_scaffold/templates/shared/public/page-edits.js';
import { GalleryEditor, emptyGallery } from './_scaffold/templates/shared/public/content-gallery.js';
// Page editor tab (opened from the builder's "Page editor" link). It loads
// the exact document the builder preview shows — the builder stashes it in
// localStorage on every render — lets the user edit plain-text elements
// inline, and on "Export to builder" posts the edits to the builder tab over
// a BroadcastChannel. The builder applies them to its preview and persists
// them server-side; once it acknowledges, this tab closes itself.
import { buildPreviewLocally } from './package-builder.js';
import { normalizePageEdits, slugify, PAGE_EDIT_EXCLUDED_IDS } from './package-core.js';
import { PAGE_EDITOR_CHANNEL, savePageEditsToServer } from './editor-bridge.js';

const PREVIEW_KEY = 'canopy-preview-html';
const PREVIEW_META_KEY = 'canopy-preview-meta';
const EDITABLE_TAGS = ['h1','h2','h3','h4','h5','h6','h7','h8','p','span','li','strong','em','small','blockquote','figcaption','label','div'];
// Regions the preview regenerates from the builder config (and the generated
// site re-renders at runtime), so edits there would not survive into the
// packaged source code. Shared with package-core so a selector+index pair
// means the same element in the editor, the preview and the packaged ZIP.
const EXCLUDED_REGIONS = [...PAGE_EDIT_EXCLUDED_IDS].map((id) => `#${id}`);

const $ = (id) => document.getElementById(id);
const frame = $('editorFrame');
const status = $('editorStatus');
const exportButton = $('exportButton');
const editCount = $('editCount');

let pageGallery = emptyGallery();
let activeGalleryEditor = null;
let activeGalleryTarget = '';
let selectedPageElement = null;
let loadedFromSavedConfig = false;
const originals = new Map(); // target key -> text before this session's edits
const seededEdits = new Map(); // persisted edits present when this session opened
const edits = new Map(); // target key -> { selector, index, text }

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
}
function keyOf(target) { return `${target.selector}::${target.index}`; }
function currentEdits() {
  const list = [...edits.values()].map(({ pageGallery: _old, ...edit }) => edit);
  if (list.length && pageGallery.images.length) list[0].pageGallery = pageGallery;
  return normalizePageEdits(list);
}
function updateCount() {
  const count = edits.size;
  editCount.hidden = count === 0;
  editCount.textContent = count ? `${count} edit${count === 1 ? '' : 's'} ready` : '';
}

// The builder tab stashes the exact preview document (and the edits already
// applied to it) on every render; fall back to building it locally when the
// editor was opened without a builder tab.
async function loadPreviewDocument() {
  const stashed = localStorage.getItem(PREVIEW_KEY);
  if (stashed) return stashed;
  const saved = readJson('canopy-site-config') || {};
  loadedFromSavedConfig = true;
  const { html } = await buildPreviewLocally({
    specialty: saved.specialty, businessName: saved.businessName, location: saved.location,
    email: saved.email, phone: saved.phone, theme: saved.theme,
    primaryColor: saved.primaryColor, accentColor: saved.accentColor, paperColor: saved.paperColor,
    fontStyle: saved.fontStyle, features: saved.features, payments: saved.payments,
    pageEdits: saved.pageEdits,
    customPages: (Array.isArray(saved.customPages) ? saved.customPages : []).map(({ menuName, url }) => ({ menuName, url }))
  });
  return html;
}
function seedAppliedEdits() {
  const meta = readJson(PREVIEW_META_KEY);
  let seed = [];
  try { seed = normalizePageEdits(loadedFromSavedConfig ? readJson('canopy-site-config')?.pageEdits : meta?.pageEdits); } catch (_) { seed = []; }
  pageGallery = seed.find((edit) => edit.pageGallery)?.pageGallery || emptyGallery();
  for (const edit of seed) { edits.set(keyOf(edit), edit); seededEdits.set(keyOf(edit), edit); }
  updateCount();
}

function isEditableElement(element) {
  if (!EDITABLE_TAGS.includes(element.tagName.toLowerCase())) return false;
  if (element.closest('head,[data-page-deleted]')) return false;
  if (EXCLUDED_REGIONS.some((selector) => element.closest(selector))) return false;
  // Only plain-text elements (plus <br> line breaks) are editable, so an edit
  // can never destroy inner markup such as icon spans.
  for (const child of element.children) if (child.tagName !== 'BR') return false;
  return true;
}
// The restricted selector grammar shared with package-core's applyPageEdits:
// #id, or tag with up to three classes. The index disambiguates repeats and
// counts only elements outside the excluded live-data regions — the same
// universe applyPageEdits matches against.
function selectorFor(element) {
  if (element.id) return `#${element.id}`;
  const tag = element.tagName.toLowerCase();
  const classes = [...element.classList].slice(0, 3).map((name) => name.replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean);
  return classes.length ? `${tag}.${classes.join('.')}` : tag;
}
function targetFor(element, doc) {
  const marked = element.getAttribute('data-page-edit-key');
  if (marked) { const at = marked.lastIndexOf('::'); return { selector: marked.slice(0, at), index: Number(marked.slice(at + 2)) }; }
  const selector = selectorFor(element);
  const universe = [...doc.querySelectorAll(selector)].filter((el) => !EXCLUDED_REGIONS.some((sel) => el.closest(sel)));
  const index = universe.indexOf(element);
  return { selector, index };
}
function markEditable(doc) {
  for (const element of doc.querySelectorAll('section')) { const target = targetFor(element, doc); element.dataset.pageEditKey = keyOf(target); }
  doc.querySelectorAll(EDITABLE_TAGS.join(',')).forEach((element) => {
    if (!isEditableElement(element)) return;
    element.dataset.pageEditKey = keyOf(targetFor(element, doc));
    element.setAttribute('data-pe-editable', '');
    originals.set(keyOf(targetFor(element, doc)), element.innerText);
  });
  const style = doc.createElement('style');
  style.textContent = '[data-pe-editable]{cursor:text}[data-pe-editable]:hover{outline:2px dashed #376f62;outline-offset:2px}[data-pe-editable][contenteditable="true"]{outline:2px solid #376f62}';
  doc.head.appendChild(style);
}
// Iframe DOM nodes belong to another realm: instanceof the parent Element
// rejects them. Use the node capability instead, including text-node targets.
function editableTarget(target) {
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  return element?.closest?.('[data-pe-editable]') || null;
}
function captureEdit(element, doc) {
  if (!element || element.closest('[data-page-deleted]')) return;
  const target = targetFor(element, doc);
  const key = keyOf(target);
  const text = (element.innerText ?? element.textContent ?? '');
  if (text === originals.get(key)) {
    if (seededEdits.has(key)) edits.set(key, seededEdits.get(key));
    else if (key === activeGalleryTarget || pageGallery.setPlacement?.target === key || pageGallery.images.some((image) => image.target === key && image.paragraph !== null)) edits.set(key, { ...target, text });
    else edits.delete(key);
  } else edits.set(key, { ...target, text });
  updateCount();
}
function showPageGalleryEditor(element, doc) {
  const panel = $('pageGalleryPanel');
  if (!panel || !['P', 'DIV', 'BLOCKQUOTE', 'LI'].includes(element.tagName)) return;
  activeGalleryEditor?.destroy();
  selectedPageElement = element;
  const target = targetFor(element, doc);
  activeGalleryTarget = keyOf(target);
  const input = $('pageGalleryText');
  input.value = (element.innerText ?? element.textContent ?? '');
  panel.hidden = false;
  activeGalleryEditor = new GalleryEditor({ host: $('pageGalleryControls'), input, target: activeGalleryTarget,
    getGallery: () => pageGallery,
    getTargets: () => ({ ...Object.fromEntries([...edits].map(([key, edit]) => [key, edit.text])), [activeGalleryTarget]: input.value }),
    onChange: (gallery) => { pageGallery = gallery; if (gallery.images.length && !edits.has(activeGalleryTarget)) edits.set(activeGalleryTarget, { ...target, text: input.value }); updateCount(); }
  });
  input.oninput = () => { element.textContent = input.value; captureEdit(element, doc); activeGalleryEditor.reconcile(); };
}
function deletePageElement(element, doc) {
  const target = targetFor(element, doc), key = keyOf(target);
  const affected = new Set([element, ...element.querySelectorAll('[data-page-edit-key]')].map((node) => node.dataset.pageEditKey).filter(Boolean));
  affected.add(key); releaseDeletedGalleryTargets(pageGallery, affected);
  for (const affectedKey of affected) edits.delete(affectedKey);
  edits.set(key, { ...target, remove: true });
  element.contentEditable = 'false'; element.hidden = true; element.dataset.pageDeleted = ''; element.style.setProperty('display', 'none', 'important');
  activeGalleryEditor?.destroy(); activeGalleryEditor = null; activeGalleryTarget = ''; selectedPageElement = null;
  if ($('pageGalleryPanel')) $('pageGalleryPanel').hidden = true;
  updateCount();
}
function bindEditing(doc) {
  installDeletionControls(doc, (element) => deletePageElement(element, doc));
  doc.addEventListener('click', (event) => {
    // The editor is not a navigation surface, including links around text.
    if (event.target?.closest?.('a')) event.preventDefault();
    const element = editableTarget(event.target);
    if (!element || element.isContentEditable) return;
    element.contentEditable = 'true';
    element.focus();
    showPageGalleryEditor(element, doc);
  });
  doc.addEventListener('input', (event) => {
    const element = editableTarget(event.target); captureEdit(element, doc);
    if (element === selectedPageElement && $('pageGalleryText')) { $('pageGalleryText').value = element.innerText ?? element.textContent; activeGalleryEditor?.reconcile(); }
  });
  doc.addEventListener('focusout', (event) => {
    const element = editableTarget(event.target);
    if (!element) return;
    element.contentEditable = 'false';
    captureEdit(element, doc);
  });
}

async function exportToBuilder() {
  const doc = frame.contentDocument;
  if (doc) captureEdit(editableTarget(doc.activeElement), doc);
  let payload;
  try { payload = currentEdits(); }
  catch (cause) { status.textContent = cause.message; status.classList.add('error'); return; }
  const meta = readJson(PREVIEW_META_KEY) || {};
  const saved = readJson('canopy-site-config') || {};
  const siteId = meta.siteId || slugify(saved.businessName);
  try {
    const { databaseUrl: _privateDatabaseUrl, ...persisted } = saved;
    localStorage.setItem('canopy-site-config', JSON.stringify({ ...persisted, pageEdits: payload }));
    localStorage.setItem(PREVIEW_META_KEY, JSON.stringify({ ...meta, pageEdits: payload }));
  } catch (_) { status.textContent = 'Could not store these edits locally. Keep this tab open and try again.'; status.classList.add('error'); return; }
  exportButton.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Exporting…';
  if (typeof BroadcastChannel === 'undefined') {
    status.textContent = 'Edits saved locally. Open the builder and Generate to include them in the deployment package.';
    status.classList.add('error');
    exportButton.disabled = false;
    return;
  }
  const channel = new BroadcastChannel(PAGE_EDITOR_CHANNEL);
  const ack = new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 6000);
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'export-ack') { window.clearTimeout(timer); resolve(event.data); }
    });
  });
  channel.postMessage({ type: 'export', siteId, edits: payload });
  const reply = await ack;
  channel.close();
  if (reply && reply.ok) {
    status.textContent = 'Exported — preview updated. Generate will include these edits in the deployment package.';
    window.setTimeout(() => {
      window.close();
      if (!window.closed) status.textContent = 'Exported — you can close this tab.';
    }, 350);
    return;
  }
  if (reply) {
    status.textContent = reply.message || 'The builder could not apply the edits.';
    status.classList.add('error');
    exportButton.disabled = false;
    return;
  }
  // No builder tab answered: persist directly so the edits are not lost.
  const fallback = await savePageEditsToServer(siteId, payload);
  if (fallback.saved) {
    status.textContent = 'Saved for the next package — open the builder and Generate.';
    window.setTimeout(() => window.close(), 350);
  } else {
    status.textContent = `Edits kept locally for the next package. Server backup failed — ${fallback.message}`;
    status.classList.add('error');
    exportButton.disabled = false;
  }
}

async function init() {
  let html;
  try { html = await loadPreviewDocument(); }
  catch (cause) {
    status.textContent = `Could not load the preview — ${cause?.message || 'unknown error'}`;
    status.classList.add('error');
    exportButton.disabled = true;
    return;
  }
  seedAppliedEdits();
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    originals.clear();
    // Strip rendered gallery spans back to editable text; the paragraph panel
    // renders the gallery, and Export builds the final inline images again.
    for (const node of doc.querySelectorAll('[data-page-edit-key]')) {
      const edit = edits.get(node.getAttribute('data-page-edit-key'));
      if (edit && !edit.remove) node.textContent = edit.text;
    }
    for (const edit of edits.values()) {
      const matches = [...doc.querySelectorAll(edit.selector)].filter((el) => !EXCLUDED_REGIONS.some((selector) => el.closest(selector)));
      const element = matches.find((node) => node.dataset.pageEditKey === keyOf(edit)) || matches[edit.index];
      if (element && !EXCLUDED_REGIONS.some((selector) => element.closest(selector))) { if (edit.remove) { element.hidden = true; element.dataset.pageDeleted = ''; } else element.textContent = edit.text; }
    }
    markEditable(doc);
    bindEditing(doc);
  });
  frame.srcdoc = html;
  exportButton.addEventListener('click', exportToBuilder);
}

init();
