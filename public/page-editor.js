// Page editor tab (opened from the builder's "Page editor" link). It loads
// the exact document the builder preview shows — the builder stashes it in
// localStorage on every render — lets the user edit plain-text elements
// inline, and on "Export to builder" posts the edits to the builder tab over
// a BroadcastChannel. The builder applies them to its preview and persists
// them server-side; once it acknowledges, this tab closes itself.
import { buildPreviewLocally } from './package-builder.js';
import { normalizePageEdits, PAGE_EDIT_EXCLUDED_IDS } from './package-core.js';
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

const originals = new Map(); // target key -> text before this session's edits
const edits = new Map(); // target key -> { selector, index, text }

function slugify(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'my-practice';
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
}
function keyOf(target) { return `${target.selector}::${target.index}`; }
function currentEdits() { return normalizePageEdits([...edits.values()]); }
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
  const { html } = await buildPreviewLocally({
    specialty: saved.specialty, businessName: saved.businessName, location: saved.location,
    email: saved.email, phone: saved.phone, theme: saved.theme,
    primaryColor: saved.primaryColor, accentColor: saved.accentColor, paperColor: saved.paperColor,
    fontStyle: saved.fontStyle, features: saved.features, payments: saved.payments,
    customPages: (Array.isArray(saved.customPages) ? saved.customPages : []).map(({ menuName, url }) => ({ menuName, url }))
  });
  return html;
}
function seedAppliedEdits() {
  const meta = readJson(PREVIEW_META_KEY);
  let seed = [];
  try { seed = normalizePageEdits(meta?.pageEdits); } catch (_) { seed = []; }
  for (const edit of seed) edits.set(keyOf(edit), edit);
  updateCount();
}

function isEditableElement(element) {
  if (!EDITABLE_TAGS.includes(element.tagName.toLowerCase())) return false;
  if (element.closest('head')) return false;
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
  const selector = selectorFor(element);
  const universe = [...doc.querySelectorAll(selector)].filter((el) => !EXCLUDED_REGIONS.some((sel) => el.closest(sel)));
  const index = universe.indexOf(element);
  return { selector, index };
}
function markEditable(doc) {
  doc.querySelectorAll(EDITABLE_TAGS.join(',')).forEach((element) => {
    if (!isEditableElement(element)) return;
    element.setAttribute('data-pe-editable', '');
    originals.set(keyOf(targetFor(element, doc)), element.innerText);
  });
  const style = doc.createElement('style');
  style.textContent = '[data-pe-editable]{cursor:text}[data-pe-editable]:hover{outline:2px dashed #376f62;outline-offset:2px}[data-pe-editable][contenteditable="true"]{outline:2px solid #376f62}';
  doc.head.appendChild(style);
}
function bindEditing(doc) {
  doc.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target.closest('[data-pe-editable]') : null;
    if (!element || element.isContentEditable) return;
    element.contentEditable = 'true';
    element.focus();
  });
  doc.addEventListener('focusout', (event) => {
    const element = event.target instanceof Element ? event.target.closest('[data-pe-editable]') : null;
    if (!element) return;
    element.contentEditable = 'false';
    const target = targetFor(element, doc);
    const key = keyOf(target);
    const text = element.innerText.replace(/\n$/, '');
    if (text === originals.get(key)) edits.delete(key);
    else edits.set(key, { ...target, text });
    updateCount();
  });
}

async function exportToBuilder() {
  const payload = currentEdits();
  const meta = readJson(PREVIEW_META_KEY) || {};
  const saved = readJson('canopy-site-config') || {};
  const siteId = meta.siteId || slugify(saved.businessName);
  exportButton.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Exporting…';
  if (typeof BroadcastChannel === 'undefined') {
    status.textContent = 'This browser cannot reach the builder tab.';
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
    status.textContent = 'Exported — the builder preview is updated.';
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
    status.textContent = 'Saved to the server — open the builder to apply the edits.';
    window.setTimeout(() => window.close(), 350);
  } else {
    status.textContent = `Export failed — ${fallback.message}`;
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
  frame.srcdoc = html;
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    markEditable(doc);
    bindEditing(doc);
  });
  exportButton.addEventListener('click', exportToBuilder);
}

init();
