// Execute code from both generated ZIPs. PGlite replaces only the Neon transport;
// the Vercel adapter records Express routes and runs their real middleware chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { generateBundle } from '../public/package-core.js';

const root = new URL('../public/_scaffold/templates/', import.meta.url);
const readTemplate = (file) => readFile(new URL(file, root), 'utf8');
const account = { adminUsername: 'cmsowner', adminEmail: 'owner@example.test', adminPassword: 'CanopyOwner!8' };
function unzip(bytes) {
  const files = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  for (let at = 0; at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true), length = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true);
    const start = at + 30 + length + extra;
    files.set(decoder.decode(bytes.subarray(at + 30, at + 30 + length)), decoder.decode(bytes.subarray(start, start + size)));
    at = start + size;
  }
  return files;
}
function expressAdapter() {
  const routes = [];
  const app = { disable() {}, set() {}, use() {} };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) app[method] = (path, ...handlers) => routes.push({ method: method.toUpperCase(), path, handlers });
  const express = () => app;
  express.json = express.raw = () => () => {};
  return { express, async request(path, method, headers, body) {
    const route = routes.find((route) => route.method === method && new RegExp(`^${route.path.replace(/:[^/]+/g, '([^/]+)')}$`).test(path));
    assert.ok(route, `${method} ${path}: missing route`);
    const params = {};
    route.path.split('/').forEach((part, index) => { if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(path.split('/')[index]); });
    const req = { path, method, params, body, headers, query: {}, protocol: 'https', secure: true, get: (name) => headers[name.toLowerCase()] };
    let status = 200, data;
    const responseHeaders = new Headers();
    const res = {
      sendFile(file) { data = { htmlFile: file }; return res; },
      status(code) { status = code; return res; },
      setHeader(name, value) { for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item); },
      json(value) { data = value; return res; }
    };
    for (const handler of route.handlers) {
      let proceed = false, failure;
      await handler(req, res, (error) => { failure = error; proceed = true; });
      if (failure) throw failure;
      if (!proceed) break;
    }
    return new Response(JSON.stringify(data), { status, headers: responseHeaders });
  } };
}
async function harness(target, database = true) {
  const files = unzip((await generateBundle({ target, businessName: 'CMS Regression', features: { blog: false }, ...account }, readTemplate)).buffer);
  const env = target === 'cloudflare' ? JSON.parse(files.get('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')).vars : Object.fromEntries(files.get('.env').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
  }));
  if (database) env.DATABASE_URL = 'postgres://test:test@localhost/cms'; else delete env.DATABASE_URL;
  env.CSRF_SECRET = 'test-only-session-209';
  env.ASSETS = { fetch: async () => new Response(files.get('public/index.html'), { headers: { 'Content-Type': 'text/html' } }) };
  const db = new PGlite();
  await db.waitReady;
  const client = async (strings, ...values) => {
    const text = strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), '');
    return (await db.query(text, values)).rows;
  };
  client.transaction = async (callback) => {
    // Neon query objects are lazy; queue statements to preserve transaction order.
    const statements = callback({ query: (text) => text });
    return db.transaction(async (tx) => { for (const text of statements) await tx.exec(text); });
  };
  const adapter = expressAdapter();
  const bindings = { process: { env, cwd: () => '/test-package' }, Buffer, createNeonClient: (url) => {
    if (!url) throw new Error('Database is not configured. Set DATABASE_URL.');
    return client;
  } };
  let source = files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
  const imports = [...source.matchAll(/^import (.+?) from '(.+?)';$/gm)];
  for (const [, names, path] of imports) {
    if (path.endsWith('/db/connection.js')) continue;
    let module;
    if (path === 'express') module = { default: adapter.express };
    else if (path === 'helmet') module = { default: () => () => {} };
    else module = await import(path.startsWith('../lib/') ? new URL(`shared/lib/${path.split('/').at(-1)}`, root) : path);
    if (names.startsWith('{')) for (const name of names.slice(1, -1).split(',').map((name) => name.trim())) bindings[name] = module[name];
    else bindings[names] = module.default;
  }
  source = source.replace(/^import .*;\n/gm, '').replace('export default ', 'const runtime = ');
  const runtime = new Function(...Object.keys(bindings), `${source}\nreturn runtime;`)(...Object.values(bindings));
  const cookies = new Map();
  let csrf = '';
  async function request(path, method = 'GET', body, authenticated = true, token = true) {
    const headers = { host: 'practice.test', origin: 'https://practice.test' };
    if (authenticated) headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    if (token && csrf) headers['x-csrf-token'] = csrf;
    if (body) headers['content-type'] = 'application/json';
    const response = target === 'cloudflare'
      ? await runtime.fetch(new Request(`https://practice.test${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }), env)
      : await adapter.request(path, method, headers, body);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], at = pair.indexOf('='); cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch (_) { data = { html: text }; }
    if (path === '/api/csrf' && response.ok) csrf = data.token;
    return { status: response.status, data };
  }
  return { request, db, files, async login() {
    assert.equal((await request('/api/csrf')).status, 200);
    assert.equal((await request('/api/admin/login', 'POST', { username: account.adminUsername, password: account.adminPassword })).status, 200);
  } };
}

for (const target of ['cloudflare', 'vercel']) {
  test(`${target}: generated CMS draft → publish → edit → delete with legacy blog:false`, async () => {
    const h = await harness(target);
    try {
      await h.login();
      await h.db.exec('ALTER TABLE tele_blog_posts ADD CONSTRAINT tele_blog_posts_feature_image_nonempty CHECK (length(btrim(feature_image_url)) > 0)');
      const runtime = h.files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
      const schemaLine = runtime.split('\n').find((line) => line.startsWith('const SCHEMA_STATEMENTS = '));
      const statements = JSON.parse(schemaLine.slice('const SCHEMA_STATEMENTS = '.length).replace(/;$/, ''));
      for (const statement of statements) await h.db.exec(statement);
      // Owner-edited legacy row must not be refreshed from the compiled seed.
      await h.db.exec(`UPDATE tele_sites SET config = config || '{"businessName":"Owner custom name","features":{"blog":false,"gallery":false,"scheduling":false}}'::jsonb, updated_at = created_at + interval '1 second'`);
      const config = (await h.request('/api/site')).data.config;
      assert.equal(config.features.blog, true, 'legacy DB must not disable Journal');
      assert.equal(config.features.scheduling, false);
      // Run the shipped navigation renderer with guest config (no account needed).
      const publicPath = target === 'cloudflare' ? 'public/' : '';
      const siteJs = h.files.get(`${publicPath}site.js`);
      const nav = { children: [], replaceChildren() { this.children = []; }, appendChild(node) { this.children.push(node); } };
      const document = { createElement: () => ({ dataset: {}, setAttribute() {} }) };
      const menuCode = siteJs.slice(siteJs.indexOf('  function safeMenuNavigationHref'), siteJs.indexOf('  async function renderPaymentDetails'));
      new Function('site', '$', 'document', 'window', 'defaultMenuLinks', 'isEnabled', `${menuCode}\nrenderMenuNavigation();`)(
        config, () => nav, document, { location: { origin: 'https://practice.test', pathname: '/' } }, [], (feature) => config.features[feature] !== false
      );
      assert.ok(nav.children.some((link) => link.textContent === 'Journal' && link.href === '/#journal'), 'guest Journal link must survive legacy blog:false');
      assert.equal(config.businessName, 'Owner custom name');
      assert.equal((await h.request('/api/site', 'PUT', { ...config, features: { ...config.features, blog: false } })).data.config.features.blog, true);
      assert.equal((await h.db.query('SELECT config FROM tele_sites')).rows[0].config.features.blog, true);
      assert.equal((await h.request('/api/admin/posts', 'POST', {}, false)).status, 403);
      assert.equal((await h.request('/api/admin/posts', 'GET', undefined, false)).status, 401);
      assert.equal((await h.request('/api/admin/posts', 'POST', {}, true, false)).status, 403);
      const post = { title: 'Holiday hours', slug: 'holiday-hours', excerpt: 'Our hours', body: 'We reopen on Monday.', status: 'draft' };
      let result = await h.request('/api/admin/posts', 'POST', post);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      const id = result.data.post.id;
      assert.equal(result.data.post.featureImageUrl, '', '214: blank URL means no image, not an implicit bundled cover');
      assert.ok(h.files.has(`${publicPath}images/blog-welcome.svg`));
      assert.equal((await h.request('/api/posts')).data.posts.length, 0);
      assert.equal((await h.request('/api/posts/holiday-hours')).status, 404);
      assert.equal((await h.request('/blog/holiday-hours')).status, 404, 'draft HTML route must also be private');
      result = await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, status: 'published' });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal((await h.request('/api/posts')).data.posts[0].slug, post.slug);
      assert.equal((await h.request('/api/posts/holiday-hours')).data.post.body, post.body);
      assert.equal((await h.request('/blog/holiday-hours')).status, 200, 'published dynamic page route');
      assert.equal((await h.request('/api/admin/posts', 'POST', { ...post, status: 'published' })).status, 409);
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, title: 'Updated hours', body: 'Tuesday instead.', status: 'published' })).status, 200);
      assert.equal((await h.request('/api/posts/holiday-hours')).data.post.body, 'Tuesday instead.');
      assert.equal((await h.request('/api/admin/posts', 'POST', { ...post, slug: 'bad-image', featureImageUrl: 'javascript:alert(1)' })).status, 400);
      const gallery = [{ imageUrl: 'https://example.test/cover.jpg', altText: 'Care team', sortOrder: 0 }];
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, status: 'published', gallery })).status, 400, '214: galleries are rejected');
      // Keep old gallery tables for migration compatibility, but remove these
      // retired rows on save and never return them as extra article images.
      await h.db.query("INSERT INTO tele_blog_post_images (site_id, post_id, image_url, alt_text, sort_order) VALUES ('cms-regression', $1, 'https://example.test/legacy.jpg', 'Legacy image', 0)", [id]);
      assert.equal((await h.request('/api/posts/holiday-hours')).data.post.contentGallery.images.length, 0);
      const contentGallery = { title: 'Care photos', images: [
        { id: 'one', url: 'https://example.test/one.jpg', paragraph: 0 },
        { id: 'two', url: 'https://example.test/two.jpg', paragraph: 0 }
      ] };
      const withGallery = await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, status: 'published', contentGallery });
      assert.equal(withGallery.status, 200, JSON.stringify(withGallery.data));
      const reloaded = (await h.request('/api/posts/holiday-hours')).data.post.contentGallery;
      assert.equal(reloaded.title, 'Care photos');
      assert.equal(reloaded.images.length, 2);
      assert.equal((await h.request('/api/admin/posts')).data.posts[0].contentGallery.images[1].paragraph, 0);
      const invalidGallery = { ...contentGallery, images: [...contentGallery.images, { id: 'three', url: 'https://example.test/three.jpg', paragraph: 0 }] };
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, contentGallery: invalidGallery })).status, 400);
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, contentGallery: { ...contentGallery, title: '' } })).status, 400);
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, contentGallery: { title: 'Unsafe', images: [{ id: 'x', url: 'javascript:alert(1)', paragraph: 0 }] } })).status, 400);
      const wholeSet = { title: 'All care photos', images: [1, 2, 3].map((n) => ({ id: `set-${n}`, url: `https://example.test/set-${n}.jpg`, paragraph: null })), setPlacement: { paragraph: 0, style: 'strip' } };
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, status: 'published', contentGallery: wholeSet })).status, 200);
      const wholeReloaded = (await h.request('/api/posts/holiday-hours')).data.post.contentGallery;
      assert.equal(wholeReloaded.images.length, 3);
      assert.deepEqual(wholeReloaded.setPlacement, { paragraph: 0, style: 'strip' });
      assert.equal((await h.request('/api/admin/posts')).data.posts[0].contentGallery.setPlacement.style, 'strip');
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, contentGallery: { ...wholeSet, setPlacement: { paragraph: 0, style: 'bad-css' } } })).status, 400);
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, contentGallery: { ...wholeSet, images: wholeSet.images.map((image, i) => ({ ...image, paragraph: i === 0 ? 0 : null })) } })).status, 400);
      const wholeSettings = await h.request('/api/site', 'PUT', { ...config, customPages: [{ id: 'whole', menuName: 'Whole gallery', url: '/whole-gallery.html', pageTitle: 'Whole gallery', pageContent: post.body, contentGallery: wholeSet }] });
      assert.equal(wholeSettings.status, 200);
      assert.equal((await h.request('/api/site')).data.config.customPages[0].contentGallery.setPlacement.style, 'strip');
      const livePageEdits = [{ selector: '#heroText', index: 0, text: 'Saved live page text' }, { selector: 'section', index: 1, remove: true }];
      const livePage = await h.request('/api/site', 'PUT', { ...wholeSettings.data.config, pageEdits: livePageEdits });
      assert.equal(livePage.status, 200, JSON.stringify(livePage.data));
      assert.deepEqual((await h.request('/api/site')).data.config.pageEdits, livePageEdits);
      assert.equal((await h.request('/api/site', 'PUT', { ...livePage.data.config, pageEdits: [{ selector: 'p', index: 0, remove: 'true' }] })).status, 400);
      assert.equal((await h.request('/api/site', 'PUT', { ...livePage.data.config }, false)).status, 403);
      assert.deepEqual((await h.request('/api/site')).data.config.pageEdits, livePageEdits, 'invalid/anonymous saves cannot replace live text/deletions');
      const emptiedPage = await h.request('/api/site', 'PUT', { ...livePage.data.config, customPages: [{ ...livePage.data.config.customPages[0], pageContent: '', contentGallery: { title: wholeSet.title, images: wholeSet.images } }] });
      assert.equal(emptiedPage.status, 200);
      assert.equal((await h.request('/api/site')).data.config.customPages[0].pageContent, '', 'deleting the last paragraph must not drop the page route');
      const trailingBody = 'An empty new paragraph follows.\n\n';
      const trailingGallery = { title: 'Trailing paragraph', images: [{ id: 'tail', url: 'https://example.test/tail.jpg', paragraph: 1 }] };
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', { ...post, status: 'published', body: trailingBody, contentGallery: trailingGallery })).status, 200);
      const tail = (await h.request('/api/posts/holiday-hours')).data.post;
      assert.equal(tail.body, trailingBody, 'do not trim away a newly-created blank paragraph');
      assert.equal(tail.contentGallery.images[0].paragraph, 1);
      const settings = await h.request('/api/site', 'PUT', { ...config, customPages: [{ id: 'care', menuName: 'Care', url: '/care-page.html', pageTitle: 'Care page', pageContent: trailingBody, contentGallery: trailingGallery }] });
      assert.equal(settings.status, 200);
      assert.equal(settings.data.config.customPages[0].contentGallery.title, 'Trailing paragraph');
      const changed = { ...post, slug: 'My New URL', status: 'published', featureImageUrl: 'https://example.test/one.jpg' };
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'PUT', changed)).status, 200);
      assert.equal((await h.request('/api/posts/my-new-url')).data.post.featureImageUrl, changed.featureImageUrl);
      assert.equal((await h.request('/blog/holiday-hours')).status, 404, 'renamed URL is no longer served');
      assert.equal((await h.request('/blog/my-new-url')).status, 200);
      const defaultSlug = await h.request('/api/admin/posts', 'POST', { title: 'Café Holiday Hours!', slug: '   ', body: 'Blank URL uses title.' });
      assert.equal(defaultSlug.status, 201);
      assert.equal(defaultSlug.data.post.slug, 'cafe-holiday-hours');
      await h.request(`/api/admin/posts/${defaultSlug.data.post.id}`, 'DELETE');
      assert.equal((await h.request(`/api/admin/posts/${id}`, 'DELETE')).status, 200);
      assert.equal((await h.db.query('SELECT count(*)::int AS count FROM tele_blog_post_images')).rows[0].count, 0);
      assert.equal((await h.request('/api/posts')).data.posts.length, 0);
      assert.equal((await h.request('/api/posts/holiday-hours')).status, 404);
    } finally { await h.db.close(); }
  });
  test(`${target}: database-less CMS uses public demos and explains owner operations`, async () => {
    const h = await harness(target, false);
    try {
      await h.login();
      assert.ok((await h.request('/api/posts')).data.posts.length > 0);
      for (const [method, path, body] of [
        ['GET', '/api/admin/posts'], ['POST', '/api/admin/posts', { title: 'News', body: 'Hello' }],
        ['PUT', '/api/admin/posts/00000000-0000-4000-8000-000000000001', { title: 'News', body: 'Hello' }],
        ['DELETE', '/api/admin/posts/00000000-0000-4000-8000-000000000001']
      ]) {
        const result = await h.request(path, method, body);
        assert.equal(result.status, 503, `${method}: ${JSON.stringify(result.data)}`);
        assert.match(result.data.error, /Connect the appointment database \(DATABASE_URL\) to save posts/);
      }
    } finally { await h.db.close(); }
  });
}

test('owner editor suggests draft slugs, preserves published/custom URLs, and keeps errors visible', async () => {
  const source = await readTemplate('shared/public/admin.js');
  const fields = Object.fromEntries(['id', 'title', 'slug', 'excerpt', 'body', 'category', 'status', 'featureImageUrl', 'featureImageAlt'].map((name) => [name, { value: '', dataset: {}, focus() {} }]));
  const form = { elements: fields, querySelector: () => ({}), scrollIntoView() {} };
  const $ = (id) => id === 'postForm' ? form : { replaceChildren() {} };
  const code = source.slice(source.indexOf('  function suggestedPostSlug'), source.indexOf('  function beginGalleryEdit'));
  const edit = new Function('$', 'previewPostImage', 'previewPostUrl', 'emptyGallery', `let postGallery, postGalleryEditor;\n${code}\nreturn beginPostEdit;`)($, () => {}, () => {}, () => ({ title: '', images: [] }));
  edit({ title: 'Holiday hours', slug: 'holiday-hours', status: 'draft' });
  assert.equal(fields.slug.dataset.edited, '');
  edit({ title: 'Holiday hours', slug: 'holiday-hours', status: 'published' });
  assert.equal(fields.slug.dataset.edited, 'true');
  edit({ title: 'Holiday hours', slug: 'custom-address', status: 'draft' });
  assert.equal(fields.slug.dataset.edited, 'true');
  assert.match(source, /if \(!slug.dataset.edited\) slug.value = suggestedPostSlug/);
  assert.match(source, /catch \(error\) \{ \$\('postFormMessage'\).textContent = error.message/);
  assert.match(await readTemplate('shared/public/admin.html'), /id="postFormMessage" role="status" aria-live="polite"/);
});
