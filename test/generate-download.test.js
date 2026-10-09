import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateBundle } from '../public/package-core.js';

// Regression tests for the Generate buttons' download behaviour. While a
// package is prepared the builder locks every control and installs a
// capture-phase click guard on document that swallows anchor activation.
// saveBlobDownload() clicks its own <a download> anchor programmatically while
// that lock is still held, so the guard must exempt the download anchor —
// otherwise its preventDefault() cancels the click and the browser never
// saves the ZIP. The reported symptom: the lockout chip and disabled controls
// work, the build succeeds, but no file downloads (Vercel and Cloudflare, on
// the dev server and on CPU-capped deployments alike).
//
// These tests run the real public/app.js Generate flow under a minimal DOM
// stub so the click-level behaviour is exercised, not just source-inspected.

globalThis.Element ??= class Element {};

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
    // Models a real click dispatch closely enough for the lockout guard:
    // capture-phase document listeners run before the target's own listeners.
    dispatchClick(target) {
      const event = {
        type: 'click',
        target,
        defaultPrevented: false,
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

function installDom(deploymentTarget) {
  const doc = makeDocument();
  const storage = new Map(Object.entries({
    'canopy-tour-complete': 'true',
    ...(deploymentTarget ? { 'canopy-site-config': JSON.stringify({ deploymentTarget }) } : {})
  }));
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    fetch: globalThis.fetch,
    Element: globalThis.Element,
    BroadcastChannel: globalThis.BroadcastChannel
  };
  const downloads = [];
  globalThis.document = doc;
  globalThis.window = { setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {}, innerWidth: 1280 };
  // app.js opens a page-editor BroadcastChannel at bind time; a stub keeps the
  // Node test process from being kept alive by the real one.
  globalThis.BroadcastChannel = class {
    addEventListener() {}
    postMessage() {}
    close() {}
  };
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.location = new URL('https://builder.test/');
  globalThis.Element = Element;
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { downloads.push(blob); return `blob:mock-download-${downloads.length}`; };
  URL.revokeObjectURL = () => {};
  return {
    doc,
    downloads,
    restore() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
      URL.createObjectURL = realCreateObjectURL;
      URL.revokeObjectURL = realRevokeObjectURL;
    }
  };
}

// Serves the real builder API surface: a CSRF token, either a CPU-kill 503 or
// a real server-built ZIP for /api/generate, and the scaffold templates the
// browser fallback reads.
function installFetch(doc, { serverZip = null } = {}) {
  const linkClick = { prevented: null };
  globalThis.fetch = async (input) => {
    const path = new URL(String(input), 'https://builder.test').pathname;
    if (path === '/api/csrf') {
      return new Response(JSON.stringify({ token: 'test-csrf-token' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (path === '/api/generate') {
      // The builder is locked at this point, so a click on a regular builder
      // link must still be swallowed by the lockout guard.
      const link = doc.createElement('a');
      linkClick.prevented = doc.dispatchClick(link).defaultPrevented;
      if (serverZip) {
        return new Response(serverZip, { status: 200, headers: { 'Content-Type': 'application/zip' } });
      }
      // Cloudflare's Workers Free CPU kill, exactly as the browser sees it.
      return new Response('error code: 1102\nRay ID: 0000\n', { status: 503 });
    }
    if (path.startsWith('/_scaffold/templates/')) {
      const filename = decodeURIComponent(path.slice('/_scaffold/templates/'.length));
      return new Response(await readTemplateFile(filename), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return linkClick;
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
    files.set(name, { size, text: decoder.decode(bytes.subarray(dataStart, dataEnd)) });
    offset = dataEnd;
  }
  return files;
}

let importCounter = 0;
async function runGenerate({ target, serverZip = null }) {
  const dom = installDom(target);
  try {
    const linkClick = installFetch(dom.doc, { serverZip });
    // Fresh module instance per run: app.js keeps lockout/config state at module scope.
    await import(`../public/app.js?generate-download-${target}-${serverZip ? 'server' : 'fallback'}-${importCounter += 1}`);
    const doc = dom.doc;
    doc.getElementById('adminUsername').value = 'practiceowner';
    doc.getElementById('adminEmail').value = 'owner@example.test';
    doc.getElementById('adminPassword').value = 'CanopyOwner!8';
    doc.getElementById('adminPasswordConfirm').value = 'CanopyOwner!8';
    const generateButton = doc.getElementById('generateButton');
    const [clickHandler] = generateButton.listeners.get('click');
    assert.ok(clickHandler, 'the Generate button has a click handler bound');
    await clickHandler.call(generateButton, { type: 'click', target: generateButton });
    const downloadEvent = doc.clickEvents.find((event) => event.target.tagName === 'A' && event.target.download);
    return { dom, doc, linkClick, downloadEvent, generateButton };
  } finally {
    dom.restore();
  }
}

async function assertDownloadedPackage({ dom, doc, linkClick, downloadEvent, generateButton }, target) {
  // The lockout still swallows ordinary builder links while it is held.
  assert.equal(linkClick.prevented, true, 'builder links stay swallowed while the lock is held');
  // The programmatic download click must reach the browser uncancelled.
  assert.ok(downloadEvent, 'the download anchor was clicked');
  assert.equal(downloadEvent.defaultPrevented, false,
    'the lockout guard must not cancel the programmatic download click (the browser saves the file only if the click is not preventDefault-ed)');
  const anchor = downloadEvent.target;
  assert.equal(anchor.download, `harborlight-veterinary-care-${target}.zip`);
  assert.match(anchor.href, /^blob:mock-download-/);
  assert.equal(dom.downloads.length, 1, 'exactly one blob URL was created for the download');
  // The downloaded bytes are the real package for the selected target.
  const entries = zipEntries(new Uint8Array(await dom.downloads[0].arrayBuffer()));
  assert.ok(entries.size > 20, `expected a full package, got ${entries.size} entries`);
  const envName = target === 'cloudflare' ? '.dev.vars' : '.env';
  const env = entries.get(envName);
  assert.ok(env, `${envName} should be part of the package`);
  // The Vercel .env is unquoted; the Cloudflare .dev.vars quotes its values.
  assert.match(env.text, /ADMIN_PASSWORD_HASH="?pbkdf2\$/);
  assert.match(env.text, /ADMIN_USERNAME="?practiceowner/);
  for (const entry of entries.values()) {
    assert.ok(!entry.text.includes('CanopyOwner!8'), `the raw password leaked into ${entry === env ? envName : 'a package file'}`);
  }
  assert.ok(entries.has('db/schema.sql'));
  assert.ok(entries.has('README.md'));
  assert.ok(entries.has(target === 'cloudflare' ? 'public/index.html' : 'index.html'));
  // The lockout is released and the password field cleared afterwards.
  assert.equal(doc.body.classes.has('builder-locked'), false, 'lockout released after the download');
  assert.equal(doc.getElementById('generatingChip').hidden, true);
  assert.equal(generateButton.disabled, false);
  assert.equal(doc.getElementById('adminPassword').value, '', 'password field cleared after generation');
}

test('Generate saves the browser-built ZIP on Vercel when the server build is refused', async () => {
  await assertDownloadedPackage(await runGenerate({ target: 'vercel' }), 'vercel');
});

test('Generate saves the browser-built ZIP on Cloudflare when the server build is refused', async () => {
  await assertDownloadedPackage(await runGenerate({ target: 'cloudflare' }), 'cloudflare');
});

test('Generate saves the server-built ZIP when /api/generate succeeds', async () => {
  const { buffer } = await generateBundle({
    target: 'vercel', businessName: 'Harborlight Veterinary Care',
    adminUsername: 'practiceowner', adminEmail: 'owner@example.test', adminPassword: 'CanopyOwner!8'
  }, readTemplateFile);
  await assertDownloadedPackage(await runGenerate({ target: 'vercel', serverZip: buffer }), 'vercel');
});
