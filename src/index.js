import { buildPreviewDocument, generateBundle, normalizePageEdits } from './generator.js';

const encoder = new TextEncoder();
// The HTTPS prefix prevents sibling domains from injecting the CSRF cookie.
function csrfCookie(request) {
  return new URL(request.url).protocol === 'https:'
    ? '__Host-canopy_builder_csrf' : 'canopy_builder_csrf';
}
const MAX_CONFIG_BYTES = 256 * 1024;
async function readBoundedText(request, maxBytes) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > maxBytes) return { text: null, tooLarge: true };
  const reader = request.body?.getReader();
  if (!reader) return { text: '', tooLarge: false };
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch (_) { /* The body is already being discarded. */ }
        return { text: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch (_) {
    return { text: null, tooLarge: false };
  } finally {
    try { reader.releaseLock(); } catch (_) { /* A cancelled stream may already be released. */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder().decode(bytes), tooLarge: false };
}
function secureHeaders(source = {}) {
  const headers = new Headers(source);
  // Google Fonts hosts are allowed only for the Brivon live preview, which is
  // injected into a sandboxed iframe that inherits this policy.
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return headers;
}
function json(value, status = 200, extra = {}) {
  const headers = secureHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  return new Response(JSON.stringify(value), { status, headers });
}
function failure(message, status = 400) { return json({ error: message }, status); }
function csrfSecret(env) {
  return String(env.CSRF_SECRET || '').trim();
}
// Every host the builder can be reached through: the one the Worker itself
// sees, any X-Forwarded-Host chain, and an optional explicit allowlist. A
// reverse proxy (a preview host, a load balancer, a custom domain) may rewrite
// Host or terminate TLS, so a byte-for-byte comparison of Origin against the
// Worker's own URL would reject the builder's own browser tab.
function trustedHosts(request, env) {
  const hosts = new Set([new URL(request.url).host.toLowerCase()]);
  const wildcards = [];
  for (const entry of String(request.headers.get('X-Forwarded-Host') || '').split(',')) {
    const host = entry.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  // Optional deployment setting, e.g. ALLOWED_ORIGINS=https://builder.example,*.builder.dev
  for (const entry of String(env?.ALLOWED_ORIGINS || '').split(',')) {
    const value = entry.trim();
    if (!value) continue;
    let host = value.toLowerCase();
    try { host = new URL(host).host; } catch (_) { /* already a bare host or wildcard */ }
    if (host.startsWith('*.')) wildcards.push(host.slice(1));
    else if (host) hosts.add(host);
  }
  return { hosts, wildcards };
}
function hostIsTrusted({ hosts, wildcards }, host) {
  if (hosts.has(host)) return true;
  return wildcards.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}
function sameOrigin(request, env) {
  const site = request.headers.get('Sec-Fetch-Site');
  // Browsers set Sec-Fetch-Site themselves and page scripts cannot override
  // it, so 'same-origin' is proof the request came from a builder tab.
  const browserAssertedSameOrigin = site === 'same-origin';
  if (site && site !== 'none' && !browserAssertedSameOrigin) return false;
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  let parsed;
  try { parsed = new URL(origin); } catch (_) { return false; }
  if (hostIsTrusted(trustedHosts(request, env), parsed.host.toLowerCase())) return true;
  // A proxy that rewrites Host leaves Origin pointing at the public host the
  // browser is really on. The browser's own same-origin assertion, the
  // SameSite=Strict cookie and the matching double-submit token still gate
  // the request, so this stays a same-site-only path.
  return browserAssertedSameOrigin;
}
function base64url(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { return ''; }
  }
  return '';
}
function equal(left, right) {
  const a = encoder.encode(String(left || '')); const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}
async function issueCsrf(request, env) {
  if (!sameOrigin(request, env)) return failure('Cross-site request rejected.', 403);
  const secret = csrfSecret(env);
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(24)));
  // This public, stateless builder needs no shared signing key. Keep optional
  // signing for configured deployments; never use a public fallback secret.
  const token = secret ? `${nonce}.${base64url(await sign(nonce, secret))}` : nonce;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json({ token }, 200, { 'Set-Cookie': `${csrfCookie(request)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${secure}` });
}
async function csrfValid(request, env) {
  if (!sameOrigin(request, env)) return false;
  const cookie = cookieValue(request.headers.get('Cookie'), csrfCookie(request));
  const header = request.headers.get('X-CSRF-Token');
  const secret = csrfSecret(env);
  if (!cookie || !header || !equal(cookie, header)) return false;
  if (!secret) return /^[A-Za-z0-9_-]{32}$/.test(header);
  const [nonce, signature, ...rest] = header.split('.');
  if (!nonce || !signature || rest.length) return false;
  return equal(signature, base64url(await sign(nonce, secret)));
}
// The live preview renders caller-supplied public settings with the same
// scaffold files as the ZIP. It holds no secrets and changes no state, sends
// no CORS headers and cannot be framed, so it is safe without a CSRF token.
const MAX_PREVIEW_CONFIG_BYTES = 16 * 1024;
async function preview(request, env, origin) {
  const raw = new URL(request.url).searchParams.get('config') || '';
  if (!raw) return failure('Send a preview configuration.', 400);
  if (raw.length > MAX_PREVIEW_CONFIG_BYTES) return failure('The preview configuration is too large.', 413);
  let input;
  try { input = JSON.parse(raw); }
  catch (_) { return failure('Send a valid preview configuration.'); }
  try {
    const { html } = await buildPreviewDocument(input, env, origin);
    const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    // Applied when this document is opened directly; the builder injects it
    // into a sandboxed iframe, which inherits the builder page's policy.
    headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return new Response(html, { status: 200, headers });
  } catch (cause) {
    console.error('Builder preview generation failed', cause);
    return failure(`The live preview could not be prepared. ${cause?.message || ''}`.trim(), 500);
  }
}
// The page editor's "Export to builder" submit persists the current page
// edits server-side (KV) so they survive the editor tab closing. The builder
// tab applies the same edits to its config and preview at the same time; the
// next prepared ZIP carries them in the homepage source.
const PAGE_EDIT_SITE_ID = /^[a-z0-9][a-z0-9-]{0,54}$/;
async function savePageEdits(request, env) {
  if (!await csrfValid(request, env)) return failure('Cross-site request rejected or security token expired.', 403);
  if (!env.PAGE_EDITOR) return failure('Page editor storage is not configured on this deployment.', 503);
  const body = await readBoundedText(request, MAX_CONFIG_BYTES);
  if (body.tooLarge) return failure('The page edits are too large.', 413);
  if (body.text === null) return failure('Send the page edits as JSON.');
  let input;
  try { input = JSON.parse(body.text); }
  catch (_) { return failure('Send the page edits as JSON.'); }
  const siteId = String(input?.siteId || '').trim().toLowerCase();
  if (!PAGE_EDIT_SITE_ID.test(siteId)) return failure('Send a valid site id.');
  let edits;
  try { edits = normalizePageEdits(input.edits); }
  catch (cause) { return failure(cause.message, 400); }
  const record = { siteId, edits, updatedAt: new Date().toISOString() };
  await env.PAGE_EDITOR.put(`page-edits:${siteId}`, JSON.stringify(record), { metadata: { edits: edits.length } });
  return json({ ok: true, siteId, saved: edits.length });
}
async function loadPageEdits(url, env) {
  if (!env.PAGE_EDITOR) return failure('Page editor storage is not configured on this deployment.', 503);
  const siteId = String(url.searchParams.get('siteId') || '').trim().toLowerCase();
  if (!PAGE_EDIT_SITE_ID.test(siteId)) return failure('Send a valid site id.');
  const raw = await env.PAGE_EDITOR.get(`page-edits:${siteId}`, 'text');
  if (!raw) return failure('No saved page edits for this site.', 404);
  return new Response(raw, { status: 200, headers: secureHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }) });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Scaffold templates are public build inputs — they carry only placeholder
    // tokens and the same files ship inside every generated ZIP. The builder
    // tab reads them directly when it has to assemble a package in the browser
    // (e.g. on Workers Free, where per-request CPU cannot absorb the server
    // build). Everything else under /_scaffold/ stays hidden.
    if (url.pathname.startsWith('/_scaffold/')) {
      const templateRead = url.pathname.startsWith('/_scaffold/templates/') && (request.method === 'GET' || request.method === 'HEAD');
      if (!templateRead) return failure('Not found.', 404);
    }
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, runtime: 'cloudflare-workers-builder' });
    if (url.pathname === '/api/csrf' && request.method === 'GET') return issueCsrf(request, env);
    if (url.pathname === '/api/preview' && request.method === 'GET') return preview(request, env, url.origin);
    if (url.pathname === '/api/page-editor' && request.method === 'POST') return savePageEdits(request, env);
    if (url.pathname === '/api/page-editor' && request.method === 'GET') return loadPageEdits(url, env);
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      if (!await csrfValid(request, env)) return failure('Cross-site request rejected or security token expired.', 403);
      const body = await readBoundedText(request, MAX_CONFIG_BYTES);
      if (body.tooLarge) return failure('The configuration is too large.', 413);
      if (body.text === null) return failure('Send a valid site configuration object.');
      let input;
      try { input = JSON.parse(body.text); }
      catch (_) { return failure('Send a valid site configuration object.'); }
      if (!input || !['vercel', 'cloudflare'].includes(input.target)) return failure('Choose either the Vercel or Cloudflare code package.');
      try {
        const { buffer, filename } = await generateBundle(input, env, url.origin);
        return new Response(buffer, { status: 200, headers: secureHeaders({
          'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.length), 'Cache-Control': 'no-store'
        }) });
      } catch (cause) {
        if (/valid practice email|administrator username|administrator email|administrator password|custom page|custom pages|HTTPS URL|Choose either the Vercel or Cloudflare|valid Neon database connection string/i.test(cause.message || '')) return failure(cause.message, 400);
        console.error('Cloudflare builder ZIP generation failed', cause);
        // Surface the actual error string so a deployment failure (missing
        // scaffold file, runtime error) is reportable instead of a generic 500.
        return failure(`The selected code package could not be prepared. ${cause?.message || 'Please try again.'}`, 500);
      }
    }
    if (url.pathname.startsWith('/api/')) return failure('API route not found.', 404);
    if (request.method !== 'GET' && request.method !== 'HEAD') return failure('Method not allowed.', 405);
    try {
      const response = await env.ASSETS.fetch(request);
      const headers = secureHeaders(response.headers);
      if (url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js')) headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (cause) {
      console.error('builder asset read failed', cause);
      return failure('The builder assets could not be loaded.', 500);
    }
  }
};
