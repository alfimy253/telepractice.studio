import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adminDashboardPath, isAdminDashboardPath } from '../public/_scaffold/templates/shared/lib/admin-url.js';
import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  createPasswordHash,
  verifyAdminSession,
  verifyPasswordHash
} from '../public/_scaffold/templates/shared/lib/admin-security.js';
import { cleanMenuLinks, cleanMenuHref, DEFAULT_MENU_LINKS, MAX_MENU_LINKS, menuLinksForPages } from '../public/_scaffold/templates/shared/lib/menu-links.js';
import { normalizeAdminAccount, normalizeConfig } from '../src/generator.js';

const validAccount = {
  adminUsername: 'practiceowner',
  adminEmail: 'owner@example.test',
  adminPassword: 'CanopyOwner!8'
};
const templateRoot = new URL('../public/_scaffold/templates/', import.meta.url);

test('admin dashboard path uses the Monday-first animal sequence and calendar date', () => {
  const mondayFirstDates = Array.from({ length: 7 }, (_unused, index) => new Date(Date.UTC(2026, 4, 4 + index, 12)));
  const expectedPrefixes = ['g', 't', 't', 'h', 'y', 't', 'h'];
  mondayFirstDates.forEach((date, index) => {
    assert.equal(adminDashboardPath(date, 'UTC'), `/${expectedPrefixes[index]}admin${4 + index}/dashboard`);
  });
  assert.equal(adminDashboardPath(new Date('2024-10-08T12:00:00.000Z'), 'UTC'), '/tadmin8/dashboard');
});

test('admin dashboard path follows the configured site time zone, not the runtime UTC date', () => {
  const justAfterUtcMidnight = new Date('2026-10-07T00:30:00.000Z');
  assert.equal(adminDashboardPath(justAfterUtcMidnight, 'America/Los_Angeles'), '/tadmin6/dashboard');
});

test('admin dashboard path recognizer accepts only a valid day number and dashboard suffix', () => {
  for (const path of ['/gadmin1/dashboard', '/tadmin8/dashboard', '/hadmin31/dashboard']) {
    assert.equal(isAdminDashboardPath(path), true);
  }
  for (const path of ['/admin.html', '/tadmin0/dashboard', '/tadmin32/dashboard', '/tadmin8', '/tadmin8/posts']) {
    assert.equal(isAdminDashboardPath(path), false);
  }
});

test('generated owner path is absent from public entry points and only returned to authenticated sessions', async () => {
  const [appointmentsHtml, vercelRuntime, cloudflareRuntime, vercelConfig, cloudflareAdminUi] = await Promise.all([
    readFile(new URL('shared/public/appointments.html', templateRoot), 'utf8'),
    readFile(new URL('vercel/api/index.js', templateRoot), 'utf8'),
    readFile(new URL('cloudflare/src/index.js', templateRoot), 'utf8'),
    readFile(new URL('vercel/vercel.json', templateRoot), 'utf8'),
    readFile(new URL('shared/public/admin.js', templateRoot), 'utf8')
  ]);
  assert.doesNotMatch(appointmentsHtml, /Owner area|api\/admin\/entry|admin\.html/);
  assert.doesNotMatch(vercelRuntime, /app\.get\(['"]\/api\/admin\/entry/);
  assert.doesNotMatch(cloudflareRuntime, /path === ['"]\/api\/admin\/entry/);
  assert.match(vercelRuntime, /\.\.\.\(authenticated \? \{ dashboardPath: adminDashboardPath/);
  assert.match(cloudflareRuntime, /\.\.\.\(authenticated \? \{ dashboardPath: adminDashboardPath/);
  assert.match(cloudflareRuntime, /if \(!await adminOk\(request, env\)\) return error\('Not found\.', 404\)/);
  assert.match(vercelConfig, /"source": "\/admin\.html", "destination": "\/"/);
  assert.match(cloudflareAdminUi, /if \(!session\.authenticated \|\| !session\.dashboardPath/);
  assert.match(cloudflareAdminUi, /followDashboardPath\(session\)/);
});

test('menu-link normalization keeps safe destinations, caps list size and skips unsafe or duplicate links', () => {
  const links = cleanMenuLinks([
    { id: 'home', label: 'Home', href: '/#home', feature: 'gallery' },
    { id: 'external', label: 'External', href: 'https://example.test/about' },
    { id: 'javascript', label: 'Unsafe', href: 'javascript:alert(1)' },
    { id: 'protocol-relative', label: 'Unsafe', href: '//outside.example/path' },
    { id: 'credentials', label: 'Unsafe', href: 'https://owner:secret@example.test/path' },
    { id: 'duplicate', label: 'First', href: '/first' },
    { id: 'duplicate', label: 'Second', href: '/second' }
  ], []);
  assert.deepEqual(links, [
    { id: 'home', label: 'Home', href: '/#home', feature: 'gallery' },
    { id: 'external', label: 'External', href: 'https://example.test/about' },
    { id: 'duplicate', label: 'First', href: '/first' }
  ]);
  assert.equal(cleanMenuLinks(Array.from({ length: MAX_MENU_LINKS + 4 }, (_unused, index) => ({ id: `item-${index}`, label: `Link ${index}`, href: `/link-${index}` })), []).length, MAX_MENU_LINKS);
});

test('new site configs include default and generated custom-page menu links', () => {
  assert.equal(DEFAULT_MENU_LINKS.length, 7);
  const config = normalizeConfig({
    target: 'vercel', businessName: 'Canopy Care',
    customPages: [{ id: 'privacy', menuName: 'Privacy', url: '/privacy', pageTitle: 'Privacy policy', pageContent: 'Our privacy policy.' }]
  });
  assert.equal(config.timeZone, 'Asia/Manila');
  assert.equal(config.menuLinks.length, 8);
  assert.deepEqual(config.menuLinks.at(-1), { id: 'custom-privacy', label: 'Privacy', href: '/privacy.html' });
  assert.deepEqual(menuLinksForPages([{ id: 'terms', menuName: 'Terms', url: '/terms.html' }]).at(-1), {
    id: 'custom-terms', label: 'Terms', href: '/terms.html'
  });
});

test('builder validates administrator username, email, and all password requirements', () => {
  assert.deepEqual(normalizeAdminAccount(validAccount), {
    username: validAccount.adminUsername,
    email: validAccount.adminEmail,
    password: validAccount.adminPassword
  });
  for (const adminPassword of [
    'Aa1!',                  // 4 chars — too short
    'Abc1!',                 // 5 chars — too short
    `${'A'.repeat(26)}a1!`,  // 29 chars — too long
    'ABCDEFGHIJ1!',          // 12 chars, no lowercase
    'abcdefghij1!',          // 12 chars, no uppercase
    'Abcdefghij!!',          // 12 chars, no number
    'Abcdefghij12'           // 12 chars, no symbol
  ]) {
    assert.throws(() => normalizeAdminAccount({ ...validAccount, adminPassword }), /administrator password/i);
  }
  assert.throws(() => normalizeAdminAccount({ ...validAccount, adminUsername: 'x' }), /administrator username/i);
  assert.throws(() => normalizeAdminAccount({ ...validAccount, adminEmail: 'not-an-email' }), /administrator email/i);
});

test('generated administrator password hash verifies and session expires or invalidates on credential change', async () => {
  const passwordHash = await createPasswordHash(validAccount.adminPassword);
  assert.match(passwordHash, /^pbkdf2\$210000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPasswordHash(validAccount.adminPassword, passwordHash), true);
  assert.equal(await verifyPasswordHash('WrongPassword!8', passwordHash), false);

  const secret = 'test-session-signing-secret';
  const now = Date.UTC(2026, 9, 8, 12);
  const session = await createAdminSession(validAccount.adminUsername, passwordHash, secret, now);
  assert.equal(await verifyAdminSession(session, validAccount.adminUsername.toUpperCase(), passwordHash, secret, now), true);
  assert.equal(await verifyAdminSession(session, 'someoneelse', passwordHash, secret, now), false);
  assert.equal(await verifyAdminSession(session, validAccount.adminUsername, passwordHash, 'wrong-secret', now), false);
  assert.equal(await verifyAdminSession(session, validAccount.adminUsername, passwordHash, secret, now + ADMIN_SESSION_TTL_SECONDS * 1000), false);
});

test('cleanMenuHref sanitises same-origin paths and https absolute URLs and rejects everything else', () => {
  // Same-origin paths round-trip through the URL parser and lose the
  // protocol + host (server's "https://menu.invalid" base does not leak
  // into the output).
  assert.equal(cleanMenuHref('/about'), '/about');
  assert.equal(cleanMenuHref('/#services'), '/#services');
  assert.equal(cleanMenuHref('/appointments.html?x=1&y=2#hero'), '/appointments.html?x=1&y=2#hero');
  // Protocol-relative and backslash-relative look like cross-origin attempts.
  assert.equal(cleanMenuHref('//evil.com/x'), '');
  assert.equal(cleanMenuHref('/\\evil.com/x'), '');
  // Absolute URLs must be https with no embedded credentials.
  assert.equal(cleanMenuHref('https://partner.example.com/path'), 'https://partner.example.com/path');
  assert.equal(cleanMenuHref('http://partner.example.com/path'), '');
  assert.equal(cleanMenuHref('javascript:alert(1)'), '');
  assert.equal(cleanMenuHref('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(cleanMenuHref('https://user:pass@partner.example.com/'), '');
  assert.equal(cleanMenuHref('https://'), '');
  // Empty, control characters, oversize payloads are dropped.
  assert.equal(cleanMenuHref(''), '');
  assert.equal(cleanMenuHref('   '), '');
  // A control character inside the path (not at the trailing edge) survives
  // the trim and trips the regex. `/about\n` becomes `/about` because trim
  // eats the trailing newline; the embedded null byte stays in the string.
  assert.equal(cleanMenuHref('/about\n'), '/about');
  assert.equal(cleanMenuHref('/about\u0000'), '');
  assert.equal(cleanMenuHref('/' + 'a'.repeat(3000)), '');
  // `null` / `undefined` / numbers coerce to the empty string.
  assert.equal(cleanMenuHref(null), '');
  assert.equal(cleanMenuHref(undefined), '');
  assert.equal(cleanMenuHref(42), '');
});

test('cleanMenuLinks uses cleanMenuHref to drop bad hrefs but keeps well-formed entries', () => {
  const links = cleanMenuLinks([
    { id: 'home', label: 'Home', href: '/#home' },
    { id: 'bad-relative', label: 'Bad relative', href: '//evil.example.com/x' },
    { id: 'bad-js', label: 'JS link', href: 'javascript:alert(1)' },
    { id: 'partner', label: 'Partner', href: 'https://partner.example.com/x' },
    { id: 'no-href', label: 'No href', href: '' }
  ]);
  assert.deepEqual(links.map((link) => link.id), ['home', 'partner']);
});

test('the browser copies of the menu-href sanitizer stay in sync with the server', async () => {
  // The browser files (`site.js`, `admin.js`) are static and cannot import
  // the lib helper. The audit pinned a regression here — make sure the
  // three copies still agree on the cases that matter.
  const siteSource = await readFile(new URL('../public/_scaffold/templates/shared/public/site.js', import.meta.url), 'utf8');
  const adminSource = await readFile(new URL('../public/_scaffold/templates/shared/public/admin.js', import.meta.url), 'utf8');
  // 1) The trimmed, length-bounded, control-char gate must be present.
  const gatePattern = /length > 2048[\s\S]{0,200}\\[\\u0000-\\u001f\\u007f\\]/;
  assert.match(siteSource, gatePattern, 'site.js lost the safeMenuNavigationHref gate');
  assert.match(adminSource, gatePattern, 'admin.js lost the safeMenuDestination gate');
  // 2) The protocol-relative and backslash-relative check must precede the
  //    URL parse so `//evil.com/x` and `/\evil.com/x` are rejected. Match
  //    the start of each branch and the literal `||` between them.
  const relativeCheck = /raw\.startsWith\('\/[\s\S]{0,4}'\)\s*\|\|\s*raw\.startsWith\('\/[\s\S]{0,4}'\)/;
  assert.match(siteSource, relativeCheck, 'site.js lost the protocol-relative guard');
  assert.match(adminSource, relativeCheck, 'admin.js lost the protocol-relative guard');
  // 3) The https absolute-URL guard must require a hostname and forbid
  //    embedded credentials. The three copies differ in return type
  //    (`!== 'https:'` returns ''; `=== 'https:'` returns boolean), so we
  //    match the same four conditions in any order.
  const absoluteCheck = /url\.protocol[\s\S]{0,30}'https:'[\s\S]{0,200}url\.hostname[\s\S]{0,200}url\.username[\s\S]{0,100}url\.password/;
  assert.match(siteSource, absoluteCheck, 'site.js lost the https absolute-URL guard');
  assert.match(adminSource, absoluteCheck, 'admin.js lost the https absolute-URL guard');
});
