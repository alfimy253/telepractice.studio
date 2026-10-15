import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Behavioral tests for the page editor bridge: the "Page editor" link opens
// the editor tab, an "Export to builder" message from that tab applies the
// edits to the builder config (persisted + preview re-render), saves them
// through POST /api/page-editor, and acknowledges so the editor tab can
// close. Runs the real public/app.js under a minimal DOM stub.

globalThis.Element ??= class Element {};

class StubBroadcastChannel {
  static registry = new Map();
  static reset() { StubBroadcastChannel.registry = new Map(); }
  constructor(name) {
    this.name = name;
    this.listeners = [];
    if (!StubBroadcastChannel.registry.has(name)) StubBroadcastChannel.registry.set(name, new Set());
    StubBroadcastChannel.registry.get(name).add(this);
  }
  addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); }
  removeEventListener() {}
  postMessage(data) {
    for (const peer of StubBroadcastChannel.registry.get(this.name) || []) {
      if (peer === this) continue;
      for (const fn of peer.listeners) queueMicrotask(() => fn({ data: structuredClone(data) }));
    }
  }
  close() { StubBroadcastChannel.registry.get(this.name)?.delete(this); }
}

class StubElement extends Element {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.type = 'text';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.classes = new Set();
    this.children = [];
    this.listeners = new Map();
    this.removed = false;
    this.doc = null;
    const self = this;
    this.classList = {
      add: (...names) => names.forEach((name) => self.classes.add(name)),
      remove: (...names) => names.forEach((name) => self.classes.delete(name)),
      toggle: (name, force) => {
        const on = force ?? !self.classes.has(name);
        if (on) self.classes.add(name); else self.classes.delete(name);
        return on;
      },
      contains: (name) => self.classes.has(name)
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener() {}
  appendChild(child) { this.children.push(child); return child; }
  remove() { this.removed = true; }
  querySelector() { return new StubElement(); }
  querySelectorAll() { return []; }
  matches() { return false; }
  closest(selector) { return selector === 'a' && this.tagName === 'A' ? this : null; }
  focus() {}
  checkValidity() { return true; }
  reportValidity() {}
  setCustomValidity() {}
  click() { return this.doc.dispatchClick(this); }
  // The tests use `textContent` to assert what the user sees. The builder
  // sets `innerHTML` to a string of markup, so derive a flat textContent
  // whenever the markup changes; the simple stripper covers the small set
  // of tags the app actually emits.
  set innerHTML(value) { this._innerHTML = value; this.textContent = String(value).replace(/<[^>]+>/g, ''); }
  get innerHTML() { return this._innerHTML ?? ''; }
}

function makeDocument() {
  const elements = new Map();
  const documentListeners = new Map();
  const doc = {
    clickEvents: [],
    body: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, doc.createElement('div'));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      const element = new StubElement(tag);
      element.doc = doc;
      return element;
    },
    addEventListener(type, fn, capture = false) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push({ fn, capture: Boolean(capture) });
    },
    removeEventListener() {},
    dispatchClick(target) {
      const event = {
        type: 'click', target, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {}
      };
      const registered = documentListeners.get('click') || [];
      for (const { fn, capture } of registered) if (capture) fn(event);
      for (const fn of target.listeners.get('click') || []) fn(event);
      for (const { fn, capture } of registered) if (!capture) fn(event);
      doc.clickEvents.push(event);
      return event;
    }
  };
  doc.body = doc.createElement('body');
  return doc;
}

const TEMPLATE_ROOT = new URL('../public/_scaffold/templates/', import.meta.url);
const readTemplateFile = (filename) => readFile(new URL(filename, TEMPLATE_ROOT), 'utf8');

function installDom({ serverPageEdits = { edits: [], updatedAt: '1970-01-01T00:00:00.000Z' } } = {}) {
  StubBroadcastChannel.reset();
  const doc = makeDocument();
  const storage = new Map([['canopy-tour-complete', 'true']]);
  const opened = [];
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    fetch: globalThis.fetch,
    BroadcastChannel: globalThis.BroadcastChannel,
    Element: globalThis.Element
  };
  const saves = [];
  const getPageEditorCalls = [];
  globalThis.document = doc;
  globalThis.window = {
    setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {}, innerWidth: 1280,
    open: (url, target, features) => { opened.push({ url, target, features }); return null; }
  };
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.location = new URL('https://builder.test/');
  globalThis.BroadcastChannel = StubBroadcastChannel;
  globalThis.Element = Element;
  globalThis.fetch = async (input, options = {}) => {
    const path = new URL(String(input), 'https://builder.test').pathname;
    if (path === '/api/csrf') {
      return new Response(JSON.stringify({ token: 'test-csrf-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/api/page-editor' && options.method === 'POST') {
      saves.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true, siteId: JSON.parse(options.body).siteId, saved: JSON.parse(options.body).edits.length }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (path === '/api/page-editor' && options.method === 'GET') {
      const siteId = new URL(String(input), 'https://builder.test').searchParams.get('siteId');
      getPageEditorCalls.push({ siteId });
      const body = typeof serverPageEdits === 'function' ? serverPageEdits(siteId) : { siteId, ...serverPageEdits };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path.startsWith('/_scaffold/templates/')) {
      const filename = decodeURIComponent(path.slice('/_scaffold/templates/'.length));
      return new Response(await readTemplateFile(filename), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return {
    doc,
    storage,
    opened,
    saves,
    getPageEditorCalls,
    restore() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    }
  };
}

async function waitFor(condition, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
}

let importCounter = 0;
async function bootBuilder() {
  const dom = installDom();
  await import(`../public/app.js?editor-bridge-${importCounter += 1}`);
  return dom;
}

function savedConfig(dom) {
  return JSON.parse(dom.storage.get('canopy-site-config'));
}

test('the "Page editor" link opens the editor page in a new tab', async () => {
  const dom = await bootBuilder();
  try {
    const link = dom.doc.getElementById('openPageEditor');
    const [handler] = link.listeners.get('click');
    assert.ok(handler, 'the Page editor link has a click handler');
    handler.call(link, { type: 'click', target: link });
    assert.equal(dom.opened.length, 1);
    assert.equal(dom.opened[0].url, '/page-editor.html');
    assert.equal(dom.opened[0].target, '_blank');
  } finally {
    dom.restore();
  }
});

test('an "Export to builder" message applies the edits, saves them server-side and acknowledges', async () => {
  const dom = await bootBuilder();
  try {
    const editorTab = new BroadcastChannel('canopy-page-editor');
    const acks = [];
    editorTab.addEventListener('message', (event) => acks.push(event.data));
    const edits = [
      { selector: '#heroText', index: 0, text: 'Edited from the page editor' },
      { selector: 'h3.service-title', index: 1, text: 'Second service edited' }
    ];
    editorTab.postMessage({ type: 'export', siteId: 'harborlight-veterinary-care', edits });

    assert.ok(await waitFor(() => acks.length > 0), 'the builder never acknowledged the export');
    assert.equal(acks[0].type, 'export-ack');
    assert.equal(acks[0].ok, true);
    assert.equal(acks[0].saved, true);

    // The builder config persisted the edits.
    const config = savedConfig(dom);
    assert.deepEqual(config.pageEdits, edits);
    // The server save was triggered with the builder's own site id.
    assert.equal(dom.saves.length, 1);
    assert.equal(dom.saves[0].siteId, 'harborlight-veterinary-care');
    assert.deepEqual(dom.saves[0].edits, edits);
    // The preview re-rendered with the edits and stashed the exact document
    // the page editor tab loads.
    assert.ok(await waitFor(() => (dom.storage.get('canopy-preview-html') || '').includes('Edited from the page editor')),
      'the preview was not re-rendered with the exported edits');
    const stashed = dom.storage.get('canopy-preview-html');
    assert.ok(stashed.includes('Second service edited'));
    const meta = JSON.parse(dom.storage.get('canopy-preview-meta'));
    assert.equal(meta.siteId, 'harborlight-veterinary-care');
    assert.deepEqual(meta.pageEdits, edits);
    // The layout section shows the applied edits.
    const status = dom.doc.getElementById('pageEditorStatus');
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /2 edits applied/);
    assert.equal(dom.doc.getElementById('clearPageEdits').hidden, false);
    editorTab.close();
  } finally {
    dom.restore();
  }
});

test('invalid export payloads are rejected without touching the builder config', async () => {
  const dom = await bootBuilder();
  try {
    const editorTab = new BroadcastChannel('canopy-page-editor');
    const acks = [];
    editorTab.addEventListener('message', (event) => acks.push(event.data));
    editorTab.postMessage({ type: 'export', siteId: 'x', edits: [{ selector: 'a', index: 0, text: 'nope' }] });
    assert.ok(await waitFor(() => acks.length > 0), 'no acknowledgement for the invalid export');
    assert.equal(acks[0].ok, false);
    assert.equal(dom.saves.length, 0);
    assert.equal(savedConfig(dom).pageEdits.length, 0);
    editorTab.close();
  } finally {
    dom.restore();
  }
});

test('the "Clear edits" button removes the page edits and hides the status', async () => {
  const dom = await bootBuilder();
  try {
    const editorTab = new BroadcastChannel('canopy-page-editor');
    editorTab.postMessage({ type: 'export', siteId: 'harborlight-veterinary-care', edits: [{ selector: '#heroText', index: 0, text: 'To be cleared' }] });
    assert.ok(await waitFor(() => savedConfig(dom).pageEdits.length === 1), 'edits were not applied');
    // Let the export's preview re-render finish before touching anything else.
    assert.ok(await waitFor(() => (dom.storage.get('canopy-preview-html') || '').includes('To be cleared')), 'preview was not re-rendered');
    const clear = dom.doc.getElementById('clearPageEdits');
    const [handler] = clear.listeners.get('click');
    handler.call(clear, { type: 'click', target: clear });
    assert.equal(savedConfig(dom).pageEdits.length, 0);
    assert.equal(dom.doc.getElementById('pageEditorStatus').hidden, true);
    assert.equal(dom.doc.getElementById('clearPageEdits').hidden, true);
    // Let the cleared preview re-render finish before the stubs are removed.
    assert.ok(await waitFor(() => !(dom.storage.get('canopy-preview-html') || '').includes('To be cleared')), 'cleared preview was not re-rendered');
    editorTab.close();
  } finally {
    dom.restore();
  }
});

test('a server save failure surfaces as a builder toast instead of a silent success', async () => {
  // The merge round-trip in test 5 already covers a successful server save.
  // Here we force the POST to return 503 (no database) so the bridge's
  // never-throws contract kicks in and the notify callback must report the
  // failure. The user has to know the preview is local-only.
  const dom = await bootBuilder();
  // Replace the global fetch with one that returns 503 on the POST.
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const path = new URL(String(input), 'https://builder.test').pathname;
    if (path === '/api/csrf') return new Response(JSON.stringify({ token: 'test-csrf-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/page-editor' && options.method === 'POST') {
      return new Response(JSON.stringify({ error: 'Page editor database is not configured on this deployment.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return previousFetch(input, options);
  };
  try {
    const editorTab = new BroadcastChannel('canopy-page-editor');
    const acks = [];
    editorTab.addEventListener('message', (event) => acks.push(event.data));
    const edits = [{ selector: '#heroText', index: 0, text: 'Will save locally only' }];
    editorTab.postMessage({ type: 'export', siteId: 'harborlight-veterinary-care', edits });
    assert.ok(await waitFor(() => acks.length > 0), 'the builder never acknowledged the export');
    // The ack tells the editor tab the save failed.
    assert.equal(acks[0].ok, true);
    assert.equal(acks[0].saved, false);
    // The builder config still has the edits (local preview is the offline cache).
    assert.deepEqual(savedConfig(dom).pageEdits, edits);
    // The notify callback called the toast with the error path.
    const region = dom.doc.getElementById('toastRegion');
    const latestToast = () => region.children[region.children.length - 1];
    assert.ok(await waitFor(() => latestToast() && /server save failed/.test(latestToast().textContent || '')),
      'the builder never toasted the server save failure');
    const errorToast = latestToast();
    assert.match(errorToast.className, /error/);
    assert.match(errorToast.textContent, /Page edits applied/);
    assert.match(errorToast.textContent, /server save failed/);
    editorTab.close();
  } finally {
    globalThis.fetch = previousFetch;
    dom.restore();
  }
});

test('the builder fetches the saved page edits at startup and merges them when the server is newer', async () => {
  const serverEdits = [
    { selector: '#heroText', index: 0, text: 'Server-sourced hero text' },
    { selector: 'h3.service-title', index: 0, text: 'Server-sourced service' }
  ];
  const dom = installDom({
    serverPageEdits: { edits: serverEdits, updatedAt: '2030-01-01T00:00:00.000Z' }
  });
  try {
    await import(`../public/app.js?editor-bridge-merge-${Date.now()}`);
    // Wait for the merge round-trip to complete and the local config to update.
    assert.ok(await waitFor(() => savedConfig(dom).pageEdits.length === 2),
      'the builder did not merge the server edits into the local config');
    const config = savedConfig(dom);
    assert.deepEqual(config.pageEdits, serverEdits);
    // The merge asks for the builder's own site id.
    assert.equal(dom.getPageEditorCalls.length, 1);
    assert.equal(dom.getPageEditorCalls[0].siteId, 'harborlight-veterinary-care');
    // The merged timestamp is recorded so a subsequent load does not re-fetch.
    assert.equal(dom.storage.get('canopy-page-edits-updated-at'), String(Date.parse('2030-01-01T00:00:00.000Z')));
    // The preview re-render fires after the merge and writes the new HTML;
    // wait for it before tearing the stubs down.
    assert.ok(await waitFor(() => (dom.storage.get('canopy-preview-html') || '').includes('Server-sourced hero text')),
      'the preview was not re-rendered with the merged server edits');
  } finally {
    dom.restore();
  }
});

test('the builder keeps the local copy when the server record is older than localStorage', async () => {
  // Simulate a builder that already cached a fresher record from a previous
  // session. The server returns a 2025 timestamp; localStorage has 2030.
  const dom = installDom({
    serverPageEdits: { edits: [{ selector: '#heroText', index: 0, text: 'Old server text' }], updatedAt: '2025-01-01T00:00:00.000Z' }
  });
  try {
    dom.storage.set('canopy-page-edits-updated-at', String(Date.parse('2030-06-15T00:00:00.000Z')));
    dom.storage.set('canopy-site-config', JSON.stringify({
      businessName: 'Harborlight Veterinary Care',
      pageEdits: [{ selector: '#heroText', index: 0, text: 'Newer local edit' }]
    }));
    await import(`../public/app.js?editor-bridge-merge-older-${Date.now()}`);
    // Wait for the merge round-trip to settle, then assert the local copy won.
    assert.ok(await waitFor(() => dom.getPageEditorCalls.length === 1),
      'the builder never called the page-editor endpoint');
    // Give any in-flight preview re-render a chance to run before tearing down.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const config = savedConfig(dom);
    assert.equal(config.pageEdits.length, 1);
    assert.equal(config.pageEdits[0].text, 'Newer local edit');
  } finally {
    dom.restore();
  }
});
