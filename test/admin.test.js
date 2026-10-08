import test from 'node:test';
import assert from 'node:assert/strict';
import { adminDashboardPath, isAdminDashboardPath } from '../public/_scaffold/templates/shared/lib/admin-url.js';
import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  createPasswordHash,
  verifyAdminSession,
  verifyPasswordHash
} from '../public/_scaffold/templates/shared/lib/admin-security.js';
import { cleanMenuLinks, DEFAULT_MENU_LINKS, MAX_MENU_LINKS, menuLinksForPages } from '../public/_scaffold/templates/shared/lib/menu-links.js';
import { normalizeAdminAccount, normalizeConfig } from '../src/generator.js';

const validAccount = {
  adminUsername: 'practiceowner',
  adminEmail: 'owner@example.test',
  adminPassword: 'CanopyOwner!8'
};

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
    'Abcdef1!234',
    'ABCDEFGHIJ1!',
    'abcdefghij1!',
    'Abcdefghij!!',
    'Abcdefghij12',
    `${'A'.repeat(126)}a1!`
  ]) {
    assert.throws(() => normalizeAdminAccount({ ...validAccount, adminPassword }), /administrator password/i);
  }
  assert.throws(() => normalizeAdminAccount({ ...validAccount, adminUsername: 'x' }), /administrator username/i);
  assert.throws(() => normalizeAdminAccount({ ...validAccount, adminEmail: 'not-an-email' }), /administrator email/i);
});

test('generated administrator password hash verifies and session expires or invalidates on credential change', async () => {
  const passwordHash = await createPasswordHash(validAccount.adminPassword);
  assert.match(passwordHash, /^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
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
