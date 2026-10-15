// Bug Fix No. 204 — theme, owner login, and guest booking chrome.
//
// Requirements:
//   1. A Brivon Light package must ship (and keep) the light theme, not Dark.
//   2. Owner dashboard sign-in must work, and a wrong username / wrong password
//      must be reported as such.
//   3. Guests see an empty calendar with no booking UI; the welcome "What we do"
//      section sits below it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateBundle } from '../public/package-core.js';
import {
  createPasswordHash,
  ownerLoginError,
  verifyPasswordHash
} from '../public/_scaffold/templates/shared/lib/admin-security.js';
import { normalizeSiteTheme } from '../public/_scaffold/templates/shared/lib/site-theme.js';

const readTemplate = (filename) => readFile(new URL(`../public/_scaffold/templates/${filename}`, import.meta.url), 'utf8');
const adminInput = {
  adminUsername: 'practiceowner',
  adminEmail: 'owner@example.test',
  adminPassword: 'CanopyOwner!8'
};

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
    files.set(name, decoder.decode(bytes.subarray(dataStart, dataEnd)));
    offset = dataEnd;
  }
  return files;
}

async function packageFiles(target, overrides = {}) {
  const { buffer } = await generateBundle({
    target,
    specialty: 'veterinary',
    businessName: 'Bugfix Light Practice',
    theme: 'brivon-light',
    timeZone: 'Asia/Manila',
    features: { blog: true, gallery: true, scheduling: true },
    ...adminInput,
    ...overrides
  }, readTemplate);
  return zipEntries(buffer);
}

function publicFile(files, target, relative) {
  return files.get(target === 'cloudflare' ? `public/${relative}` : relative);
}

function runtimeFile(files, target) {
  return files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
}

test('ownerLoginError names the failing field without leaking a password match', () => {
  assert.equal(ownerLoginError(true, true), '');
  assert.equal(ownerLoginError(false, false), 'The username is incorrect.');
  assert.equal(ownerLoginError(false, true), 'The username is incorrect.');
  assert.equal(ownerLoginError(true, false), 'The password is incorrect.');
});

test('Brivon Light packages keep the light theme in HTML, config, seed and runtime', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const label = `${target} brivon-light`;
    const index = publicFile(files, target, 'index.html');
    assert.match(index, /class="brivon-shell theme-brivon-light"/, `${label}: homepage is not Brivon Light`);
    assert.doesNotMatch(index, /theme-brivon-dark/, `${label}: homepage still carries Brivon Dark`);
    const siteConfig = publicFile(files, target, 'site-config.js');
    assert.match(siteConfig, /"theme":"brivon-light"/, `${label}: site-config.js is not Brivon Light`);
    assert.match(files.get('db/seed.sql'), /"theme":"brivon-light"/, `${label}: seed.sql is not Brivon Light`);
    const appointments = publicFile(files, target, 'appointments.html');
    assert.match(appointments, /class="appointments-page theme-brivon-light guest-calendar-view"/,
      `${label}: appointments page is missing the baked light theme class`);
    const runtime = runtimeFile(files, target);
    assert.match(runtime, /DEFAULT_CONFIG = \{/, `${label}: runtime defaults missing`);
    assert.match(runtime, /"theme":"brivon-light"/, `${label}: compiled DEFAULT_CONFIG is not Brivon Light`);
    assert.match(runtime, /DO UPDATE SET config = EXCLUDED\.config WHERE tele_sites\.updated_at = tele_sites\.created_at/,
      `${label}: untouched seed rows must pick up the rebuilt package theme`);
    assert.doesNotMatch(runtime, /INSERT INTO tele_sites \(site_id, config\) VALUES \([\s\S]*?ON CONFLICT \(site_id\) DO NOTHING/,
      `${label}: the old DO NOTHING seed would keep a previous Brivon Dark row`);
  }
});

test('stored Brivon Dark cannot take over a Brivon Light package family, and Illustration cannot leak in', () => {
  assert.equal(normalizeSiteTheme('brivon-light', 'brivon-light'), 'brivon-light');
  assert.equal(normalizeSiteTheme('brivon-dark', 'brivon-light'), 'brivon-dark');
  assert.equal(normalizeSiteTheme('canopy', 'brivon-light'), 'brivon-light');
  assert.equal(normalizeSiteTheme('unknown', 'brivon-light'), 'brivon-light');
});

test('owner sign-in reports username vs password and reads either session cookie name', async () => {
  const password = adminInput.adminPassword;
  const hash = await createPasswordHash(password);
  assert.equal(await verifyPasswordHash(password, hash), true);
  assert.equal(await verifyPasswordHash('WrongPass!8', hash), false);

  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const runtime = runtimeFile(files, target);
    const label = `${target} owner login`;
    assert.match(runtime, /ownerLoginError/, `${label}: must use the shared field-specific error helper`);
    assert.doesNotMatch(runtime, /Username or password is incorrect/, `${label}: generic credential error is still in place`);
    assert.ok(files.has('lib/admin-security.js'), `${label}: shared admin-security.js missing from the package`);
    assert.match(files.get('lib/admin-security.js'), /The username is incorrect/, `${label}: username error missing from the shared helper`);
    assert.match(files.get('lib/admin-security.js'), /The password is incorrect/, `${label}: password error missing from the shared helper`);
    assert.match(runtime, /__Host-canopy_owner[\s\S]{0,80}canopy_owner/, `${label}: must read both owner cookie names`);
    assert.match(runtime, /authenticated: true/, `${label}: login JSON must include authenticated so the UI can follow today's path`);
    assert.match(runtime, /X-Forwarded-Proto|x-forwarded-proto/, `${label}: HTTPS detection must honour the forwarded proto`);
    assert.match(runtime, /normalizePasswordHash/, `${label}: quoted env hashes must be stripped before verify`);
    assert.match(runtime, /await ensureAdminUser/, `${label}: first live URL must insert the owner row into Neon`);
    assert.match(runtime, /function requestOriginAllowed/, `${label}: CSRF origin must allow the forwarded host`);
    assert.match(runtime, /X-Forwarded-Host|x-forwarded-host/, `${label}: proxy hosts must be trusted for CSRF`);
  }

  const adminHtml = await readFile(new URL('../public/_scaffold/templates/shared/public/admin.html', import.meta.url), 'utf8');
  assert.match(adminHtml, /id="adminUsername"[^>]*maxlength="254"/, 'login username field must accept an email');
  const adminJs = await readFile(new URL('../public/_scaffold/templates/shared/public/admin.js', import.meta.url), 'utf8');
  assert.match(adminJs, /fillOwnerAccount\(\{ username: session\.username/, 'successful login must fill the account panel');
});

test('Vercel env file quotes the PBKDF2 hash so $iterations is not interpolated', async () => {
  const files = await packageFiles('vercel');
  const env = files.get('.env');
  assert.match(env, /^ADMIN_PASSWORD_HASH="pbkdf2\$210000\$/m, 'ADMIN_PASSWORD_HASH must be quoted');
  assert.match(env, /^CSRF_SECRET="/m, 'CSRF_SECRET must be quoted');
  assert.match(env, /^ADMIN_USERNAME="practiceowner"/m, 'ADMIN_USERNAME must be quoted');
});

test('guest appointments view shows What we do and hides booking controls', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const html = publicFile(files, target, 'appointments.html');
    const js = publicFile(files, target, 'appointments.js');
    const css = publicFile(files, target, 'site.css');
    const label = `${target} guest calendar`;
    assert.match(html, /id="guestWhatWeDo"/, `${label}: missing What we do section`);
    assert.match(html, /> What we do</, `${label}: missing What we do eyebrow`);
    assert.match(html, /Focused care\./, `${label}: missing welcome What we do headline`);
    assert.match(html, /id="guestServiceGrid"/, `${label}: missing service grid`);
    assert.match(html, /guest-calendar-view/, `${label}: body is not guest by default`);
    assert.match(html, /data-booking-control/, `${label}: booking controls are not marked`);
    assert.match(html, /id="reservationArea"[^>]*data-booking-control/, `${label}: reservation area must be a booking control`);
    assert.match(js, /function renderEmptyGuestCalendar/, `${label}: guest empty calendar renderer missing`);
    assert.match(js, /function setGuestBookingView/, `${label}: guest/signed-in chrome switch missing`);
    assert.match(js, /if \(!client\) return;/, `${label}: chooseSlot must refuse guests`);
    assert.match(css, /body\.guest-calendar-view \[data-booking-control\]/, `${label}: CSS does not hide booking controls for guests`);
    assert.match(css, /#guestWhatWeDo/, `${label}: CSS does not keep What we do visible for guests`);
  }
});

test('site.js keeps a baked theme class when the API theme is missing', async () => {
  const siteJs = await readFile(new URL('../public/_scaffold/templates/shared/public/site.js', import.meta.url), 'utf8');
  assert.match(siteJs, /themes\.find\(\(name\) => document\.body\.classList\.contains\(`theme-\$\{name\}`\)\)/);
  assert.match(siteJs, /never strip a baked theme class/);
});
