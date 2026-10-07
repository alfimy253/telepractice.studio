import { createNeonClient } from '../db/connection.js';
import { createAdminSession, verifyAdminSession, verifyPasswordHash } from '../lib/admin-security.js';
import { adminDashboardPath, isAdminDashboardPath } from '../lib/admin-url.js';

const SITE_ID = '__SITE_ID__';
const DEFAULT_CONFIG = __SITE_CONFIG_JSON__;
const CSRF_COOKIE = 'practice_csrf';
const CLIENT_SESSION_COOKIE = 'canopy_client';
const CLIENT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 210000;
const SITE_TIME_ZONE = DEFAULT_CONFIG.timeZone || 'Asia/Manila';
const encoder = new TextEncoder();

function headersWithSecurity(source = {}) {
  const headers = new Headers(source);
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy', 'same-site');
  return headers;
}
function json(data, status = 200, extra = {}) {
  const headers = headersWithSecurity({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  return new Response(JSON.stringify(data), { status, headers });
}
function error(message, status = 400) { return json({ error: message }, status); }
function cleanText(value, max, fallback = '') { return String(value ?? fallback).trim().slice(0, max); }
function validColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback; }
function cleanTimeZone(value, fallback = 'Asia/Manila') {
  const candidate = cleanText(value, 64) || fallback;
  try { new Intl.DateTimeFormat('en-US', { timeZone: candidate }); return candidate; } catch (_) { return fallback; }
}
function cleanBannerImage(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : null; } catch (_) { return null; }
}
function cleanCustomPageUrl(value) {
  let raw = cleanText(value, 120).replace(/^\/+|\/+$/g, '');
  if (!raw || /[?#:]/.test(raw) || raw.includes('/')) return '';
  raw = raw.replace(/\.html?$/i, '');
  if (!raw) return '';
  const slug = slugify(raw);
  if (['admin','appointments','api','assets','images','index'].includes(slug)) return '';
  return `/${slug}.html`;
}
function cleanCustomPages(value, fallback = []) {
  const pages = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const seen = new Set();
  return pages.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const menuName = cleanText(item.menuName, 80);
    const pageTitle = cleanText(item.pageTitle, 120);
    const pageContent = cleanText(item.pageContent, 6000);
    const url = cleanCustomPageUrl(item.url);
    const imageUrl = cleanBannerImage(item.imageUrl);
    if (!menuName || !pageTitle || !pageContent || !url || imageUrl === null || seen.has(url)) return [];
    seen.add(url);
    return [{ id: cleanText(item.id, 48, url.slice(1, -5)), menuName, url, pageTitle, pageContent, imageUrl }];
  });
}
function cleanPaymentDetails(value) {
  const payments = { ...(DEFAULT_CONFIG.payments || {}), ...(value || {}) };
  return {
    gcashName: cleanText(payments.gcashName, 80), gcashNumber: cleanText(payments.gcashNumber, 40),
    mayaName: cleanText(payments.mayaName, 80), mayaNumber: cleanText(payments.mayaNumber, 40)
  };
}
function cleanSiteConfig(input = {}) {
  const merged = { ...DEFAULT_CONFIG, ...input };
  return {
    ...DEFAULT_CONFIG,
    businessName: cleanText(merged.businessName, 80, DEFAULT_CONFIG.businessName),
    brandName: cleanText(merged.brandName, 80, DEFAULT_CONFIG.brandName),
    location: cleanText(merged.location, 100, DEFAULT_CONFIG.location),
    email: cleanText(merged.email, 120, DEFAULT_CONFIG.email),
    phone: cleanText(merged.phone, 30, DEFAULT_CONFIG.phone),
    timeZone: cleanTimeZone(merged.timeZone, DEFAULT_CONFIG.timeZone || 'Asia/Manila'),
    primaryColor: validColor(merged.primaryColor, DEFAULT_CONFIG.primaryColor),
    accentColor: validColor(merged.accentColor, DEFAULT_CONFIG.accentColor),
    paperColor: validColor(merged.paperColor, DEFAULT_CONFIG.paperColor),
    fontStyle: merged.fontStyle === 'sans' ? 'sans' : 'serif',
    theme: ['canopy','clay','coastal','editorial','neat','launcher','air'].includes(merged.theme) ? merged.theme : DEFAULT_CONFIG.theme,
    editorialAccent: ['black','teal','forest'].includes(merged.editorialAccent) ? merged.editorialAccent : 'black',
    features: { ...DEFAULT_CONFIG.features, ...(merged.features || {}), gallery: merged.features?.gallery !== false },
    payments: cleanPaymentDetails(merged.payments),
    customPages: cleanCustomPages(merged.customPages, DEFAULT_CONFIG.customPages)
  };
}
function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: SITE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function localClock() { return new Intl.DateTimeFormat('en-GB', { timeZone: SITE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()); }
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value && value >= localToday();
}
function monthStart(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? `${value}-01` : ''; }
function monthDeadline(month) {
  const [year, monthNumber] = month.split('-').map(Number); const deadline = new Date(Date.UTC(year, monthNumber - 1, 0));
  deadline.setUTCDate(deadline.getUTCDate() - 2); return deadline.toISOString().slice(0, 10);
}
function timeMinutes(value) {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(String(value || ''));
  if (!match || Number(match[2]) % 30 !== 0) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
function validTimeWindow(start, end) { const from = timeMinutes(start); const to = timeMinutes(end); return from !== null && to !== null && from < to; }
function cleanMonthlySchedule(value = {}, month) {
  const start = monthStart(month);
  if (!start || !Array.isArray(value.weeklyRules) || value.weeklyRules.length !== 7 || !Array.isArray(value.exceptions || []) || (value.exceptions || []).length > 31) return null;
  const rules = value.weeklyRules.map((rule) => ({ weekday: Number(rule?.weekday), enabled: rule?.enabled === true, startTime: cleanText(rule?.startTime, 5), endTime: cleanText(rule?.endTime, 5) }));
  if (rules.some((rule) => !Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) || new Set(rules.map((rule) => rule.weekday)).size !== 7 || rules.some((rule) => rule.enabled && !validTimeWindow(rule.startTime, rule.endTime))) return null;
  const exceptions = (value.exceptions || []).map((item) => ({ date: cleanText(item?.date, 10), mode: item?.mode === 'closed' ? 'closed' : item?.mode === 'open' ? 'open' : '', startTime: cleanText(item?.startTime, 5), endTime: cleanText(item?.endTime, 5) }));
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if (exceptions.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.date < start || item.date > monthEnd || !item.mode || (item.mode === 'open' && !validTimeWindow(item.startTime, item.endTime))) || new Set(exceptions.map((item) => item.date)).size !== exceptions.length) return null;
  return { monthStart: start, weeklyRules: rules.sort((a, b) => a.weekday - b.weekday), exceptions };
}
function buildMonthlySlots(schedule) {
  const [year, monthNumber] = schedule.monthStart.slice(0, 7).split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(); const rules = new Map(schedule.weeklyRules.map((rule) => [rule.weekday, rule]));
  const exceptions = new Map(schedule.exceptions.map((item) => [item.date, item])); const today = localToday(); const slots = [];
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date < today) continue;
    const exception = exceptions.get(date); if (exception?.mode === 'closed') continue;
    const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay(); const rule = rules.get(weekday);
    const window = exception?.mode === 'open' ? exception : rule?.enabled ? rule : null;
    if (!window || !validTimeWindow(window.startTime, window.endTime)) continue;
    for (let minute = timeMinutes(window.startTime); minute < timeMinutes(window.endTime); minute += 30) {
      slots.push({ slotDate: date, slotTime: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` });
      if (slots.length > 1000) return null;
    }
  }
  return slots;
}
function slugify(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160) || 'practice-note'; }
function cleanGalleryImage(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : null; } catch (_) { return null; }
}
function galleryPayload(value = {}) {
  const imageUrl = cleanGalleryImage(value.imageUrl);
  const sortOrder = Number(value.sortOrder ?? 0);
  return {
    title: cleanText(value.title, 120), imageUrl, altText: cleanText(value.altText, 180),
    caption: cleanText(value.caption, 300), category: cleanText(value.category, 60, 'Practice life') || 'Practice life',
    status: value.status === 'published' ? 'published' : 'draft', sortOrder
  };
}
function validGalleryPayload(item) {
  return item.title && item.imageUrl !== null && Number.isInteger(item.sortOrder) && item.sortOrder >= 0 && item.sortOrder <= 9999 && (!item.imageUrl || item.altText);
}
function cleanArticleImage(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : null; } catch (_) { return null; }
}
function articlePostPayload(value = {}) {
  const title = cleanText(value.title, 140);
  const slug = slugify(value.slug || title);
  const excerpt = cleanText(value.excerpt, 260);
  const body = cleanText(value.body, 12000);
  const category = cleanText(value.category, 60, 'Practice notes') || 'Practice notes';
  const status = value.status === 'published' ? 'published' : 'draft';
  if (!Array.isArray(value.gallery ?? []) || (value.gallery || []).length > 12) return null;
  const gallery = (value.gallery || []).map((image, index) => {
    const imageUrl = cleanArticleImage(image?.imageUrl);
    return { imageUrl, altText: cleanText(image?.altText, 180), caption: cleanText(image?.caption, 300), sortOrder: Number(image?.sortOrder ?? index) };
  });
  if (gallery.some((image) => !image.imageUrl || image.imageUrl === null || !image.altText || !Number.isInteger(image.sortOrder) || image.sortOrder < 0 || image.sortOrder > 11) || new Set(gallery.map((image) => image.sortOrder)).size !== gallery.length) return null;
  gallery.sort((left, right) => left.sortOrder - right.sortOrder);
  const suppliedFeatureUrl = cleanArticleImage(value.featureImageUrl);
  if (suppliedFeatureUrl === null) return null;
  const featureImageUrl = suppliedFeatureUrl || gallery[0]?.imageUrl || '';
  const featureImageAlt = cleanText(value.featureImageAlt, 180) || gallery.find((image) => image.imageUrl === featureImageUrl)?.altText || title;
  if (!title || !body || !featureImageUrl || !featureImageAlt) return null;
  return { title, slug, excerpt, body, category, status, featureImageUrl, featureImageAlt, gallery };
}
async function persistArticle(sql, post, id = '') {
  if (id) return sql`
    WITH saved AS (
      UPDATE blog_posts SET title = ${post.title}, slug = ${post.slug}, excerpt = ${post.excerpt}, body = ${post.body}, feature_image_url = ${post.featureImageUrl}, feature_image_alt = ${post.featureImageAlt}, category = ${post.category}, status = ${post.status}, published_at = CASE WHEN ${post.status} = 'published' THEN COALESCE(published_at, now()) ELSE NULL END, updated_at = now()
      WHERE site_id = ${SITE_ID} AND id = ${id}::uuid
      RETURNING id, site_id, title, slug, excerpt, body, feature_image_url AS "featureImageUrl", feature_image_alt AS "featureImageAlt", category, status, published_at AS "publishedAt", created_at AS "createdAt"
    ), cleared AS (
      DELETE FROM blog_post_images AS image USING saved WHERE image.site_id = saved.site_id AND image.post_id = saved.id RETURNING image.id
    ), added AS (
      INSERT INTO blog_post_images (site_id, post_id, image_url, alt_text, caption, sort_order)
      SELECT saved.site_id, saved.id, incoming.image_url, incoming.alt_text, incoming.caption, incoming.sort_order
      FROM saved CROSS JOIN (SELECT count(*) AS cleared_count FROM cleared) AS cleared_images
      CROSS JOIN jsonb_to_recordset(${JSON.stringify(post.gallery)}::jsonb) AS incoming(image_url text, alt_text text, caption text, sort_order integer)
      RETURNING id
    )
    SELECT saved.* FROM saved`;
  return sql`
    WITH saved AS (
      INSERT INTO blog_posts (site_id, title, slug, excerpt, body, feature_image_url, feature_image_alt, category, status, published_at)
      VALUES (${SITE_ID}, ${post.title}, ${post.slug}, ${post.excerpt}, ${post.body}, ${post.featureImageUrl}, ${post.featureImageAlt}, ${post.category}, ${post.status}, CASE WHEN ${post.status} = 'published' THEN now() ELSE NULL END)
      RETURNING id, site_id, title, slug, excerpt, body, feature_image_url AS "featureImageUrl", feature_image_alt AS "featureImageAlt", category, status, published_at AS "publishedAt", created_at AS "createdAt"
    ), cleared AS (
      DELETE FROM blog_post_images AS image USING saved WHERE image.site_id = saved.site_id AND image.post_id = saved.id RETURNING image.id
    ), added AS (
      INSERT INTO blog_post_images (site_id, post_id, image_url, alt_text, caption, sort_order)
      SELECT saved.site_id, saved.id, incoming.image_url, incoming.alt_text, incoming.caption, incoming.sort_order
      FROM saved CROSS JOIN (SELECT count(*) AS cleared_count FROM cleared) AS cleared_images
      CROSS JOIN jsonb_to_recordset(${JSON.stringify(post.gallery)}::jsonb) AS incoming(image_url text, alt_text text, caption text, sort_order integer)
      RETURNING id
    )
    SELECT saved.* FROM saved`;
}
function displayTime(value) {
  const [hour, minute] = value.split(':').map(Number); const suffix = hour >= 12 ? 'pm' : 'am';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}
function sql(env) {
  return createNeonClient(env.DATABASE_URL);
}
function base64url(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodeBase64url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded); return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function issueCsrf(request, env) {
  const secret = env.CSRF_SECRET;
  if (!secret) return error('Set a CSRF_SECRET Worker secret before using forms.', 503);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = base64url(nonceBytes);
  const signature = base64url(await hmac(nonce, secret));
  const token = `${nonce}.${signature}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  // Wrangler local may use http; production is always served over HTTPS.
  return json({ token }, 200, { 'Set-Cookie': `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${secure}` });
}
function readCookie(header, name) {
  for (const item of String(header || '').split(';')) {
    const index = item.indexOf('='); if (index < 0) continue;
    if (item.slice(0, index).trim() === name) { try { return decodeURIComponent(item.slice(index + 1).trim()); } catch (_) { return ''; } }
  }
  return '';
}
async function passwordDigest(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: decodeBase64url(salt), iterations, hash: 'SHA-256' }, key, 256);
  return base64url(new Uint8Array(derived));
}
async function makePasswordHash(password) {
  const salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${await passwordDigest(password, salt)}`;
}
async function passwordMatches(password, encoded) {
  const [algorithm, roundsText, salt, expected, ...rest] = String(encoded || '').split('$');
  const rounds = Number(roundsText);
  if (algorithm !== 'pbkdf2' || rest.length || !salt || !expected || !Number.isInteger(rounds) || rounds < 100000 || rounds > 1000000) return false;
  try { return constantEqual(await passwordDigest(password, salt, rounds), expected); } catch (_) { return false; }
}
async function sessionTokenHash(token) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function clientSummary(row) { return { id: row.id, name: row.name, email: row.email, phone: row.phone }; }
async function createClientSession(request, env, account) {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sessionTokenHash(token);
  await sql(env)`DELETE FROM client_sessions WHERE site_id = ${SITE_ID} AND expires_at < now()`;
  await sql(env)`INSERT INTO client_sessions (site_id, client_account_id, token_hash, expires_at) VALUES (${SITE_ID}, ${account.id}, ${tokenHash}, now() + (${CLIENT_SESSION_TTL_SECONDS} * interval '1 second'))`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { 'Set-Cookie': `${CLIENT_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${CLIENT_SESSION_TTL_SECONDS}${secure}` };
}
function clearClientSession(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { 'Set-Cookie': `${CLIENT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}` };
}
async function currentClient(request, env) {
  const token = readCookie(request.headers.get('Cookie'), CLIENT_SESSION_COOKIE);
  if (!token || !env.DATABASE_URL) return null;
  const tokenHash = await sessionTokenHash(token);
  const rows = await sql(env)`SELECT account.id, account.full_name AS name, account.email, account.phone FROM client_sessions AS session JOIN client_accounts AS account ON account.id = session.client_account_id AND account.site_id = session.site_id WHERE session.site_id = ${SITE_ID} AND session.token_hash = ${tokenHash} AND session.expires_at > now() LIMIT 1`;
  return rows[0] || null;
}
function constantEqual(left, right) {
  const a = encoder.encode(String(left || '')); const b = encoder.encode(String(right || ''));
  let diff = a.length ^ b.length; const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) diff |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  return diff === 0;
}
async function csrfOk(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return false;
  const cookie = readCookie(request.headers.get('Cookie'), CSRF_COOKIE);
  const header = request.headers.get('X-CSRF-Token');
  if (!cookie || !header || !constantEqual(cookie, header)) return false;
  const secret = env.CSRF_SECRET;
  if (!secret) return false;
  const [nonce, signature, ...rest] = header.split('.');
  if (!nonce || !signature || rest.length) return false;
  let actual; try { actual = decodeBase64url(signature); } catch (_) { return false; }
  const expected = await hmac(nonce, secret);
  return actual.length === expected.length && constantEqual(base64url(actual), base64url(expected));
}
function adminConfigured(env) {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_EMAIL && env.ADMIN_PASSWORD_HASH && env.CSRF_SECRET);
}
function adminSessionCookieName(request) {
  return new URL(request.url).protocol === 'https:' ? '__Host-canopy_owner' : 'canopy_owner';
}
async function adminOk(request, env) {
  if (!adminConfigured(env)) return false;
  const token = readCookie(request.headers.get('Cookie'), adminSessionCookieName(request));
  return verifyAdminSession(token, env.ADMIN_USERNAME, env.ADMIN_PASSWORD_HASH, env.CSRF_SECRET);
}
function adminFailure(env) {
  return adminConfigured(env)
    ? error('Owner session is not valid. Sign in again.', 401)
    : error('Owner sign-in is not configured. Set ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD_HASH and CSRF_SECRET.', 503);
}
async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 256 * 1024) return null;
  try {
    const text = await request.text();
    if (encoder.encode(text).length > 256 * 1024) return null;
    return JSON.parse(text);
  } catch (_) { return null; }
}
async function siteConfig(env) {
  if (!env.DATABASE_URL) return { config: DEFAULT_CONFIG, source: 'generated-fallback' };
  try {
    const rows = await sql(env)`SELECT config FROM sites WHERE site_id = ${SITE_ID} LIMIT 1`;
    return { config: rows[0]?.config || DEFAULT_CONFIG, source: rows[0] ? 'neon' : 'generated-fallback' };
  } catch (cause) { console.error('site config read failed', cause); return { config: DEFAULT_CONFIG, source: 'generated-fallback' }; }
}
async function availabilityForMonth(env, month, filterDate = '') {
  const start = monthStart(month);
  if (!start) throw new Error('Choose a valid month in YYYY-MM format.');
  if (!env.DATABASE_URL) return { month, published: false, slots: [], days: [], totalSlots: 0, bookedSlots: 0, availableSlots: 0, fillPercent: 0 };
  const rows = filterDate
    ? await sql(env)`SELECT schedule.status, slot.id, slot.slot_date::text AS date, to_char(slot.slot_time, 'HH24:MI') AS time, EXISTS (SELECT 1 FROM appointments AS appointment WHERE appointment.site_id = slot.site_id AND appointment.appointment_date = slot.slot_date AND appointment.appointment_time = slot.slot_time AND appointment.status <> 'cancelled') AS booked FROM monthly_schedules AS schedule LEFT JOIN consultation_slots AS slot ON slot.site_id = schedule.site_id AND slot.month_start = schedule.month_start AND slot.is_open = true AND slot.slot_date = ${filterDate}::date WHERE schedule.site_id = ${SITE_ID} AND schedule.month_start = ${start}::date ORDER BY slot.slot_date, slot.slot_time`
    : await sql(env)`SELECT schedule.status, slot.id, slot.slot_date::text AS date, to_char(slot.slot_time, 'HH24:MI') AS time, EXISTS (SELECT 1 FROM appointments AS appointment WHERE appointment.site_id = slot.site_id AND appointment.appointment_date = slot.slot_date AND appointment.appointment_time = slot.slot_time AND appointment.status <> 'cancelled') AS booked FROM monthly_schedules AS schedule LEFT JOIN consultation_slots AS slot ON slot.site_id = schedule.site_id AND slot.month_start = schedule.month_start AND slot.is_open = true WHERE schedule.site_id = ${SITE_ID} AND schedule.month_start = ${start}::date ORDER BY slot.slot_date, slot.slot_time`;
  const published = rows[0]?.status === 'published'; const slotRows = rows.filter((row) => row.id);
  const bookedSlots = slotRows.filter((row) => row.booked).length; const totalSlots = slotRows.length;
  const today = localToday(); const clock = localClock();
  const upcomingRows = slotRows.filter((row) => row.date > today || (row.date === today && row.time > clock)); const dayMap = new Map();
  for (const row of upcomingRows) {
    const day = dayMap.get(row.date) || { date: row.date, available: 0, booked: 0 };
    day[row.booked ? 'booked' : 'available'] += 1; dayMap.set(row.date, day);
  }
  return { month, published, totalSlots, bookedSlots, availableSlots: totalSlots - bookedSlots, fillPercent: totalSlots ? Math.round(bookedSlots * 100 / totalSlots) : 0, days: [...dayMap.values()], slots: upcomingRows.filter((row) => !row.booked).map((row) => ({ id: row.id, date: row.date, time: row.time, label: displayTime(row.time) })) };
}
async function routeApi(request, env) {
  const url = new URL(request.url); const path = url.pathname; const method = request.method.toUpperCase();
  if (path === '/api/health' && method === 'GET') return json({ ok: true, runtime: 'cloudflare-workers', siteId: SITE_ID });
  if (path === '/api/csrf' && method === 'GET') return issueCsrf(request, env);
  if (path === '/api/admin/entry' && method === 'GET') {
    const headers = headersWithSecurity({ Location: adminDashboardPath(new Date(), SITE_TIME_ZONE), 'Cache-Control': 'no-store' });
    return new Response(null, { status: 302, headers });
  }
  if (path === '/api/admin/session' && method === 'GET') {
    const configured = adminConfigured(env);
    const authenticated = configured && await adminOk(request, env);
    return json({ configured, authenticated, dashboardPath: adminDashboardPath(new Date(), SITE_TIME_ZONE), email: authenticated ? env.ADMIN_EMAIL : '' });
  }
  if (path === '/api/admin/login' && method === 'POST') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!adminConfigured(env)) return adminFailure(env);
    const value = await readJson(request);
    if (!value || typeof value !== 'object') return error('Send a valid owner sign-in form.');
    const username = cleanText(value.username, 64);
    const password = String(value.password || '');
    const usernameMatches = constantEqual(username.toLowerCase(), String(env.ADMIN_USERNAME).trim().toLowerCase());
    const passwordMatches = await verifyPasswordHash(password, String(env.ADMIN_PASSWORD_HASH));
    if (!usernameMatches || !passwordMatches) return error('Username or password is incorrect.', 401);
    const token = await createAdminSession(env.ADMIN_USERNAME, env.ADMIN_PASSWORD_HASH, env.CSRF_SECRET);
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    const cookie = `${adminSessionCookieName(request)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`;
    return json({ ok: true, email: env.ADMIN_EMAIL }, 200, { 'Set-Cookie': cookie });
  }
  if (path === '/api/admin/logout' && method === 'POST') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    const cookie = `${adminSessionCookieName(request)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }
  if (path === '/api/site' && method === 'GET') return json(await siteConfig(env));
  if (path === '/api/site' && method === 'PUT') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    const body = await readJson(request); if (!body) return error('Send a valid JSON object.');
    const config = cleanSiteConfig(body);
    if (!config.businessName || (config.email && !/^\S+@\S+\.\S+$/.test(config.email))) return error('Check the practice name and contact email.');
    try {
      const rows = await sql(env)`INSERT INTO sites (site_id, config) VALUES (${SITE_ID}, ${JSON.stringify(config)}::jsonb) ON CONFLICT (site_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now() RETURNING config`;
      return json({ config: rows[0].config });
    } catch (cause) { console.error('site config save failed', cause); return error('Could not save the site settings. Check the Neon schema and connection.', 503); }
  }
  if (path === '/api/auth/register' && method === 'POST') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!DEFAULT_CONFIG.features?.scheduling) return error('Online appointments are not enabled.', 404);
    if (!env.DATABASE_URL) return error('Client accounts need a configured appointment database.', 503);
    const value = await readJson(request); if (!value || typeof value !== 'object') return error('Send a valid account form.');
    const name = cleanText(value.name, 100); const email = cleanText(value.email, 120).toLowerCase(); const phone = cleanText(value.phone, 30); const password = String(value.password || '');
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !phone || password.length < 12 || password.length > 128) return error('Enter your name, a valid email, phone number, and a password of at least 12 characters.');
    const passwordHash = await makePasswordHash(password);
    try {
      const accounts = await sql(env)`INSERT INTO client_accounts (site_id, full_name, email, phone, password_hash) VALUES (${SITE_ID}, ${name}, ${email}, ${phone}, ${passwordHash}) RETURNING id, full_name AS name, email, phone`;
      const sessionHeaders = await createClientSession(request, env, accounts[0]);
      return json({ client: clientSummary(accounts[0]) }, 201, sessionHeaders);
    } catch (cause) { console.error('client account registration failed', cause); return error(cause.code === '23505' ? 'An account with that email already exists. Please sign in instead.' : 'Could not create the client account.', cause.code === '23505' ? 409 : 503); }
  }
  if (path === '/api/auth/login' && method === 'POST') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!DEFAULT_CONFIG.features?.scheduling) return error('Online appointments are not enabled.', 404);
    if (!env.DATABASE_URL) return error('Client accounts need a configured appointment database.', 503);
    const value = await readJson(request); if (!value || typeof value !== 'object') return error('Send a valid sign-in form.');
    const email = cleanText(value.email, 120).toLowerCase(); const password = String(value.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 128) return error('Enter a valid email and password.');
    const accounts = await sql(env)`SELECT id, full_name AS name, email, phone, password_hash AS "passwordHash" FROM client_accounts WHERE site_id = ${SITE_ID} AND email = ${email} LIMIT 1`;
    if (!accounts.length || !await passwordMatches(password, accounts[0].passwordHash)) return error('Email or password is incorrect.', 401);
    const sessionHeaders = await createClientSession(request, env, accounts[0]);
    return json({ client: clientSummary(accounts[0]) }, 200, sessionHeaders);
  }
  if (path === '/api/auth/me' && method === 'GET') {
    const client = await currentClient(request, env);
    return json({ client: client ? clientSummary(client) : null });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    const token = readCookie(request.headers.get('Cookie'), CLIENT_SESSION_COOKIE);
    if (token && env.DATABASE_URL) {
      const tokenHash = await sessionTokenHash(token);
      await sql(env)`DELETE FROM client_sessions WHERE site_id = ${SITE_ID} AND token_hash = ${tokenHash}`;
    }
    return json({ ok: true }, 200, clearClientSession(request));
  }
  if (path === '/api/posts' && method === 'GET') {
    if (!DEFAULT_CONFIG.features?.blog) return json({ posts: [] });
    if (!env.DATABASE_URL) return json({ posts: DEFAULT_CONFIG.demoPosts || [] });
    try {
      const posts = await sql(env)`SELECT post.id, post.title, post.slug, post.excerpt, post.category, post.feature_image_url AS "featureImageUrl", post.feature_image_alt AS "featureImageAlt", post.published_at AS "publishedAt", post.created_at AS "createdAt" FROM blog_posts AS post WHERE post.site_id = ${SITE_ID} AND post.status = 'published' ORDER BY post.published_at DESC NULLS LAST, post.created_at DESC LIMIT 12`;
      return json({ posts });
    } catch (cause) { console.error('blog read failed', cause); return error('Could not load journal posts.', 503); }
  }
  if (path.startsWith('/api/posts/') && method === 'GET') {
    if (!DEFAULT_CONFIG.features?.blog) return error('Article not found.', 404);
    let slug = ''; try { slug = decodeURIComponent(path.slice('/api/posts/'.length)); } catch (_) { return error('Article not found.', 404); }
    if (!/^[a-z0-9-]{1,160}$/i.test(slug)) return error('Article not found.', 404);
    if (!env.DATABASE_URL) {
      const post = (DEFAULT_CONFIG.demoPosts || []).find((item) => item.slug === slug);
      return post ? json({ post }) : error('Article not found.', 404);
    }
    try {
      const rows = await sql(env)`SELECT post.id, post.title, post.slug, post.excerpt, post.body, post.category, post.feature_image_url AS "featureImageUrl", post.feature_image_alt AS "featureImageAlt", post.published_at AS "publishedAt", post.created_at AS "createdAt", COALESCE((SELECT json_agg(json_build_object('id', image.id, 'imageUrl', image.image_url, 'altText', image.alt_text, 'caption', image.caption, 'sortOrder', image.sort_order) ORDER BY image.sort_order) FROM blog_post_images AS image WHERE image.site_id = post.site_id AND image.post_id = post.id), '[]'::json) AS gallery FROM blog_posts AS post WHERE post.site_id = ${SITE_ID} AND post.status = 'published' AND post.slug = ${slug} LIMIT 1`;
      return rows.length ? json({ post: rows[0] }) : error('Article not found.', 404);
    } catch (cause) { console.error('blog article read failed', cause); return error('Could not load this article.', 503); }
  }
  if (path === '/api/gallery' && method === 'GET') {
    if (!DEFAULT_CONFIG.features?.gallery) return json({ items: [] });
    if (!env.DATABASE_URL) return json({ items: DEFAULT_CONFIG.demoGallery || [] });
    try {
      const items = await sql(env)`SELECT id, title, image_url AS "imageUrl", alt_text AS "altText", caption, category, status, sort_order AS "sortOrder", created_at AS "createdAt" FROM gallery_items WHERE site_id = ${SITE_ID} AND status = 'published' ORDER BY sort_order ASC, created_at DESC LIMIT 24`;
      return json({ items });
    } catch (cause) { console.error('gallery read failed', cause); return error('Could not load gallery items.', 503); }
  }
  if (path === '/api/availability/summary' && method === 'GET') {
    const month = String(url.searchParams.get('month') || '');
    if (!monthStart(month)) return error('Choose a valid month.');
    if (!DEFAULT_CONFIG.features?.scheduling) return json({ month, published: false, totalSlots: 0, bookedSlots: 0, availableSlots: 0, fillPercent: 0 });
    const data = await availabilityForMonth(env, month);
    return json({ month: data.month, published: data.published, totalSlots: data.totalSlots, bookedSlots: data.bookedSlots, availableSlots: data.availableSlots, fillPercent: data.fillPercent });
  }
  if (path === '/api/availability' && method === 'GET') {
    const date = String(url.searchParams.get('date') || ''); const month = String(url.searchParams.get('month') || (date ? date.slice(0, 7) : localToday().slice(0, 7)));
    if (!monthStart(month)) return error('Choose a valid month.');
    if (date && (!validDate(date) || date < localToday() || date.slice(0, 7) !== month)) return error('Choose a valid future date in the selected month.');
    if (!DEFAULT_CONFIG.features?.scheduling) return json({ month, published: false, slots: [], days: [], totalSlots: 0, bookedSlots: 0, availableSlots: 0, fillPercent: 0 });
    try { return json(await availabilityForMonth(env, month, date)); }
    catch (cause) { console.error('availability read failed', cause); return error('Could not load the monthly schedule.', 503); }
  }
  if (path === '/api/admin/availability' && method === 'GET') {
    if (!await adminOk(request, env)) return adminFailure(env);
    if (!DEFAULT_CONFIG.features?.scheduling) return error('Online appointments are not enabled.', 404);
    const month = String(url.searchParams.get('month') || ''); const start = monthStart(month);
    if (!start) return error('Choose a valid month.');
    if (!env.DATABASE_URL) return error('Availability needs a configured appointment database.', 503);
    try {
      const schedules = await sql(env)`SELECT weekly_rules AS "weeklyRules", exceptions, status, published_at AS "publishedAt" FROM monthly_schedules WHERE site_id = ${SITE_ID} AND month_start = ${start}::date LIMIT 1`;
      const metrics = await sql(env)`SELECT count(*)::int AS total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM appointments AS appointment WHERE appointment.site_id = slot.site_id AND appointment.appointment_date = slot.slot_date AND appointment.appointment_time = slot.slot_time AND appointment.status <> 'cancelled'))::int AS booked FROM consultation_slots AS slot WHERE slot.site_id = ${SITE_ID} AND slot.month_start = ${start}::date AND slot.is_open = true`;
      const schedule = schedules[0] || { weeklyRules: Array.from({ length: 7 }, (_unused, weekday) => ({ weekday, enabled: false, startTime: '09:00', endTime: '17:00' })), exceptions: [], status: 'unpublished' };
      return json({ month, deadline: monthDeadline(month), locked: !schedules.length && localToday() > monthDeadline(month), schedule, totalSlots: Number(metrics[0]?.total || 0), bookedSlots: Number(metrics[0]?.booked || 0) });
    } catch (cause) { console.error('owner schedule read failed', cause); return error('Could not load this month’s availability form.', 503); }
  }
  if (path.startsWith('/api/admin/availability/') && method === 'PUT') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    if (!DEFAULT_CONFIG.features?.scheduling) return error('Online appointments are not enabled.', 404);
    const month = path.slice('/api/admin/availability/'.length); const start = monthStart(month);
    if (!start || month < localToday().slice(0, 7)) return error('Choose the current or a future month.');
    const value = await readJson(request); if (!value || typeof value !== 'object') return error('Send a valid availability form.');
    const schedule = cleanMonthlySchedule(value, month); const slots = schedule && buildMonthlySlots(schedule);
    if (!schedule || !slots) return error('Check the seven weekly-hour rows and date exceptions. Use 30-minute start/end times and no more than 1,000 slots.');
    try {
      const existing = await sql(env)`SELECT status FROM monthly_schedules WHERE site_id = ${SITE_ID} AND month_start = ${start}::date LIMIT 1`;
      const deadline = monthDeadline(month);
      if (!existing.length && localToday() > deadline) return error(`This month’s schedule deadline was ${deadline}. A missing schedule stays unavailable.`, 409);
      const slotJson = JSON.stringify(slots.map((slot) => ({ slot_date: slot.slotDate, slot_time: slot.slotTime })));
      const conflicts = await sql(env)`SELECT appointment.id FROM appointments AS appointment WHERE appointment.site_id = ${SITE_ID} AND appointment.appointment_date >= ${start}::date AND appointment.appointment_date < (${start}::date + interval '1 month')::date AND appointment.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${slotJson}::jsonb) AS proposed(slot_date date, slot_time time) WHERE proposed.slot_date = appointment.appointment_date AND proposed.slot_time = appointment.appointment_time) LIMIT 1`;
      if (conflicts.length) return error('This change would remove a reserved appointment time. Keep it in the schedule or cancel the appointment first.', 409);
      const saved = await sql(env)`
        WITH saved AS (
          INSERT INTO monthly_schedules (site_id, month_start, weekly_rules, exceptions, status, published_at)
          VALUES (${SITE_ID}, ${start}::date, ${JSON.stringify(schedule.weeklyRules)}::jsonb, ${JSON.stringify(schedule.exceptions)}::jsonb, 'published', now())
          ON CONFLICT (site_id, month_start) DO UPDATE SET weekly_rules = EXCLUDED.weekly_rules, exceptions = EXCLUDED.exceptions, status = 'published', published_at = now(), updated_at = now()
          RETURNING site_id, month_start
        ), removed AS (
          DELETE FROM consultation_slots AS slot USING saved WHERE slot.site_id = saved.site_id AND slot.month_start = saved.month_start
            AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${slotJson}::jsonb) AS proposed(slot_date date, slot_time time) WHERE proposed.slot_date = slot.slot_date AND proposed.slot_time = slot.slot_time)
          RETURNING slot.id
        ), added AS (
          INSERT INTO consultation_slots (site_id, month_start, slot_date, slot_time, is_open)
          SELECT saved.site_id, saved.month_start, proposed.slot_date, proposed.slot_time, true FROM saved
          CROSS JOIN jsonb_to_recordset(${slotJson}::jsonb) AS proposed(slot_date date, slot_time time)
          ON CONFLICT (site_id, slot_date, slot_time) DO UPDATE SET month_start = EXCLUDED.month_start, is_open = true, updated_at = now()
          RETURNING id
        )
        SELECT saved.month_start FROM saved`;
      if (!saved.length) return error('The schedule could not be published.', 500);
      const availability = await availabilityForMonth(env, month);
      return json({ schedule: { ...schedule, status: 'published', publishedAt: new Date().toISOString() }, deadline, totalSlots: availability.totalSlots, bookedSlots: availability.bookedSlots });
    } catch (cause) {
      if (cause.code === '23505' || cause.code === '23503') return error('The schedule conflicts with a reserved appointment. Refresh and try again.', 409);
      console.error('owner schedule publish failed', cause); return error('Could not publish this month’s schedule.', 503);
    }
  }
  if (path === '/api/appointments' && method === 'POST') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!DEFAULT_CONFIG.features?.scheduling) return error('Online appointments are not enabled.', 404);
    const client = await currentClient(request, env);
    if (!client) return error('Sign in or create a client account to reserve a consultation.', 401);
    const value = await readJson(request); if (!value || typeof value !== 'object') return error('Send a valid booking form.');
    const slotId = String(value.slotId || ''); const service = cleanText(value.service, 120); const context = cleanText(value.context, 100);
    if (!/^[0-9a-f-]{36}$/i.test(slotId) || !DEFAULT_CONFIG.services.includes(service)) return error('Choose a valid open time and visit type.');
    try {
      const rows = await sql(env)`INSERT INTO appointments (site_id, client_account_id, availability_slot_id, name, email, phone, service, appointment_date, appointment_time, context, status) SELECT ${SITE_ID}, ${client.id}, slot.id, ${client.name}, ${client.email}, ${client.phone}, ${service}, slot.slot_date, slot.slot_time, ${context}, 'confirmed' FROM consultation_slots AS slot JOIN monthly_schedules AS schedule ON schedule.site_id = slot.site_id AND schedule.month_start = slot.month_start WHERE slot.site_id = ${SITE_ID} AND slot.id = ${slotId}::uuid AND slot.is_open = true AND schedule.status = 'published' AND slot.slot_date >= ${localToday()}::date AND (slot.slot_date + slot.slot_time) AT TIME ZONE ${SITE_TIME_ZONE} > now() AND NOT EXISTS (SELECT 1 FROM appointments AS existing WHERE existing.site_id = slot.site_id AND existing.appointment_date = slot.slot_date AND existing.appointment_time = slot.slot_time AND existing.status <> 'cancelled') RETURNING id, appointment_date::text AS date, to_char(appointment_time, 'HH24:MI') AS time`;
      if (!rows.length) return error('That time was just taken or is no longer available. Refresh the calendar and choose another.', 409);
      return json({ ok: true, appointment: { ...rows[0], timeLabel: displayTime(rows[0].time), status: 'confirmed' } }, 201);
    } catch (cause) {
      if (cause.code === '23505') return error('That time was just taken. Refresh the calendar and choose another.', 409);
      console.error('appointment reservation failed', cause); return error('We could not reserve this consultation. Please try again.', 503);
    }
  }
  if (path === '/api/client/appointments' && method === 'GET') {
    const client = await currentClient(request, env);
    if (!client) return error('Sign in to view your consultations.', 401);
    try {
      const appointments = await sql(env)`SELECT appointment.id, appointment.name, appointment.email, appointment.phone, appointment.service, appointment.context, appointment.status, appointment.appointment_date::text AS date, to_char(appointment.appointment_time, 'HH24:MI') AS time, note.note_body AS "noteBody", note.updated_at AS "noteUpdatedAt" FROM appointments AS appointment LEFT JOIN consultation_notes AS note ON note.site_id = appointment.site_id AND note.appointment_id = appointment.id AND note.client_account_id = appointment.client_account_id WHERE appointment.site_id = ${SITE_ID} AND appointment.client_account_id = ${client.id} ORDER BY appointment.appointment_date DESC, appointment.appointment_time DESC LIMIT 200`;
      return json({ appointments: appointments.map((row) => ({ ...row, timeLabel: displayTime(row.time) })) });
    } catch (cause) { console.error('client appointment list failed', cause); return error('Could not load your consultations.', 503); }
  }
  if (path.startsWith('/api/client/appointments/') && method === 'PATCH') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    const client = await currentClient(request, env); const id = path.slice('/api/client/appointments/'.length); const value = await readJson(request);
    if (!client) return error('Sign in to manage your consultations.', 401);
    if (!/^[0-9a-f-]{36}$/i.test(id) || value?.status !== 'cancelled') return error('Invalid consultation update.');
    try {
      const rows = await sql(env)`UPDATE appointments SET status = 'cancelled' WHERE site_id = ${SITE_ID} AND id = ${id}::uuid AND client_account_id = ${client.id} AND status <> 'cancelled' RETURNING id, status`;
      return rows.length ? json({ appointment: rows[0] }) : error('That consultation was not found or was already cancelled.', 404);
    } catch (cause) { console.error('client appointment cancel failed', cause); return error('Could not cancel this consultation.', 503); }
  }
  if (path === '/api/admin/appointments' && method === 'GET') {
    if (!await adminOk(request, env)) return adminFailure(env);
    try {
      const appointments = await sql(env)`SELECT appointment.id, appointment.name, appointment.email, appointment.phone, appointment.service, appointment.context, appointment.status, appointment.appointment_date::text AS date, to_char(appointment.appointment_time, 'HH24:MI') AS time, client.id AS "clientId", note.note_body AS "noteBody", note.updated_at AS "noteUpdatedAt" FROM appointments AS appointment LEFT JOIN client_accounts AS client ON client.id = appointment.client_account_id AND client.site_id = appointment.site_id LEFT JOIN consultation_notes AS note ON note.site_id = appointment.site_id AND note.appointment_id = appointment.id WHERE appointment.site_id = ${SITE_ID} AND appointment.appointment_date >= (${localToday()}::date - interval '90 days')::date AND appointment.appointment_date <= (${localToday()}::date + interval '90 days')::date ORDER BY appointment.appointment_date ASC, appointment.appointment_time ASC LIMIT 300`;
      return json({ appointments: appointments.map((row) => ({ ...row, timeLabel: displayTime(row.time) })) });
    } catch (cause) { console.error('appointment list failed', cause); return error('Could not load appointment requests. Check the Neon schema.', 503); }
  }
  if (path.startsWith('/api/admin/appointments/') && method === 'PATCH') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    const id = path.slice('/api/admin/appointments/'.length); const value = await readJson(request); const status = String(value?.status || '');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !['requested', 'confirmed', 'cancelled'].includes(status)) return error('Invalid appointment update.');
    try {
      if (status === 'cancelled') {
        const rows = await sql(env)`UPDATE appointments SET status = 'cancelled' WHERE site_id = ${SITE_ID} AND id = ${id}::uuid AND (appointment_date + appointment_time) AT TIME ZONE ${SITE_TIME_ZONE} > now() + interval '24 hours' RETURNING id, status`;
        if (!rows.length) {
          const exists = await sql(env)`SELECT id FROM appointments WHERE site_id = ${SITE_ID} AND id = ${id}::uuid LIMIT 1`;
          return exists.length ? error('Owner cancellations must be made at least 24 hours before the appointment.', 409) : error('That appointment was not found.', 404);
        }
        return json({ appointment: rows[0] });
      }
      const rows = await sql(env)`UPDATE appointments SET status = ${status} WHERE site_id = ${SITE_ID} AND id = ${id}::uuid RETURNING id, status`;
      return rows.length ? json({ appointment: rows[0] }) : error('That appointment was not found.', 404);
    } catch (cause) {
      if (cause.code === '23505') return error('That time slot has already been taken.', 409);
      console.error('appointment update failed', cause); return error('Could not update the appointment.', 503);
    }
  }
  if (path.startsWith('/api/admin/appointments/') && path.endsWith('/note') && method === 'PUT') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    const id = path.slice('/api/admin/appointments/'.length, -'/note'.length);
    const value = await readJson(request); if (!/^[0-9a-f-]{36}$/i.test(id) || !value || typeof value !== 'object') return error('Invalid consultation note.');
    const noteBody = cleanText(value.noteBody, 12000);
    try {
      if (!noteBody) {
        await sql(env)`DELETE FROM consultation_notes WHERE site_id = ${SITE_ID} AND appointment_id = ${id}::uuid`;
        return json({ note: null });
      }
      const rows = await sql(env)`INSERT INTO consultation_notes (site_id, appointment_id, client_account_id, note_body) SELECT ${SITE_ID}, appointment.id, appointment.client_account_id, ${noteBody} FROM appointments AS appointment WHERE appointment.site_id = ${SITE_ID} AND appointment.id = ${id}::uuid AND appointment.client_account_id IS NOT NULL ON CONFLICT (site_id, appointment_id) DO UPDATE SET client_account_id = EXCLUDED.client_account_id, note_body = EXCLUDED.note_body, updated_at = now() RETURNING note_body AS "noteBody", updated_at AS "noteUpdatedAt"`;
      return rows.length ? json({ note: rows[0] }) : error('This older appointment has no linked client account, so it cannot receive a private account note.', 400);
    } catch (cause) { console.error('consultation note save failed', cause); return error('Could not save this private consultation note.', 503); }
  }
  if (path === '/api/admin/posts' && method === 'GET') {
    if (!await adminOk(request, env)) return adminFailure(env);
    try {
      const posts = await sql(env)`SELECT post.id, post.title, post.slug, post.excerpt, post.body, post.category, post.feature_image_url AS "featureImageUrl", post.feature_image_alt AS "featureImageAlt", post.status, post.published_at AS "publishedAt", post.created_at AS "createdAt", COALESCE((SELECT json_agg(json_build_object('id', image.id, 'imageUrl', image.image_url, 'altText', image.alt_text, 'caption', image.caption, 'sortOrder', image.sort_order) ORDER BY image.sort_order) FROM blog_post_images AS image WHERE image.site_id = post.site_id AND image.post_id = post.id), '[]'::json) AS gallery FROM blog_posts AS post WHERE post.site_id = ${SITE_ID} ORDER BY post.created_at DESC LIMIT 100`;
      return json({ posts });
    } catch (cause) { console.error('admin blog read failed', cause); return error('Could not load blog posts. Check the Neon schema.', 503); }
  }
  if (path === '/api/admin/posts' && method === 'POST') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    const value = await readJson(request); if (!value) return error('Send a valid JSON object.');
    const post = articlePostPayload(value);
    if (!post) return error('Add a title and article body, plus a valid feature image. If you leave the feature image blank, add a gallery image with a URL and alt text.');
    try {
      const posts = await persistArticle(sql(env), post);
      return json({ post: posts[0] }, 201);
    } catch (cause) { console.error('blog post save failed', cause); return error(cause.code === '23505' ? 'That URL slug is already in use or gallery order is duplicated.' : 'Could not save the post.', cause.code === '23505' ? 409 : 503); }
  }
  if (path.startsWith('/api/admin/posts/') && method === 'PUT') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    const id = path.slice('/api/admin/posts/'.length);
    const value = await readJson(request); if (!value) return error('Send a valid JSON object.');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return error('Invalid post id.');
    const post = articlePostPayload(value);
    if (!post) return error('Add a title and article body, plus a valid feature image. If you leave the feature image blank, add a gallery image with a URL and alt text.');
    try {
      const posts = await persistArticle(sql(env), post, id);
      return posts.length ? json({ post: posts[0] }) : error('That post was not found.', 404);
    } catch (cause) {
      if (cause.code === '23505') return error('That URL slug is already in use or gallery order is duplicated.', 409);
      console.error('blog post update failed', cause); return error('Could not update the post.', 503);
    }
  }
  if (path.startsWith('/api/admin/posts/') && method === 'DELETE') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    const id = path.slice('/api/admin/posts/'.length);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return error('Invalid post id.');
    try {
      const rows = await sql(env)`DELETE FROM blog_posts WHERE site_id = ${SITE_ID} AND id = ${id}::uuid RETURNING id`;
      return rows.length ? json({ ok: true }) : error('That post was not found.', 404);
    } catch (cause) { console.error('blog post delete failed', cause); return error('Could not delete the post.', 503); }
  }
  if (path === '/api/admin/gallery' && method === 'GET') {
    if (!await adminOk(request, env)) return adminFailure(env);
    try {
      const items = await sql(env)`SELECT id, title, image_url AS "imageUrl", alt_text AS "altText", caption, category, status, sort_order AS "sortOrder", created_at AS "createdAt" FROM gallery_items WHERE site_id = ${SITE_ID} ORDER BY sort_order ASC, created_at DESC LIMIT 100`;
      return json({ items });
    } catch (cause) { console.error('gallery admin read failed', cause); return error('Could not load gallery items. Check the Neon schema.', 503); }
  }
  if (path === '/api/admin/gallery' && method === 'POST') {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    const value = await readJson(request); if (!value) return error('Send a valid JSON object.');
    const item = galleryPayload(value);
    if (!validGalleryPayload(item)) return error('Add a title, valid HTTPS or same-site image URL and alternative text. Display order must be from 0 to 9999.');
    try {
      const items = await sql(env)`INSERT INTO gallery_items (site_id, title, image_url, alt_text, caption, category, status, sort_order) VALUES (${SITE_ID}, ${item.title}, ${item.imageUrl}, ${item.altText}, ${item.caption}, ${item.category}, ${item.status}, ${item.sortOrder}) RETURNING id, title, image_url AS "imageUrl", alt_text AS "altText", caption, category, status, sort_order AS "sortOrder", created_at AS "createdAt"`;
      return json({ item: items[0] }, 201);
    } catch (cause) { console.error('gallery item create failed', cause); return error('Could not save the gallery item.', 503); }
  }
  if (path.startsWith('/api/admin/gallery/') && (method === 'PUT' || method === 'DELETE')) {
    if (!await csrfOk(request, env)) return error('Cross-site request rejected or security token expired.', 403);
    if (!await adminOk(request, env)) return adminFailure(env);
    const id = path.slice('/api/admin/gallery/'.length);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return error('Invalid gallery item id.');
    if (method === 'DELETE') {
      try {
        const rows = await sql(env)`DELETE FROM gallery_items WHERE site_id = ${SITE_ID} AND id = ${id}::uuid RETURNING id`;
        return rows.length ? json({ ok: true }) : error('That gallery item was not found.', 404);
      } catch (cause) { console.error('gallery item delete failed', cause); return error('Could not delete the gallery item.', 503); }
    }
    const value = await readJson(request); if (!value) return error('Send a valid JSON object.');
    const item = galleryPayload(value);
    if (!validGalleryPayload(item)) return error('Add a title, valid HTTPS or same-site image URL and alternative text. Display order must be from 0 to 9999.');
    try {
      const items = await sql(env)`UPDATE gallery_items SET title = ${item.title}, image_url = ${item.imageUrl}, alt_text = ${item.altText}, caption = ${item.caption}, category = ${item.category}, status = ${item.status}, sort_order = ${item.sortOrder}, updated_at = now() WHERE site_id = ${SITE_ID} AND id = ${id}::uuid RETURNING id, title, image_url AS "imageUrl", alt_text AS "altText", caption, category, status, sort_order AS "sortOrder", created_at AS "createdAt"`;
      return items.length ? json({ item: items[0] }) : error('That gallery item was not found.', 404);
    } catch (cause) { console.error('gallery item update failed', cause); return error('Could not update the gallery item.', 503); }
  }
  return error('API route not found.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await routeApi(request, env); }
      catch (cause) { console.error('unhandled Worker API error', cause); return error('Something went wrong. Please try again.', 500); }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return error('Method not allowed.', 405);
    if (url.pathname === '/admin.html') return error('Not found.', 404);
    if (isAdminDashboardPath(url.pathname)) {
      const expectedPath = adminDashboardPath(new Date(), SITE_TIME_ZONE);
      if (url.pathname !== expectedPath) {
        const headers = headersWithSecurity({ Location: expectedPath, 'Cache-Control': 'no-store' });
        return new Response(null, { status: 302, headers });
      }
      const assetUrl = new URL('/admin.html', url);
      const assetRequest = new Request(assetUrl, { method: request.method, headers: request.headers });
      const response = await env.ASSETS.fetch(assetRequest);
      const headers = headersWithSecurity(response.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    const response = await env.ASSETS.fetch(request);
    const headers = headersWithSecurity(response.headers);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
