import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { createNeonClient } from '../db/connection.js';
import { createAdminSession, verifyAdminSession, verifyPasswordHash } from '../lib/admin-security.js';
import { adminDashboardPath } from '../lib/admin-url.js';
import { cleanMenuLinks } from '../lib/menu-links.js';
import { detectPaymentProofMime, MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_MIME_TYPES, paymentProofFromBase64, paymentProofToBase64 } from '../lib/payment-proof.js';
import { runPaymentReminderChecks } from '../lib/payment-reminders.js';
import { createHmac, randomBytes, timingSafeEqual, webcrypto } from 'node:crypto';

const app = express();
const SITE_ID = '__SITE_ID__';
const DEFAULT_CONFIG = __SITE_CONFIG_JSON__;
const MAX_BODY = '256kb';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'], fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
      objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginResourcePolicy: { policy: 'same-site' }
}));
app.use(express.json({ limit: MAX_BODY, strict: true }));
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use((req, res, next) => {
  if (req.path === '/admin.html' || req.query.__admin_static === '1') return res.status(404).end();
  next();
});

const getDb = () => createNeonClient(process.env.DATABASE_URL);
const csrfSecret = () => process.env.CSRF_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-only-change-before-deploy');
const csrfCookie = 'practice_csrf';
const clientSessionCookie = 'canopy_client';
const clientSessionTtlSeconds = 30 * 24 * 60 * 60;
// Node's WebCrypto has no 100,000-iteration ceiling; Cloudflare Workers do.
const passwordIterations = 210000;
const siteTimeZone = DEFAULT_CONFIG.timeZone || 'Asia/Manila';
const b64url = (value) => Buffer.from(value).toString('base64url');
function makeCsrfToken() {
  const nonce = b64url(randomBytes(24));
  const secret = csrfSecret();
  if (!secret) throw new Error('CSRF_SECRET is not configured.');
  const signature = createHmac('sha256', secret).update(nonce).digest('base64url');
  return `${nonce}.${signature}`;
}
function tokenIsValid(token) {
  const secret = csrfSecret();
  if (!secret || typeof token !== 'string') return false;
  const [nonce, signature, ...rest] = token.split('.');
  if (!nonce || !signature || rest.length) return false;
  const expected = createHmac('sha256', secret).update(nonce).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch (_) { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function cookieValue(header, name) {
  for (const item of String(header || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) { try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch (_) { return ''; } }
  }
  return '';
}
function adminConfigured() {
  return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH && csrfSecret());
}
function adminSessionCookieName(req) {
  return req.secure ? '__Host-canopy_owner' : 'canopy_owner';
}
async function adminOk(req) {
  if (!adminConfigured()) return false;
  const token = cookieValue(req.headers.cookie, adminSessionCookieName(req));
  return verifyAdminSession(token, process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD_HASH, csrfSecret());
}
async function passwordDigest(password, salt, iterations = passwordIterations) {
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(password, 'utf8'), 'PBKDF2', false, ['deriveBits']);
  const derived = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', salt: Buffer.from(salt, 'base64url'), iterations, hash: 'SHA-256' }, key, 256);
  return Buffer.from(derived).toString('base64url');
}
async function makePasswordHash(password) {
  const salt = randomBytes(16).toString('base64url');
  return `pbkdf2$${passwordIterations}$${salt}$${await passwordDigest(password, salt)}`;
}
async function passwordMatches(password, encoded) {
  const [algorithm, roundsText, salt, expectedText, ...rest] = String(encoded || '').split('$');
  const rounds = Number(roundsText);
  if (algorithm !== 'pbkdf2' || rest.length || !salt || !expectedText || !Number.isInteger(rounds) || rounds < 100000 || rounds > 1000000) return false;
  try {
    const actual = Buffer.from(await passwordDigest(password, salt, rounds), 'base64url');
    const expected = Buffer.from(expectedText, 'base64url');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}
async function sessionTokenHash(token) {
  const digest = await webcrypto.subtle.digest('SHA-256', Buffer.from(token, 'utf8'));
  return Buffer.from(digest).toString('hex');
}
function clientSummary(row) { return { id: row.id, name: row.name, email: row.email, phone: row.phone }; }
async function createClientSession(req, res, account) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = await sessionTokenHash(token);
  const sql = getDb();
  await sql`DELETE FROM client_sessions WHERE site_id = ${SITE_ID} AND expires_at < now()`;
  await sql`INSERT INTO client_sessions (site_id, client_account_id, token_hash, expires_at) VALUES (${SITE_ID}, ${account.id}, ${tokenHash}, now() + (${clientSessionTtlSeconds} * interval '1 second'))`;
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${clientSessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clientSessionTtlSeconds}${secure}`);
}
function clearClientSession(req, res) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${clientSessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}
async function currentClient(req) {
  const token = cookieValue(req.headers.cookie, clientSessionCookie);
  if (!token || !process.env.DATABASE_URL) return null;
  const tokenHash = await sessionTokenHash(token);
  const sql = getDb();
  const rows = await sql`SELECT account.id, account.full_name AS name, account.email, account.phone FROM client_sessions AS session JOIN client_accounts AS account ON account.id = session.client_account_id AND account.site_id = session.site_id WHERE session.site_id = ${SITE_ID} AND session.token_hash = ${tokenHash} AND session.expires_at > now() LIMIT 1`;
  return rows[0] || null;
}
function csrfGuard(req, res, next) {
  const cookie = cookieValue(req.headers.cookie, csrfCookie);
  const header = req.get('x-csrf-token');
  const origin = req.get('origin');
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expectedOrigin) return res.status(403).json({ error: 'Cross-site request rejected.' });
  if (!cookie || !header || cookie !== header || !tokenIsValid(header)) return res.status(403).json({ error: 'Your security token expired. Refresh and try again.' });
  next();
}
async function adminGuard(req, res, next) {
  if (!adminConfigured()) return res.status(503).json({ error: 'Owner sign-in is not configured. Check ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD_HASH and CSRF_SECRET.' });
  if (!await adminOk(req)) return res.status(401).json({ error: 'Owner session is not valid. Sign in again.' });
  next();
}
function cleanText(value, max, fallback = '') {
  return String(value ?? fallback).trim().slice(0, max);
}
function color(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback; }
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
    primaryColor: color(merged.primaryColor, DEFAULT_CONFIG.primaryColor),
    accentColor: color(merged.accentColor, DEFAULT_CONFIG.accentColor),
      paperColor: color(merged.paperColor, DEFAULT_CONFIG.paperColor),
    fontStyle: merged.fontStyle === 'sans' ? 'sans' : 'serif',
    theme: ['canopy','clay','coastal','editorial','neat','launcher','air','brivon-dark','brivon-light'].includes(merged.theme) ? merged.theme : DEFAULT_CONFIG.theme,
    editorialAccent: ['black','teal','forest'].includes(merged.editorialAccent) ? merged.editorialAccent : 'black',
    features: { ...DEFAULT_CONFIG.features, ...(merged.features || {}), gallery: merged.features?.gallery !== false },
    payments: cleanPaymentDetails(merged.payments),
    customPages: cleanCustomPages(merged.customPages, DEFAULT_CONFIG.customPages),
    menuLinks: cleanMenuLinks(merged.menuLinks, DEFAULT_CONFIG.menuLinks)
  };
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value && value >= localToday();
}
function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: siteTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function localClock() { return new Intl.DateTimeFormat('en-GB', { timeZone: siteTimeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()); }
function monthStart(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? `${value}-01` : ''; }
function monthDeadline(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const deadline = new Date(Date.UTC(year, monthNumber - 1, 0));
  deadline.setUTCDate(deadline.getUTCDate() - 2);
  return deadline.toISOString().slice(0, 10);
}
function timeMinutes(value) {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(String(value || ''));
  if (!match || Number(match[2]) % 30 !== 0) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
function validTimeWindow(start, end) {
  const from = timeMinutes(start); const to = timeMinutes(end);
  return from !== null && to !== null && from < to;
}
function cleanMonthlySchedule(value = {}, month) {
  const start = monthStart(month);
  if (!start || !Array.isArray(value.weeklyRules) || value.weeklyRules.length !== 7 || !Array.isArray(value.exceptions || []) || (value.exceptions || []).length > 31) return null;
  const rules = value.weeklyRules.map((rule) => ({
    weekday: Number(rule?.weekday), enabled: rule?.enabled === true,
    startTime: cleanText(rule?.startTime, 5), endTime: cleanText(rule?.endTime, 5)
  }));
  if (rules.some((rule) => !Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) || new Set(rules.map((rule) => rule.weekday)).size !== 7) return null;
  if (rules.some((rule) => rule.enabled && !validTimeWindow(rule.startTime, rule.endTime))) return null;
  const exceptions = (value.exceptions || []).map((item) => ({ date: cleanText(item?.date, 10), mode: item?.mode === 'closed' ? 'closed' : item?.mode === 'open' ? 'open' : '', startTime: cleanText(item?.startTime, 5), endTime: cleanText(item?.endTime, 5) }));
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if (exceptions.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.date < start || item.date > monthEnd || !item.mode || (item.mode === 'open' && !validTimeWindow(item.startTime, item.endTime))) || new Set(exceptions.map((item) => item.date)).size !== exceptions.length) return null;
  return { monthStart: start, weeklyRules: rules.sort((a, b) => a.weekday - b.weekday), exceptions };
}
function buildMonthlySlots(schedule) {
  const [year, monthNumber] = schedule.monthStart.slice(0, 7).split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const rules = new Map(schedule.weeklyRules.map((rule) => [rule.weekday, rule]));
  const exceptions = new Map(schedule.exceptions.map((item) => [item.date, item]));
  const today = localToday(); const slots = [];
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date < today) continue;
    const exception = exceptions.get(date);
    if (exception?.mode === 'closed') continue;
    const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    const rule = rules.get(weekday);
    const window = exception?.mode === 'open' ? exception : rule?.enabled ? rule : null;
    if (!window || !validTimeWindow(window.startTime, window.endTime)) continue;
    for (let minute = timeMinutes(window.startTime); minute < timeMinutes(window.endTime); minute += 30) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      slots.push({ slotDate: date, slotTime: time });
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
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

app.get('/api/health', (_req, res) => res.json({ ok: true, runtime: 'vercel-node', siteId: SITE_ID }));
app.get('/api/csrf', (req, res) => {
  try {
    const token = makeCsrfToken();
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${csrfCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${secure}`);
    res.json({ token });
  } catch (error) { res.status(503).json({ error: error.message }); }
});
app.get('/api/admin/entry', (req, res) => {
  res.redirect(302, adminDashboardPath(new Date(), siteTimeZone));
});
app.get('/api/admin/session', asyncRoute(async (req, res) => {
  const configured = adminConfigured();
  const authenticated = configured && await adminOk(req);
  res.json({ configured, authenticated, dashboardPath: adminDashboardPath(new Date(), siteTimeZone), email: authenticated ? process.env.ADMIN_EMAIL : '' });
}));
app.post('/api/admin/login', csrfGuard, asyncRoute(async (req, res) => {
  if (!adminConfigured()) return res.status(503).json({ error: 'Owner sign-in is not configured. Check the environment variables.' });
  const username = cleanText(req.body?.username, 64).toLowerCase();
  const password = String(req.body?.password || '');
  const expectedUsername = String(process.env.ADMIN_USERNAME).trim().toLowerCase();
  const givenBytes = Buffer.from(username);
  const expectedBytes = Buffer.from(expectedUsername);
  const usernameMatches = givenBytes.length === expectedBytes.length && timingSafeEqual(givenBytes, expectedBytes);
  const passwordMatches = await verifyPasswordHash(password, process.env.ADMIN_PASSWORD_HASH);
  if (!usernameMatches || !passwordMatches) return res.status(401).json({ error: 'Username or password is incorrect.' });
  const token = await createAdminSession(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD_HASH, csrfSecret());
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${adminSessionCookieName(req)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`);
  res.json({ ok: true, email: process.env.ADMIN_EMAIL });
}));
app.post('/api/admin/logout', csrfGuard, (req, res) => {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${adminSessionCookieName(req)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
  res.json({ ok: true });
});
app.get('/api/site', asyncRoute(async (_req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ config: DEFAULT_CONFIG, source: 'generated-fallback' });
  try {
    const sql = getDb();
    const rows = await sql`SELECT config FROM sites WHERE site_id = ${SITE_ID} LIMIT 1`;
    res.json({ config: rows[0]?.config || DEFAULT_CONFIG, source: rows[0] ? 'neon' : 'generated-fallback' });
  } catch (error) { console.error('site config read failed', error); res.json({ config: DEFAULT_CONFIG, source: 'generated-fallback' }); }
}));
app.post('/api/auth/register', csrfGuard, asyncRoute(async (req, res) => {
  if (!DEFAULT_CONFIG.features?.scheduling) return res.status(404).json({ error: 'Online appointments are not enabled.' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Client accounts need a configured appointment database.' });
  const value = req.body || {};
  const name = cleanText(value.name, 100);
  const email = cleanText(value.email, 120).toLowerCase();
  const phone = cleanText(value.phone, 30);
  const password = String(value.password || '');
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !phone || password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Enter your name, a valid email, phone number, and a password of at least 12 characters.' });
  const passwordHash = await makePasswordHash(password);
  try {
    const sql = getDb();
    const rows = await sql`INSERT INTO client_accounts (site_id, full_name, email, phone, password_hash) VALUES (${SITE_ID}, ${name}, ${email}, ${phone}, ${passwordHash}) RETURNING id, full_name AS name, email, phone`;
    await createClientSession(req, res, rows[0]);
    res.status(201).json({ client: clientSummary(rows[0]) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists. Please sign in instead.' });
    throw error;
  }
}));
app.post('/api/auth/login', csrfGuard, asyncRoute(async (req, res) => {
  if (!DEFAULT_CONFIG.features?.scheduling) return res.status(404).json({ error: 'Online appointments are not enabled.' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Client accounts need a configured appointment database.' });
  const value = req.body || {};
  const email = cleanText(value.email, 120).toLowerCase(); const password = String(value.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 128) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const sql = getDb();
  const rows = await sql`SELECT id, full_name AS name, email, phone, password_hash AS "passwordHash" FROM client_accounts WHERE site_id = ${SITE_ID} AND email = ${email} LIMIT 1`;
  if (!rows.length || !await passwordMatches(password, rows[0].passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  await createClientSession(req, res, rows[0]);
  res.json({ client: clientSummary(rows[0]) });
}));
app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const client = await currentClient(req);
  res.json({ client: client ? clientSummary(client) : null });
}));
app.post('/api/auth/logout', csrfGuard, asyncRoute(async (req, res) => {
  const token = cookieValue(req.headers.cookie, clientSessionCookie);
  if (token && process.env.DATABASE_URL) {
    const tokenHash = await sessionTokenHash(token); const sql = getDb();
    await sql`DELETE FROM client_sessions WHERE site_id = ${SITE_ID} AND token_hash = ${tokenHash}`;
  }
  clearClientSession(req, res); res.json({ ok: true });
}));
app.get('/api/posts', asyncRoute(async (_req, res) => {
  if (!DEFAULT_CONFIG.features?.blog) return res.json({ posts: [] });
  if (!process.env.DATABASE_URL) return res.json({ posts: DEFAULT_CONFIG.demoPosts || [] });
  const sql = getDb();
  const rows = await sql`SELECT post.id, post.title, post.slug, post.excerpt, post.category, post.feature_image_url AS "featureImageUrl", post.feature_image_alt AS "featureImageAlt", post.published_at AS "publishedAt", post.created_at AS "createdAt" FROM blog_posts AS post WHERE post.site_id = ${SITE_ID} AND post.status = 'published' ORDER BY post.published_at DESC NULLS LAST, post.created_at DESC LIMIT 12`;
  res.json({ posts: rows });
}));
app.get('/api/posts/:slug', asyncRoute(async (req, res) => {
  if (!DEFAULT_CONFIG.features?.blog) return res.status(404).json({ error: 'Article not found.' });
  if (!process.env.DATABASE_URL) {
    const post = (DEFAULT_CONFIG.demoPosts || []).find((item) => item.slug === req.params.slug);
    return post ? res.json({ post }) : res.status(404).json({ error: 'Article not found.' });
  }
  const sql = getDb();
  const rows = await sql`SELECT post.id, post.title, post.slug, post.excerpt, post.body, post.category, post.feature_image_url AS "featureImageUrl", post.feature_image_alt AS "featureImageAlt", post.published_at AS "publishedAt", post.created_at AS "createdAt", COALESCE((SELECT json_agg(json_build_object('id', image.id, 'imageUrl', image.image_url, 'altText', image.alt_text, 'caption', image.caption, 'sortOrder', image.sort_order) ORDER BY image.sort_order) FROM blog_post_images AS image WHERE image.site_id = post.site_id AND image.post_id = post.id), '[]'::json) AS gallery FROM blog_posts AS post WHERE post.site_id = ${SITE_ID} AND post.status = 'published' AND post.slug = ${req.params.slug} LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'Article not found.' });
  res.json({ post: rows[0] });
}));
app.get('/api/gallery', asyncRoute(async (_req, res) => {
  if (!DEFAULT_CONFIG.features?.gallery) return res.json({ items: [] });
  if (!process.env.DATABASE_URL) return res.json({ items: DEFAULT_CONFIG.demoGallery || [] });
  const sql = getDb();
  const rows = await sql`SELECT id, title, image_url AS "imageUrl", alt_text AS "altText", caption, category, status, sort_order AS "sortOrder", created_at AS "createdAt" FROM gallery_items WHERE site_id = ${SITE_ID} AND status = 'published' ORDER BY sort_order ASC, created_at DESC LIMIT 24`;
  res.json({ items: rows });
}));
async function availabilityForMonth(month, filterDate = '') {
  const start = monthStart(month);
  if (!start) throw new Error('Choose a valid month in YYYY-MM format.');
  if (!process.env.DATABASE_URL) return { month, published: false, slots: [], days: [], totalSlots: 0, bookedSlots: 0, availableSlots: 0, fillPercent: 0 };
  const sql = getDb();
  const rows = filterDate
    ? await sql`SELECT schedule.status, slot.id, slot.slot_date::text AS date, to_char(slot.slot_time, 'HH24:MI') AS time, EXISTS (SELECT 1 FROM appointments AS appointment WHERE appointment.site_id = slot.site_id AND appointment.appointment_date = slot.slot_date AND appointment.appointment_time = slot.slot_time AND appointment.status <> 'cancelled') AS booked FROM monthly_schedules AS schedule LEFT JOIN consultation_slots AS slot ON slot.site_id = schedule.site_id AND slot.month_start = schedule.month_start AND slot.is_open = true AND slot.slot_date = ${filterDate}::date WHERE schedule.site_id = ${SITE_ID} AND schedule.month_start = ${start}::date ORDER BY slot.slot_date, slot.slot_time`
    : await sql`SELECT schedule.status, slot.id, slot.slot_date::text AS date, to_char(slot.slot_time, 'HH24:MI') AS time, EXISTS (SELECT 1 FROM appointments AS appointment WHERE appointment.site_id = slot.site_id AND appointment.appointment_date = slot.slot_date AND appointment.appointment_time = slot.slot_time AND appointment.status <> 'cancelled') AS booked FROM monthly_schedules AS schedule LEFT JOIN consultation_slots AS slot ON slot.site_id = schedule.site_id AND slot.month_start = schedule.month_start AND slot.is_open = true WHERE schedule.site_id = ${SITE_ID} AND schedule.month_start = ${start}::date ORDER BY slot.slot_date, slot.slot_time`;
  const published = rows[0]?.status === 'published';
  const slotRows = rows.filter((row) => row.id);
  const bookedSlots = slotRows.filter((row) => row.booked).length;
  const totalSlots = slotRows.length;
  const today = localToday(); const clock = localClock();
  const upcomingRows = slotRows.filter((row) => row.date > today || (row.date === today && row.time > clock));
  const dayMap = new Map();
  for (const row of upcomingRows) {
    const day = dayMap.get(row.date) || { date: row.date, available: 0, booked: 0 };
    day[row.booked ? 'booked' : 'available'] += 1; dayMap.set(row.date, day);
  }
  return { month, published, totalSlots, bookedSlots, availableSlots: totalSlots - bookedSlots, fillPercent: totalSlots ? Math.round(bookedSlots * 100 / totalSlots) : 0, days: [...dayMap.values()], slots: upcomingRows.filter((row) => !row.booked).map((row) => ({ id: row.id, date: row.date, time: row.time, label: displayTime(row.time) })) };
}
app.get('/api/availability/summary', asyncRoute(async (req, res) => {
  const month = String(req.query.month || '');
  if (!monthStart(month)) return res.status(400).json({ error: 'Choose a valid month.' });
  if (!DEFAULT_CONFIG.features?.scheduling) return res.json({ month, published: false, totalSlots: 0, bookedSlots: 0, availableSlots: 0, fillPercent: 0 });
  const data = await availabilityForMonth(month);
  const { month: shownMonth, published, totalSlots, bookedSlots, availableSlots, fillPercent } = data;
  res.json({ month: shownMonth, published, totalSlots, bookedSlots, availableSlots, fillPercent });
}));
app.get('/api/availability', asyncRoute(async (req, res) => {
  const date = String(req.query.date || '');
  const month = String(req.query.month || (date ? date.slice(0, 7) : localToday().slice(0, 7)));
  if (!monthStart(month)) return res.status(400).json({ error: 'Choose a valid month.' });
  if (date && (!validDate(date) || date < localToday() || date.slice(0, 7) !== month)) return res.status(400).json({ error: 'Choose a valid future date in the selected month.' });
  if (!DEFAULT_CONFIG.features?.scheduling) return res.json({ month, published: false, slots: [], days: [], totalSlots: 0, bookedSlots: 0, availableSlots: 0, fillPercent: 0 });
  res.json(await availabilityForMonth(month, date));
}));
function displayTime(value) {
  const [hour, minute] = value.split(':').map(Number); const suffix = hour >= 12 ? 'pm' : 'am'; const shown = hour % 12 || 12;
  return `${shown}:${String(minute).padStart(2, '0')} ${suffix}`;
}
app.get('/api/admin/availability', adminGuard, asyncRoute(async (req, res) => {
  if (!DEFAULT_CONFIG.features?.scheduling) return res.status(404).json({ error: 'Online appointments are not enabled.' });
  const month = String(req.query.month || ''); const start = monthStart(month);
  if (!start) return res.status(400).json({ error: 'Choose a valid month.' });
  const sql = getDb();
  const schedules = await sql`SELECT weekly_rules AS "weeklyRules", exceptions, status, published_at AS "publishedAt" FROM monthly_schedules WHERE site_id = ${SITE_ID} AND month_start = ${start}::date LIMIT 1`;
  const metrics = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM appointments AS appointment WHERE appointment.site_id = slot.site_id AND appointment.appointment_date = slot.slot_date AND appointment.appointment_time = slot.slot_time AND appointment.status <> 'cancelled'))::int AS booked FROM consultation_slots AS slot WHERE slot.site_id = ${SITE_ID} AND slot.month_start = ${start}::date AND slot.is_open = true`;
  const schedule = schedules[0] || { weeklyRules: Array.from({ length: 7 }, (_unused, weekday) => ({ weekday, enabled: false, startTime: '09:00', endTime: '17:00' })), exceptions: [], status: 'unpublished' };
  res.json({ month, deadline: monthDeadline(month), locked: !schedules.length && localToday() > monthDeadline(month), schedule, totalSlots: Number(metrics[0]?.total || 0), bookedSlots: Number(metrics[0]?.booked || 0) });
}));
app.put('/api/admin/availability/:month', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  if (!DEFAULT_CONFIG.features?.scheduling) return res.status(404).json({ error: 'Online appointments are not enabled.' });
  const month = String(req.params.month || ''); const start = monthStart(month);
  if (!start || month < localToday().slice(0, 7)) return res.status(400).json({ error: 'Choose the current or a future month.' });
  const schedule = cleanMonthlySchedule(req.body || {}, month);
  const slots = schedule && buildMonthlySlots(schedule);
  if (!schedule || !slots) return res.status(400).json({ error: 'Check the seven weekly-hour rows and date exceptions. Use 30-minute start/end times and no more than 1,000 slots.' });
  const sql = getDb();
  const existing = await sql`SELECT status FROM monthly_schedules WHERE site_id = ${SITE_ID} AND month_start = ${start}::date LIMIT 1`;
  const deadline = monthDeadline(month);
  if (!existing.length && localToday() > deadline) return res.status(409).json({ error: `This month’s schedule deadline was ${deadline}. A missing schedule stays unavailable.` });
  const slotJson = JSON.stringify(slots.map((slot) => ({ slot_date: slot.slotDate, slot_time: slot.slotTime })));
  const conflicts = await sql`SELECT appointment.id FROM appointments AS appointment WHERE appointment.site_id = ${SITE_ID} AND appointment.appointment_date >= ${start}::date AND appointment.appointment_date < (${start}::date + interval '1 month')::date AND appointment.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${slotJson}::jsonb) AS proposed(slot_date date, slot_time time) WHERE proposed.slot_date = appointment.appointment_date AND proposed.slot_time = appointment.appointment_time) LIMIT 1`;
  if (conflicts.length) return res.status(409).json({ error: 'This change would remove a reserved appointment time. Keep it in the schedule or cancel the appointment first.' });
  try {
    const saved = await sql`
      WITH saved AS (
        INSERT INTO monthly_schedules (site_id, month_start, weekly_rules, exceptions, status, published_at)
        VALUES (${SITE_ID}, ${start}::date, ${JSON.stringify(schedule.weeklyRules)}::jsonb, ${JSON.stringify(schedule.exceptions)}::jsonb, 'published', now())
        ON CONFLICT (site_id, month_start) DO UPDATE SET weekly_rules = EXCLUDED.weekly_rules, exceptions = EXCLUDED.exceptions, status = 'published', published_at = now(), updated_at = now()
        RETURNING site_id, month_start
      ), removed AS (
        DELETE FROM consultation_slots AS slot USING saved
        WHERE slot.site_id = saved.site_id AND slot.month_start = saved.month_start
          AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${slotJson}::jsonb) AS proposed(slot_date date, slot_time time) WHERE proposed.slot_date = slot.slot_date AND proposed.slot_time = slot.slot_time)
        RETURNING slot.id
      ), added AS (
        INSERT INTO consultation_slots (site_id, month_start, slot_date, slot_time, is_open)
        SELECT saved.site_id, saved.month_start, proposed.slot_date, proposed.slot_time, true
        FROM saved CROSS JOIN jsonb_to_recordset(${slotJson}::jsonb) AS proposed(slot_date date, slot_time time)
        ON CONFLICT (site_id, slot_date, slot_time) DO UPDATE SET month_start = EXCLUDED.month_start, is_open = true, updated_at = now()
        RETURNING id
      )
      SELECT saved.month_start FROM saved`;
    if (!saved.length) return res.status(500).json({ error: 'The schedule could not be published.' });
    const availability = await availabilityForMonth(month);
    res.json({ schedule: { ...schedule, status: 'published', publishedAt: new Date().toISOString() }, deadline, totalSlots: availability.totalSlots, bookedSlots: availability.bookedSlots });
  } catch (error) {
    if (error.code === '23505' || error.code === '23503') return res.status(409).json({ error: 'The schedule conflicts with a reserved appointment. Refresh and try again.' });
    throw error;
  }
}));
app.post('/api/appointments', csrfGuard, asyncRoute(async (req, res) => {
  if (!DEFAULT_CONFIG.features?.scheduling) return res.status(404).json({ error: 'Online appointments are not enabled.' });
  const client = await currentClient(req);
  if (!client) return res.status(401).json({ error: 'Sign in or create a client account to reserve a consultation.' });
  const value = req.body || {};
  const slotId = String(value.slotId || ''); const service = cleanText(value.service, 120); const context = cleanText(value.context, 100);
  const paymentMethod = ['gcash', 'maya'].includes(value.paymentMethod) ? value.paymentMethod : '';
  if (!/^[0-9a-f-]{36}$/i.test(slotId) || !DEFAULT_CONFIG.services.includes(service) || !paymentMethod) return res.status(400).json({ error: 'Choose a valid open time, visit type and GCash or Maya payment method.' });
  try {
    const sql = getDb();
    const rows = await sql`INSERT INTO appointments (site_id, client_account_id, availability_slot_id, name, email, phone, service, appointment_date, appointment_time, context, status, payment_method, payment_status, payment_due_at) SELECT ${SITE_ID}, ${client.id}, slot.id, ${client.name}, ${client.email}, ${client.phone}, ${service}, slot.slot_date, slot.slot_time, ${context}, 'confirmed', ${paymentMethod}, 'awaiting_proof', now() + interval '15 minutes' FROM consultation_slots AS slot JOIN monthly_schedules AS schedule ON schedule.site_id = slot.site_id AND schedule.month_start = slot.month_start WHERE slot.site_id = ${SITE_ID} AND slot.id = ${slotId}::uuid AND slot.is_open = true AND schedule.status = 'published' AND slot.slot_date >= ${localToday()}::date AND (slot.slot_date + slot.slot_time) AT TIME ZONE ${siteTimeZone} > now() AND NOT EXISTS (SELECT 1 FROM appointments AS existing WHERE existing.site_id = slot.site_id AND existing.appointment_date = slot.slot_date AND existing.appointment_time = slot.slot_time AND existing.status <> 'cancelled') RETURNING id, appointment_date::text AS date, to_char(appointment_time, 'HH24:MI') AS time, payment_due_at AS "paymentDueAt"`;
    if (!rows.length) return res.status(409).json({ error: 'That time was just taken or is no longer available. Refresh the calendar and choose another.' });
    res.status(201).json({ ok: true, appointment: { ...rows[0], timeLabel: displayTime(rows[0].time), status: 'confirmed', paymentStatus: 'awaiting_proof', paymentMethod } });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That time was just taken. Refresh the calendar and choose another.' });
    console.error('appointment reservation failed', error);
    res.status(503).json({ error: 'We could not reserve this consultation. Please try again.' });
  }
}));
app.get('/api/client/appointments', asyncRoute(async (req, res) => {
  const client = await currentClient(req);
  if (!client) return res.status(401).json({ error: 'Sign in to view your consultations.' });
  const sql = getDb();
  const rows = await sql`SELECT appointment.id, appointment.name, appointment.email, appointment.phone, appointment.service, appointment.context, appointment.status, appointment.payment_status AS "paymentStatus", appointment.payment_method AS "paymentMethod", appointment.payment_due_at AS "paymentDueAt", appointment.payment_reminder_sent_at AS "paymentReminderSentAt", appointment.payment_owner_attention_at AS "paymentOwnerAttentionAt", appointment.payment_manual_received_at AS "paymentManualReceivedAt", appointment.created_at AS "createdAt", proof.id AS "paymentProofId", proof.review_status AS "paymentProofStatus", proof.uploaded_at AS "paymentProofUploadedAt", appointment.appointment_date::text AS date, to_char(appointment.appointment_time, 'HH24:MI') AS time, note.note_body AS "noteBody", note.updated_at AS "noteUpdatedAt" FROM appointments AS appointment LEFT JOIN appointment_payment_proofs AS proof ON proof.site_id = appointment.site_id AND proof.appointment_id = appointment.id AND proof.client_account_id = appointment.client_account_id LEFT JOIN consultation_notes AS note ON note.site_id = appointment.site_id AND note.appointment_id = appointment.id AND note.client_account_id = appointment.client_account_id WHERE appointment.site_id = ${SITE_ID} AND appointment.client_account_id = ${client.id} ORDER BY appointment.appointment_date DESC, appointment.appointment_time DESC LIMIT 200`;
  res.json({ appointments: rows.map((row) => ({ ...row, timeLabel: displayTime(row.time) })) });
}));
app.post('/api/client/appointments/:id/payment-proof', csrfGuard, express.raw({ type: PAYMENT_PROOF_MIME_TYPES, limit: MAX_PAYMENT_PROOF_BYTES }), asyncRoute(async (req, res) => {
  if (!DEFAULT_CONFIG.features?.scheduling) return res.status(404).json({ error: 'Online appointments are not enabled.' });
  const client = await currentClient(req);
  if (!client) return res.status(401).json({ error: 'Sign in to upload payment proof.' });
  const id = String(req.params.id || '');
  const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = Buffer.isBuffer(req.body) ? req.body : null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid appointment id.' });
  if (!PAYMENT_PROOF_MIME_TYPES.includes(contentType) || !bytes?.length) return res.status(415).json({ error: 'Upload a PNG, JPEG or WebP payment screenshot.' });
  if (bytes.length > MAX_PAYMENT_PROOF_BYTES) return res.status(413).json({ error: 'Payment screenshots must be 3 MB or smaller.' });
  const detectedType = detectPaymentProofMime(bytes);
  if (detectedType !== contentType) return res.status(400).json({ error: 'The uploaded image format does not match its file type.' });
  const sql = getDb();
  try {
    const imageBase64 = paymentProofToBase64(bytes);
    const rows = await sql`
      WITH target AS (
        SELECT appointment.id, appointment.client_account_id, appointment.payment_method, appointment.payment_status
        FROM appointments AS appointment
        WHERE appointment.site_id = ${SITE_ID} AND appointment.id = ${id}::uuid
          AND appointment.client_account_id = ${client.id} AND appointment.status <> 'cancelled'
          AND (
            appointment.payment_status = 'awaiting_proof'
            OR (appointment.payment_status = 'approved' AND appointment.payment_manual_received_at IS NOT NULL)
          )
          AND NOT EXISTS (
            SELECT 1 FROM appointment_payment_proofs AS existing_proof
            WHERE existing_proof.site_id = appointment.site_id AND existing_proof.appointment_id = appointment.id
          )
        FOR UPDATE
      ), saved AS (
        INSERT INTO appointment_payment_proofs (site_id, appointment_id, client_account_id, payment_method, image_mime_type, image_base64, review_status)
        SELECT ${SITE_ID}, target.id, target.client_account_id, target.payment_method, ${contentType}, ${imageBase64}, CASE WHEN target.payment_status = 'approved' THEN 'approved' ELSE 'pending_review' END
        FROM target
        RETURNING id, appointment_id, uploaded_at, review_status AS status
      ), updated AS (
        UPDATE appointments AS appointment SET payment_status = CASE WHEN appointment.payment_status = 'awaiting_proof' THEN 'pending_review' ELSE appointment.payment_status END
        FROM saved WHERE appointment.site_id = ${SITE_ID} AND appointment.id = saved.appointment_id
        RETURNING appointment.id
      )
      SELECT saved.id, saved.uploaded_at, saved.status FROM saved JOIN updated ON updated.id = saved.appointment_id LIMIT 1`;
    if (!rows.length) {
      const appointment = await sql`SELECT status, payment_status AS "paymentStatus" FROM appointments WHERE site_id = ${SITE_ID} AND id = ${id}::uuid AND client_account_id = ${client.id} LIMIT 1`;
      if (!appointment.length) return res.status(404).json({ error: 'That consultation was not found.' });
      if (appointment[0].status === 'cancelled') return res.status(409).json({ error: 'The practice has released this booking. Contact the practice if you already sent payment.' });
      return res.status(409).json({ error: 'Payment proof was already uploaded or this consultation is no longer awaiting proof.' });
    }
    res.status(201).json({ proof: { id: rows[0].id, status: rows[0].status, uploadedAt: rows[0].uploaded_at } });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Payment proof has already been uploaded for this consultation.' });
    console.error('payment proof upload failed', error);
    res.status(503).json({ error: 'Could not save payment proof. Please try again while the booking is active.' });
  }
}));
app.patch('/api/client/appointments/:id', csrfGuard, asyncRoute(async (req, res) => {
  const client = await currentClient(req); const id = String(req.params.id || '');
  if (!client) return res.status(401).json({ error: 'Sign in to manage your consultations.' });
  if (!/^[0-9a-f-]{36}$/i.test(id) || req.body?.status !== 'cancelled') return res.status(400).json({ error: 'Invalid appointment update.' });
  const sql = getDb();
  const rows = await sql`UPDATE appointments SET status = 'cancelled' WHERE site_id = ${SITE_ID} AND id = ${id}::uuid AND client_account_id = ${client.id} AND status <> 'cancelled' RETURNING id, status`;
  if (!rows.length) return res.status(404).json({ error: 'That consultation was not found or was already cancelled.' });
  res.json({ appointment: rows[0] });
}));
app.get('/api/admin/posts', adminGuard, asyncRoute(async (_req, res) => {
  const sql = getDb();
  const rows = await sql`SELECT post.id, post.title, post.slug, post.excerpt, post.body, post.category, post.feature_image_url AS "featureImageUrl", post.feature_image_alt AS "featureImageAlt", post.status, post.published_at AS "publishedAt", post.created_at AS "createdAt", COALESCE((SELECT json_agg(json_build_object('id', image.id, 'imageUrl', image.image_url, 'altText', image.alt_text, 'caption', image.caption, 'sortOrder', image.sort_order) ORDER BY image.sort_order) FROM blog_post_images AS image WHERE image.site_id = post.site_id AND image.post_id = post.id), '[]'::json) AS gallery FROM blog_posts AS post WHERE post.site_id = ${SITE_ID} ORDER BY post.created_at DESC LIMIT 100`;
  res.json({ posts: rows });
}));
app.post('/api/admin/posts', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const post = articlePostPayload(req.body || {});
  if (!post) return res.status(400).json({ error: 'Add a title and article body, plus a valid feature image. If you leave the feature image blank, add a gallery image with a URL and alt text.' });
  try {
    const sql = getDb();
    const rows = await persistArticle(sql, post);
    res.status(201).json({ post: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That URL slug is already in use or gallery order is duplicated.' });
    throw error;
  }
}));
app.put('/api/admin/posts/:id', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid post id.' });
  const post = articlePostPayload(req.body || {});
  if (!post) return res.status(400).json({ error: 'Add a title and article body, plus a valid feature image. If you leave the feature image blank, add a gallery image with a URL and alt text.' });
  try {
    const sql = getDb();
    const rows = await persistArticle(sql, post, id);
    if (!rows.length) return res.status(404).json({ error: 'That post was not found.' });
    res.json({ post: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That URL slug is already in use or gallery order is duplicated.' });
    throw error;
  }
}));
app.delete('/api/admin/posts/:id', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid post id.' });
  const sql = getDb();
  const rows = await sql`DELETE FROM blog_posts WHERE site_id = ${SITE_ID} AND id = ${id}::uuid RETURNING id`;
  if (!rows.length) return res.status(404).json({ error: 'That post was not found.' });
  res.json({ ok: true });
}));
app.get('/api/admin/gallery', adminGuard, asyncRoute(async (_req, res) => {
  const sql = getDb();
  const rows = await sql`SELECT id, title, image_url AS "imageUrl", alt_text AS "altText", caption, category, status, sort_order AS "sortOrder", created_at AS "createdAt" FROM gallery_items WHERE site_id = ${SITE_ID} ORDER BY sort_order ASC, created_at DESC LIMIT 100`;
  res.json({ items: rows });
}));
app.post('/api/admin/gallery', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const item = galleryPayload(req.body || {});
  if (!validGalleryPayload(item)) return res.status(400).json({ error: 'Add a title, valid HTTPS or same-site image URL and alternative text. Display order must be from 0 to 9999.' });
  const sql = getDb();
  const rows = await sql`INSERT INTO gallery_items (site_id, title, image_url, alt_text, caption, category, status, sort_order) VALUES (${SITE_ID}, ${item.title}, ${item.imageUrl}, ${item.altText}, ${item.caption}, ${item.category}, ${item.status}, ${item.sortOrder}) RETURNING id, title, image_url AS "imageUrl", alt_text AS "altText", caption, category, status, sort_order AS "sortOrder", created_at AS "createdAt"`;
  res.status(201).json({ item: rows[0] });
}));
app.put('/api/admin/gallery/:id', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid gallery item id.' });
  const item = galleryPayload(req.body || {});
  if (!validGalleryPayload(item)) return res.status(400).json({ error: 'Add a title, valid HTTPS or same-site image URL and alternative text. Display order must be from 0 to 9999.' });
  const sql = getDb();
  const rows = await sql`UPDATE gallery_items SET title = ${item.title}, image_url = ${item.imageUrl}, alt_text = ${item.altText}, caption = ${item.caption}, category = ${item.category}, status = ${item.status}, sort_order = ${item.sortOrder}, updated_at = now() WHERE site_id = ${SITE_ID} AND id = ${id}::uuid RETURNING id, title, image_url AS "imageUrl", alt_text AS "altText", caption, category, status, sort_order AS "sortOrder", created_at AS "createdAt"`;
  if (!rows.length) return res.status(404).json({ error: 'That gallery item was not found.' });
  res.json({ item: rows[0] });
}));
app.delete('/api/admin/gallery/:id', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid gallery item id.' });
  const sql = getDb();
  const rows = await sql`DELETE FROM gallery_items WHERE site_id = ${SITE_ID} AND id = ${id}::uuid RETURNING id`;
  if (!rows.length) return res.status(404).json({ error: 'That gallery item was not found.' });
  res.json({ ok: true });
}));
app.get('/api/admin/appointments', adminGuard, asyncRoute(async (_req, res) => {
  const sql = getDb();
  const rows = await sql`SELECT appointment.id, appointment.name, appointment.email, appointment.phone, appointment.service, appointment.context, appointment.status, appointment.appointment_date::text AS date, to_char(appointment.appointment_time, 'HH24:MI') AS time, client.id AS "clientId", note.note_body AS "noteBody", note.updated_at AS "noteUpdatedAt" FROM appointments AS appointment LEFT JOIN client_accounts AS client ON client.id = appointment.client_account_id AND client.site_id = appointment.site_id LEFT JOIN consultation_notes AS note ON note.site_id = appointment.site_id AND note.appointment_id = appointment.id WHERE appointment.site_id = ${SITE_ID} AND appointment.appointment_date >= (${localToday()}::date - interval '90 days')::date AND appointment.appointment_date <= (${localToday()}::date + interval '90 days')::date ORDER BY appointment.appointment_date ASC, appointment.appointment_time ASC LIMIT 300`;
  res.json({ appointments: rows.map((row) => ({ ...row, timeLabel: displayTime(row.time) })) });
}));
app.get('/api/admin/payments/unpaid', adminGuard, asyncRoute(async (_req, res) => {
  const sql = getDb();
  const rows = await sql`SELECT appointment.id, appointment.name, client.full_name AS "clientName", COALESCE(client.email, appointment.email) AS username, appointment.service, appointment.payment_method AS "paymentMethod", appointment.payment_due_at AS "paymentDueAt", appointment.payment_reminder_sent_at AS "paymentReminderSentAt", appointment.payment_owner_attention_at AS "paymentOwnerAttentionAt", appointment.created_at AS "createdAt", appointment.appointment_date::text AS date, to_char(appointment.appointment_time, 'HH24:MI') AS time FROM appointments AS appointment LEFT JOIN client_accounts AS client ON client.id = appointment.client_account_id AND client.site_id = appointment.site_id WHERE appointment.site_id = ${SITE_ID} AND appointment.status <> 'cancelled' AND appointment.payment_status = 'awaiting_proof' AND NOT EXISTS (SELECT 1 FROM appointment_payment_proofs AS proof WHERE proof.site_id = appointment.site_id AND proof.appointment_id = appointment.id) ORDER BY appointment.created_at ASC LIMIT 300`;
  res.json({ bookings: rows.map((row) => ({ ...row, timeLabel: displayTime(row.time) })) });
}));
app.patch('/api/admin/payments/unpaid/:id', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || ''); const action = String(req.body?.action || '');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['received', 'release'].includes(action)) return res.status(400).json({ error: 'Choose whether payment was received or the booking should be released.' });
  const sql = getDb();
  const rows = action === 'received'
    ? await sql`UPDATE appointments AS appointment SET payment_status = 'approved', payment_manual_received_at = now() WHERE appointment.site_id = ${SITE_ID} AND appointment.id = ${id}::uuid AND appointment.status <> 'cancelled' AND appointment.payment_status = 'awaiting_proof' AND NOT EXISTS (SELECT 1 FROM appointment_payment_proofs AS proof WHERE proof.site_id = appointment.site_id AND proof.appointment_id = appointment.id) RETURNING appointment.id, appointment.status, appointment.payment_status AS "paymentStatus"`
    : await sql`UPDATE appointments AS appointment SET status = 'cancelled' WHERE appointment.site_id = ${SITE_ID} AND appointment.id = ${id}::uuid AND appointment.status <> 'cancelled' AND appointment.payment_status = 'awaiting_proof' AND NOT EXISTS (SELECT 1 FROM appointment_payment_proofs AS proof WHERE proof.site_id = appointment.site_id AND proof.appointment_id = appointment.id) RETURNING appointment.id, appointment.status, appointment.payment_status AS "paymentStatus"`;
  if (!rows.length) return res.status(409).json({ error: 'This booking is no longer awaiting payment proof. Refresh the payment list.' });
  res.json({ appointment: rows[0], slotReleased: action === 'release' });
}));
app.get('/api/admin/payments', adminGuard, asyncRoute(async (_req, res) => {
  const sql = getDb();
  const rows = await sql`SELECT proof.id, proof.payment_method AS "paymentMethod", proof.review_status AS status, proof.uploaded_at AS "uploadedAt", appointment.id AS "appointmentId", appointment.name, appointment.service, appointment.status AS "appointmentStatus", appointment.payment_status AS "appointmentPaymentStatus", appointment.appointment_date::text AS date, to_char(appointment.appointment_time, 'HH24:MI') AS time, appointment.created_at AS "bookedAt", client.full_name AS "clientName", COALESCE(client.email, appointment.email) AS username FROM appointment_payment_proofs AS proof JOIN appointments AS appointment ON appointment.id = proof.appointment_id AND appointment.site_id = proof.site_id LEFT JOIN client_accounts AS client ON client.id = appointment.client_account_id AND client.site_id = appointment.site_id WHERE proof.site_id = ${SITE_ID} ORDER BY proof.uploaded_at DESC LIMIT 300`;
  res.json({ payments: rows.map((row) => ({ ...row, timeLabel: displayTime(row.time) })) });
}));
app.get('/api/internal/payment-sweeps', asyncRoute(async (req, res) => {
  const secret = String(process.env.CRON_SECRET || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(String(req.get('authorization') || ''));
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Scheduled payment check is not authorized.' });
  try {
    const result = await runPaymentReminderChecks(getDb(), SITE_ID);
    res.json({ ok: true, reminders: result.reminders.length, ownerFollowups: result.ownerFollowups.length });
  } catch (error) { console.error('payment reminder schedule failed', error); res.status(503).json({ error: 'Could not check pending payment bookings.' }); }
}));
app.get('/api/admin/payment-proofs/:id/image', adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid payment proof id.' });
  const sql = getDb();
  const rows = await sql`SELECT image_mime_type AS "mimeType", image_base64 AS image FROM appointment_payment_proofs WHERE site_id = ${SITE_ID} AND id = ${id}::uuid LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'Payment proof not found.' });
  const mimeType = PAYMENT_PROOF_MIME_TYPES.includes(rows[0].mimeType) ? rows[0].mimeType : 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', 'inline; filename="payment-proof"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).end(Buffer.from(paymentProofFromBase64(rows[0].image)));
}));
app.patch('/api/admin/payment-proofs/:id', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || ''); const decision = String(req.body?.status || '');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Choose whether to approve or reject this payment proof.' });
  const sql = getDb();
  const rows = decision === 'approved'
    ? await sql`WITH reviewed AS (UPDATE appointment_payment_proofs AS proof SET review_status = 'approved', reviewed_at = now() FROM appointments AS appointment WHERE proof.site_id = ${SITE_ID} AND proof.id = ${id}::uuid AND proof.review_status = 'pending_review' AND appointment.site_id = proof.site_id AND appointment.id = proof.appointment_id AND appointment.status <> 'cancelled' RETURNING proof.id, proof.appointment_id), saved AS (UPDATE appointments AS appointment SET payment_status = 'approved' FROM reviewed WHERE appointment.site_id = ${SITE_ID} AND appointment.id = reviewed.appointment_id RETURNING appointment.id) SELECT reviewed.id FROM reviewed JOIN saved ON saved.id = reviewed.appointment_id`
    : await sql`WITH reviewed AS (UPDATE appointment_payment_proofs AS proof SET review_status = 'rejected', reviewed_at = now() FROM appointments AS appointment WHERE proof.site_id = ${SITE_ID} AND proof.id = ${id}::uuid AND proof.review_status = 'pending_review' AND appointment.site_id = proof.site_id AND appointment.id = proof.appointment_id AND appointment.status <> 'cancelled' RETURNING proof.id, proof.appointment_id), released AS (UPDATE appointments AS appointment SET payment_status = 'rejected', status = 'cancelled' FROM reviewed WHERE appointment.site_id = ${SITE_ID} AND appointment.id = reviewed.appointment_id RETURNING appointment.id) SELECT reviewed.id FROM reviewed JOIN released ON released.id = reviewed.appointment_id`;
  if (!rows.length) return res.status(409).json({ error: 'This payment proof was already reviewed or the consultation is no longer active.' });
  res.json({ proof: { id: rows[0].id, status: decision }, slotReleased: decision === 'rejected' });
}));
app.patch('/api/admin/appointments/:id', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  const status = String(req.body?.status || '');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['requested', 'confirmed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid appointment update.' });
  const sql = getDb();
  if (status === 'cancelled') {
    const rows = await sql`UPDATE appointments SET status = 'cancelled' WHERE site_id = ${SITE_ID} AND id = ${id}::uuid AND (appointment_date + appointment_time) AT TIME ZONE ${siteTimeZone} > now() + interval '24 hours' RETURNING id, status`;
    if (!rows.length) {
      const exists = await sql`SELECT id FROM appointments WHERE site_id = ${SITE_ID} AND id = ${id}::uuid LIMIT 1`;
      return exists.length ? res.status(409).json({ error: 'Owner cancellations must be made at least 24 hours before the appointment.' }) : res.status(404).json({ error: 'That appointment was not found.' });
    }
    return res.json({ appointment: rows[0] });
  }
  const rows = await sql`UPDATE appointments SET status = ${status} WHERE site_id = ${SITE_ID} AND id = ${id}::uuid RETURNING id, status`;
  if (!rows.length) return res.status(404).json({ error: 'That appointment was not found.' });
  res.json({ appointment: rows[0] });
}));
app.put('/api/admin/appointments/:id/note', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const id = String(req.params.id || ''); const noteBody = cleanText(req.body?.noteBody, 12000);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid appointment id.' });
  const sql = getDb();
  if (!noteBody) {
    await sql`DELETE FROM consultation_notes WHERE site_id = ${SITE_ID} AND appointment_id = ${id}::uuid`;
    return res.json({ note: null });
  }
  const rows = await sql`INSERT INTO consultation_notes (site_id, appointment_id, client_account_id, note_body) SELECT ${SITE_ID}, appointment.id, appointment.client_account_id, ${noteBody} FROM appointments AS appointment WHERE appointment.site_id = ${SITE_ID} AND appointment.id = ${id}::uuid AND appointment.client_account_id IS NOT NULL ON CONFLICT (site_id, appointment_id) DO UPDATE SET client_account_id = EXCLUDED.client_account_id, note_body = EXCLUDED.note_body, updated_at = now() RETURNING note_body AS "noteBody", updated_at AS "noteUpdatedAt"`;
  if (!rows.length) return res.status(400).json({ error: 'This older appointment has no linked client account, so it cannot receive a private account note.' });
  res.json({ note: rows[0] });
}));
app.put('/api/site', csrfGuard, adminGuard, asyncRoute(async (req, res) => {
  const config = cleanSiteConfig(req.body || {});
  if (!config.businessName || (config.email && !/^\S+@\S+\.\S+$/.test(config.email))) return res.status(400).json({ error: 'Check the practice name and contact email.' });
  const sql = getDb();
  const rows = await sql`INSERT INTO sites (site_id, config) VALUES (${SITE_ID}, ${JSON.stringify(config)}::jsonb) ON CONFLICT (site_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now() RETURNING config`;
  res.json({ config: rows[0].config });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Payment screenshots must be 3 MB or smaller.' });
  console.error('API error', error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

export default app;
