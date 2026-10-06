import { generateBundle } from './generator.js';

const encoder = new TextEncoder();
const COOKIE = 'canopy_builder_csrf';
const MAX_CONFIG_BYTES = 256 * 1024;
function secureHeaders(source = {}) {
  const headers = new Headers(source);
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
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
  if (!env.CSRF_SECRET) return failure('Set CSRF_SECRET as a Worker secret before using the builder.', 503);
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const token = `${nonce}.${base64url(await sign(nonce, env.CSRF_SECRET))}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json({ token }, 200, { 'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${secure}` });
}
async function csrfValid(request, env) {
  const url = new URL(request.url); const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return false;
  const cookie = cookieValue(request.headers.get('Cookie'), COOKIE);
  const header = request.headers.get('X-CSRF-Token');
  if (!cookie || !header || !equal(cookie, header) || !env.CSRF_SECRET) return false;
  const [nonce, signature, ...rest] = header.split('.');
  if (!nonce || !signature || rest.length) return false;
  return equal(signature, base64url(await sign(nonce, env.CSRF_SECRET)));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/_scaffold/')) return failure('Not found.', 404);
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, runtime: 'cloudflare-workers-builder' });
    if (url.pathname === '/api/csrf' && request.method === 'GET') return issueCsrf(request, env);
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      if (!await csrfValid(request, env)) return failure('Cross-site request rejected or security token expired.', 403);
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > MAX_CONFIG_BYTES) return failure('The configuration is too large.', 413);
      let input;
      try {
        const raw = await request.text();
        if (encoder.encode(raw).length > MAX_CONFIG_BYTES) return failure('The configuration is too large.', 413);
        input = JSON.parse(raw);
      } catch (_) { return failure('Send a valid site configuration object.'); }
      if (!input || !['vercel', 'cloudflare'].includes(input.target)) return failure('Choose either the Vercel or Cloudflare code package.');
      try {
        const { buffer, filename } = await generateBundle(input, env, url.origin);
        return new Response(buffer, { status: 200, headers: secureHeaders({
          'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.length), 'Cache-Control': 'no-store'
        }) });
      } catch (cause) {
        if (/valid practice email|custom page|custom pages|HTTPS URL|Choose either the Vercel or Cloudflare/i.test(cause.message || '')) return failure(cause.message, 400);
        console.error('Cloudflare builder ZIP generation failed', cause);
        return failure('The selected code package could not be prepared. Please try again.', 500);
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
