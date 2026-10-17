import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateBundle, slugify as coreSlugify } from '../public/package-core.js';
import { DATABASE_ERROR_MESSAGES, databaseErrorCode, databaseErrorMessage } from '../public/_scaffold/templates/shared/lib/db-errors.js';

const readTemplate = (filename) => readFile(new URL(`../public/_scaffold/templates/${filename}`, import.meta.url), 'utf8');
const adminInput = {
  adminUsername: 'practiceowner',
  adminEmail: 'owner@example.test',
  adminPassword: 'CanopyOwner!8'
};
const baseInput = {
  target: 'cloudflare', specialty: 'dental', businessName: 'Deploy Check Dental', theme: 'brivon-dark',
  timeZone: 'Asia/Manila', features: { blog: true, gallery: true, scheduling: true },
  ...adminInput
};

// The packaged ZIP stores entries uncompressed, so the same reader the other
// ZIP tests use gives back the exact file text the operator would unzip.
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

async function packageFiles(target = 'cloudflare', overrides = {}) {
  const { buffer } = await generateBundle({ ...baseInput, target, ...overrides }, readTemplate);
  return zipEntries(buffer);
}

test('deployed packages create their own site record so client signup works after schema.sql alone', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const runtimePath = target === 'cloudflare' ? 'src/index.js' : 'api/index.js';
    const runtime = files.get(runtimePath);
    const label = `${target} ${runtimePath}`;

    assert.ok(files.has('lib/db-errors.js'), `${label}: actionable database errors library missing`);
    assert.match(runtime, /function ensureSiteRow/, `${label}: no site-record bootstrap`);
    assert.match(runtime, /INSERT INTO tele_sites \(site_id, email, config\) VALUES \([\s\S]*?ON CONFLICT \(site_id\) DO UPDATE SET email = EXCLUDED\.email, config = EXCLUDED\.config WHERE tele_sites\.updated_at = tele_sites\.created_at/,
      `${label}: the bootstrap must refresh an untouched seed without overwriting owner-edited settings`);
    // Every query must run through the wrapper, so no route can skip the record.
    if (target === 'cloudflare') {
      assert.match(runtime, /function sql\(env\) \{\s*const client = rawSql\(env\);\s*return async \(strings, \.\.\.values\) => \{\s*await ensureSiteRow\(env\);/,
        `${label}: the shared sql() helper does not guarantee the site record`);
    } else {
      assert.match(runtime, /const getDb = \(\) => \{\s*const client = createNeonClient\(process\.env\.DATABASE_URL\);\s*return async \(strings, \.\.\.values\) => \{\s*await ensureSiteRow\(\);/,
        `${label}: getDb() does not guarantee the site record`);
    }
    // The failure the operator saw (signup 503) must carry an actionable message.
    assert.match(runtime, /databaseErrorMessage\((?:cause|error), 'Could not create the client account/,
      `${label}: registration failures must explain the missing database setup`);
    const publicConfig = files.get(target === 'cloudflare' ? 'public/site-config.js' : 'site-config.js');
    assert.ok(publicConfig, `${label}: public site config missing from the package`);
    assert.doesNotMatch(publicConfig, /ensureSiteRow|databaseErrorMessage|DATABASE_URL/,
      `${label}: build internals must not leak into the public site config`);
  }
});

test('219 generated article writes persist one structured gallery and retire legacy image-table rows', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const runtime = (await packageFiles(target)).get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
    assert.doesNotMatch(runtime, /INSERT INTO tele_blog_post_images|function articleGalleryRows/);
    assert.match(runtime, /normalizeContentGallery\(value.contentGallery, body\)/);
    assert.match(runtime, /content_gallery AS "contentGallery"/);
    assert.match(runtime, /JSON.stringify\(post.contentGallery\)/);
    assert.equal((runtime.match(/DELETE FROM tele_blog_post_images AS image USING saved/g) || []).length, 2);
  }
});

test('database error codes are mapped to actionable, secret-free messages', () => {
  assert.equal(databaseErrorCode({ code: '42p01' }), '42P01');
  assert.match(databaseErrorMessage({ code: '42P01' }, 'fallback'), /schema\.sql/);
  assert.match(databaseErrorMessage({ code: '23503' }, 'fallback'), /missing its schema or site record/);
  assert.match(databaseErrorMessage({ code: '3D000' }, 'fallback'), /DATABASE_URL/);
  assert.equal(databaseErrorMessage({ code: '23514' }, 'fallback'), 'fallback');
  assert.equal(databaseErrorMessage(undefined, 'fallback'), 'fallback');
  for (const message of Object.values(DATABASE_ERROR_MESSAGES)) {
    assert.doesNotMatch(message, /postgres(ql)?:\/\/|password=|neon\.tech/i, `message leaks connection details: ${message}`);
  }
});

test('seed.sql never overwrites owner edits and the packaged setup notes say so', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const seed = files.get('db/seed.sql');
    assert.match(seed, /INSERT INTO tele_sites \(site_id, email, config\) VALUES \([\s\S]*?ON CONFLICT \(site_id\) DO NOTHING/,
      `${target}: re-running seed.sql would overwrite live settings`);
    assert.match(seed, /safe to rerun/, `${target}: seed.sql must explain that it is safe to rerun`);
    const readme = files.get('README.md');
    assert.match(readme, /applies the schema it ships/, `${target}: README must explain the automatic schema`);
    assert.match(readme, /creates its own configuration row/, `${target}: README must explain the automatic site record`);
    assert.match(readme, /db\/seed\.sql.*optional/i, `${target}: README must mark seed.sql as optional`);
    assert.match(readme, /Running `db\/schema\.sql` yourself is optional/, `${target}: README must keep schema.sql as the manual fallback`);
  }
});

test('packaged manifest describes the chosen target without claiming a different runtime', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const manifest = JSON.parse((await packageFiles(target)).get('manifest.json'));
    assert.equal(manifest.target, target);
    assert.equal(manifest.generator, 'Canopy Studio Builder');
    assert.equal(manifest.version, '1.3.0');
  }
});

// Strips // and /* */ comments outside of string literals so the generated
// wrangler.jsonc can be validated as plain JSON.
function stripJsoncComments(text) {
  let out = '';
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (inString) {
      out += character;
      if (character === '\\') { out += next ?? ''; index += 1; continue; }
      if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; out += character; continue; }
    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      out += '\n';
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    out += character;
  }
  return out;
}
function devVarValue(envText, name) {
  const match = new RegExp(`^${name}="([^"]*)"$`, 'm').exec(envText);
  return match ? match[1] : null;
}

test('the Cloudflare package bakes .dev.vars into wrangler.jsonc so a plain deploy is configured', async () => {
  const input = { ...baseInput, databaseUrl: 'postgres://user:pass@pooler.neon.tech/dbname?sslmode=require' };
  const { buffer, filename } = await generateBundle(input, readTemplate);
  const files = zipEntries(buffer);
  const config = JSON.parse(stripJsoncComments(files.get('wrangler.jsonc')));
  // The Worker name is the ZIP filename minus .zip, so each package updates
  // exactly one Worker instead of creating duplicate deployments.
  assert.equal(config.name, filename.replace(/\.zip$/, ''), 'worker name must equal the zip filename minus .zip');
  assert.match(config.name, /^[a-z][a-z0-9-]{0,127}$/, 'worker name must satisfy the Cloudflare naming rules');
  const env = files.get('.dev.vars');
  for (const name of ['DATABASE_URL', 'ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'CSRF_SECRET']) {
    const expected = devVarValue(env, name);
    assert.ok(expected, `.dev.vars carries no ${name}`);
    assert.equal(config.vars?.[name], expected, `wrangler.jsonc vars.${name} must mirror .dev.vars`);
  }
  assert.equal(config.vars.ADMIN_USERNAME, 'practiceowner');
  assert.equal(config.vars.ADMIN_EMAIL, 'owner@example.test');
  assert.match(config.vars.ADMIN_PASSWORD_HASH, /^pbkdf2\$/);
  assert.equal(config.vars.CSRF_SECRET.length, 64, 'CSRF_SECRET must be the freshly generated 64-hex secret');
  assert.match(config.vars.DATABASE_URL, /^postgres:\/\/user:pass@pooler\.neon\.tech\/dbname$/, 'sslmode must be normalized out');
  // The raw password must never be baked into the deployable configuration.
  assert.doesNotMatch(files.get('wrangler.jsonc'), /CanopyOwner!8/, 'raw password leaked into wrangler.jsonc');
  assert.match(JSON.parse(files.get('package.json')).name, /^[a-z0-9][a-z0-9._-]*$/, 'package name must be a valid npm name');
  assert.equal(JSON.parse(files.get('package.json')).name, config.name, 'package.json name should match the worker name');
});

test('the Cloudflare package omits a placeholder DATABASE_URL from wrangler.jsonc vars', async () => {
  const files = await packageFiles('cloudflare');
  const config = JSON.parse(stripJsoncComments(files.get('wrangler.jsonc')));
  assert.ok(config.vars, 'wrangler.jsonc must carry a vars section');
  assert.equal(config.vars.DATABASE_URL, undefined, 'the placeholder URL must not be baked into the deploy');
  assert.match(files.get('.dev.vars'), /DATABASE_URL="postgresql:\/\/USER:PASSWORD@HOST\.neon\.tech\/DB"/,
    '.dev.vars keeps the placeholder for local development');
  assert.equal(config.vars.ADMIN_USERNAME, 'practiceowner');
  assert.ok(config.vars.CSRF_SECRET, 'CSRF_SECRET must always be baked in so forms work after deploy');
});

test('every packaged runtime ships the shared libraries it imports', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    // The templates manifest is the build input (it is not shipped inside the ZIP).
    const manifest = JSON.parse(await readTemplate('manifest.json'));
    for (const relative of manifest.sharedRuntime) {
      assert.ok(files.has(relative), `${target}: shared runtime file ${relative} missing from the package`);
    }
    const runtime = files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
    const imported = [...runtime.matchAll(/from '\.\.\/(lib\/[^']+)'/g)].map((match) => match[1]);
    assert.ok(imported.length >= 6, `${target}: expected the shared runtime imports`);
    for (const relative of imported) {
      assert.ok(files.has(relative), `${target}: ${relative} is imported but not packaged`);
    }
  }
});

test('packages are reproducible: the payload timestamp anchors every generated date', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const stamp = '2026-10-12T00:00:00.000Z';
    const first = await generateBundle({ ...baseInput, target, createdAt: stamp }, readTemplate);
    const second = await generateBundle({ ...baseInput, target, createdAt: stamp }, readTemplate);
    const envFile = target === 'cloudflare' ? '.dev.vars' : '.env';
    const a = zipEntries(first.buffer);
    const b = zipEntries(second.buffer);
    assert.deepEqual([...a.keys()], [...b.keys()], `${target}: entry lists differ between builds`);
    // Only the env file may differ: each build mints fresh secrets and a fresh
    // PBKDF2 salt. For Cloudflare, wrangler.jsonc differs as well because its
    // "vars" section carries the same freshly minted production values. Every
    // other entry must be byte-identical.
    const mintedEntries = new Set([envFile, ...(target === 'cloudflare' ? ['wrangler.jsonc'] : [])]);
    const differing = [...a.keys()].filter((name) => !mintedEntries.has(name) && a.get(name) !== b.get(name));
    assert.deepEqual(differing, [], `${target}: these entries changed between identical builds`);
    const manifest = JSON.parse(a.get('manifest.json'));
    assert.equal(manifest.generatedAt, stamp, `${target}: the manifest stamp is not the payload stamp`);
    assert.equal(first.config.createdAt, stamp, `${target}: the config stamp is not the payload stamp`);
    assert.match(first.config.demoPosts[0].publishedAt, /^2026-10-0\dT/, `${target}: demo post dates do not follow the payload stamp`);
  }
});

test('the runtime creates the tele_* tables so a fresh database needs nothing pre-run', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const runtime = files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
    const label = `${target} runtime`;
    const schema = files.get('db/schema.sql');
    const statements = schema.split(';').filter((statement) => statement.trim());
    assert.ok(statements.length > 10, `${target}: schema.sql looks empty`);
    const tables = [...schema.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/g)].map((match) => match[1]);
    assert.ok(tables.length >= 10, `${target}: expected the packaged schema tables`);
    assert.deepEqual(tables.filter((name) => !name.startsWith('tele_')), [],
      `${target}: every table must carry the tele_ prefix`);
    // The schema is parameterized into the runtime, so the build token must be
    // replaced by real statements rather than shipped literally.
    assert.doesNotMatch(runtime, /__SCHEMA_STATEMENTS__/, `${label}: the schema token was never replaced`);
    assert.match(runtime, /const SCHEMA_STATEMENTS = \[/, `${label}: schema is not embedded`);
    assert.match(runtime, /function ensureSchema\(/, `${label}: no schema bootstrap`);
    assert.match(runtime, /CREATE TABLE IF NOT EXISTS tele_sites/, `${label}: the embedded schema is not the packaged schema`);
    assert.match(runtime, /CREATE TABLE IF NOT EXISTS tele_admin_users/, `${label}: the embedded schema has no admin table`);
    for (const table of tables) {
      assert.match(runtime, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `${label}: ${table} missing from the embedded schema`);
    }
  }
});

test('the owner account is stored in the database, not in the environment', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const runtime = files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
    const label = `${target} runtime`;
    // The seed must refresh the row only while it is still the untouched seed
    // (i.e. `updated_at = created_at`). The dashboard's account panel stamps
    // `updated_at = now()` on every owner change, so the predicate keeps a
    // changed account safe across redeploys.
    assert.match(runtime, /INSERT INTO tele_admin_users[\s\S]{0,400}?ON CONFLICT \(site_id\) DO UPDATE SET username = EXCLUDED\.username, email = EXCLUDED\.email, password_hash = EXCLUDED\.password_hash WHERE tele_admin_users\.updated_at = tele_admin_users\.created_at/,
      `${label}: the first boot must seed the admin row without overwriting a changed password`);
    assert.match(runtime, /FROM tele_admin_users WHERE site_id = \$\{SITE_ID\}/, `${label}: sign-in does not read the database`);
    assert.match(runtime, /await ensureAdminUser/, `${label}: the first live request must seed tele_admin_users`);
    assert.match(runtime, /normalizePasswordHash\((?:env|process\.env)\.ADMIN_PASSWORD_HASH\)/, `${label}: the seed must store a normalized hash, not quoted env text`);
    assert.match(runtime, /password_hash = EXCLUDED\.password_hash/, `${label}: the account route cannot store a new password hash`);
    const schema = files.get('db/schema.sql');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS tele_admin_users/, `${target}: schema.sql has no admin table`);
    assert.match(schema, /password_hash text NOT NULL/, `${target}: the admin table cannot store a password hash`);
    const readme = files.get('README.md');
    assert.match(readme, /owner account lives in the same Neon database as client registration, in `tele_admin_users`/i,
      `${target}: the README does not explain where the owner sign-in lives`);
    assert.match(readme, /Sign-in panel/, `${target}: the README does not point at the dashboard sign-in panel`);
    assert.match(readme, /never overwrites a changed account/, `${target}: the README does not state that redeploys keep a changed account`);
    if (target === 'cloudflare') {
      assert.match(runtime, /waitUntil\?\.\(ensureAdminUser\(env\)/, `${label}: the first live page GET must seed the owner row`);
    }
  }
});

test('no non-signing visitor can read the capacity meter', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const runtime = files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
    const label = `${target} runtime`;
    assert.doesNotMatch(runtime, /availability\/summary/, `${label}: the public meter route is still routed`);
    // Slice the public availability handler and prove it publishes counts of
    // open slots only — never published/reserved totals or a fill percentage.
    const start = runtime.indexOf(target === 'cloudflare' ? "path === '/api/availability' && method === 'GET'" : "app.get('/api/availability'");
    const end = runtime.indexOf(target === 'cloudflare' ? "path === '/api/admin/availability'" : "app.get('/api/admin/availability'");
    assert.ok(start > 0 && end > start, `${label}: cannot locate the public availability handler`);
    const handler = runtime.slice(start, end);
    for (const leaked of ['totalSlots', 'bookedSlots', 'fillPercent', 'availableSlots']) {
      assert.doesNotMatch(handler, new RegExp(leaked), `${label}: the public handler still answers ${leaked}`);
    }
    assert.match(handler, /hasTimes/, `${label}: the public handler must still say whether times exist`);
    // The calendar is account-only now: the handler must resolve the client
    // session and 401 a guest before returning any slot.
    assert.match(handler, /currentClient/, `${label}: the availability handler must check the client session`);
    assert.match(handler, /401/, `${label}: the availability handler must reject guests with 401`);
    const page = files.get(target === 'cloudflare' ? 'public/appointments.js' : 'appointments.js');
    assert.doesNotMatch(page, /fillPercent|capacity-meter|renderMeter/, `${target}: the client page still renders the meter`);
    const html = files.get(target === 'cloudflare' ? 'public/appointments.html' : 'appointments.html');
    assert.doesNotMatch(html, /capacity-meter|calendar-capacity-card/, `${target}: the client page still carries meter markup`);
    assert.match(files.get('README.md'), /owner-only/i, `${target}: the README does not say capacity is owner-only`);
  }
});

test('owner write routes for blog, gallery, and scheduling are gated by their features', async () => {
  // Every `/api/admin/...` write route must check the matching feature flag
  // before reading or writing the database; otherwise the dashboard can save
  // blog posts, gallery items, and appointments on a build that disabled
  // them, and the public UI then has no way to surface them. The 404 message
  // identifies the feature for the operator.
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const runtime = files.get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
    const admin = files.get(target === 'cloudflare' ? 'public/admin.js' : 'admin.js');
    const label = `${target} runtime`;
    // Blog: GET, POST, PUT, DELETE all must gate on features.blog.
    for (const blogRoute of [
      target === 'cloudflare' ? "path === '/api/admin/posts' && method === 'GET'" : "app.get('/api/admin/posts'",
      target === 'cloudflare' ? "path === '/api/admin/posts' && method === 'POST'" : "app.post('/api/admin/posts'",
      target === 'cloudflare' ? "path.startsWith('/api/admin/posts/') && method === 'PUT'" : "app.put('/api/admin/posts/:id'",
      target === 'cloudflare' ? "path.startsWith('/api/admin/posts/') && method === 'DELETE'" : "app.delete('/api/admin/posts/:id'"
    ]) {
      const start = runtime.indexOf(blogRoute);
      assert.ok(start > 0, `${label}: cannot find blog route ${blogRoute}`);
      const handler = runtime.slice(start, Math.min(start + 600, runtime.length));
      assert.match(handler, /features\?\.blog/,
        `${label}: the blog route (${blogRoute}) does not gate on features.blog`);
    }
    // Gallery: GET, POST, PUT, DELETE all must gate on features.gallery.
    for (const galleryRoute of [
      target === 'cloudflare' ? "path === '/api/admin/gallery' && method === 'GET'" : "app.get('/api/admin/gallery'",
      target === 'cloudflare' ? "path === '/api/admin/gallery' && method === 'POST'" : "app.post('/api/admin/gallery'",
      target === 'cloudflare' ? "path.startsWith('/api/admin/gallery/') && (method === 'PUT' || method === 'DELETE')" : "app.put('/api/admin/gallery/:id'",
      target === 'cloudflare' ? "path === '/api/admin/gallery' && method === 'GET'" : "app.delete('/api/admin/gallery/:id'"
    ]) {
      const start = runtime.indexOf(galleryRoute);
      assert.ok(start > 0, `${label}: cannot find gallery route ${galleryRoute}`);
      const handler = runtime.slice(start, Math.min(start + 600, runtime.length));
      assert.match(handler, /features\?\.gallery/,
        `${label}: the gallery route does not gate on features.gallery`);
    }
    // Scheduling: appointments, payments, payment-proofs all gate on
    // features.scheduling. Pick a representative handler per group.
    for (const schedulingRoute of [
      target === 'cloudflare' ? "path === '/api/admin/appointments' && method === 'GET'" : "app.get('/api/admin/appointments'",
      target === 'cloudflare' ? "path === '/api/admin/payments/unpaid' && method === 'GET'" : "app.get('/api/admin/payments/unpaid'",
      target === 'cloudflare' ? "path.startsWith('/api/admin/payment-proofs/') && method === 'PATCH'" : "app.patch('/api/admin/payment-proofs/:id'"
    ]) {
      const start = runtime.indexOf(schedulingRoute);
      assert.ok(start > 0, `${label}: cannot find scheduling route ${schedulingRoute}`);
      const handler = runtime.slice(start, Math.min(start + 600, runtime.length));
      assert.match(handler, /features\?\.scheduling/,
        `${label}: the scheduling route does not gate on features.scheduling`);
    }
    // The dashboard hides feature pages on init and falls back to "identity"
    // when the URL still names a hidden page (e.g. a stale bookmark after a
    // feature toggle). Both behaviours must be present in admin.js.
    assert.match(admin, /pagesDisabledByFeatures/,
      `${target}: admin.js does not compute which pages are disabled by features`);
    assert.match(admin, /FEATURE_PAGE_IDS/,
      `${target}: admin.js does not map features to page ids`);
  }
});

test('the builder, page editor, runtime validator, and generator share one slugify', async () => {
  // F6 — for any name whose slug would exceed 45 characters, the four places
  // that derive a site id (the builder's "Site address", the page-editor
  // tab, the server-side page-edit validator, and the generator's
  // `tele_sites.site_id` / wrangler.jsonc name / ZIP filename) must produce
  // the exact same string. A drift meant the dashboard showed a site address
  // the generated package never used, and page edits were stored under a key
  // that could never match the runtime's `SITE_ID`.
  const longName = 'Harborlight Veterinary Care and Rehabilitation Center Main';
  const fromCore = coreSlugify(longName);
  assert.ok(fromCore.length <= 45, `slugify produced ${fromCore.length} chars (${fromCore})`);
  const { buffer } = await generateBundle({
    ...baseInput, businessName: longName
  }, readTemplate);
  const files = zipEntries(buffer);
  const runtime = files.get('src/index.js');
  assert.match(runtime, new RegExp(`const SITE_ID = ['"]${fromCore}['"]`),
    `the Cloudflare runtime's SITE_ID is not the generator's slugify output`);
  const builderSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(builderSource, /PAGE_EDIT_SITE_ID = \/\^\[a-z0-9\]\[a-z0-9-\]\{0,44\}\$\//,
    'the builder validator accepts site ids the runtime cannot produce');
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const pageEditorSource = await readFile(new URL('../public/page-editor.js', import.meta.url), 'utf8');
  assert.match(appSource, /import\s*\{[^}]*\bslugify\b[^}]*\}\s*from\s*['"]\.\/package-core\.js['"]/,
    'app.js does not import slugify from package-core.js');
  assert.match(pageEditorSource, /import\s*\{[^}]*\bslugify\b[^}]*\}\s*from\s*['"]\.\/package-core\.js['"]/,
    'page-editor.js does not import slugify from package-core.js');
  assert.doesNotMatch(appSource, /function\s+slugify\s*\(\s*value\s*\)\s*\{[^}]*slice\(0,\s*55\)/,
    'app.js still has the 55-char slice local slugify');
  assert.doesNotMatch(pageEditorSource, /function\s+slugify\s*\(\s*value\s*\)\s*\{[^}]*slice\(0,\s*55\)/,
    'page-editor.js still has the 55-char slice local slugify');
});

test('hero copy and service list can be overridden through the builder payload', async () => {
  // F10 — `normalizeConfig` used to ignore `heroEyebrow`, `heroHeadline`,
  // `heroText`, and `services` from the builder payload and re-derive them
  // from its own `VERTICALS` table. Editing the hero copy in the builder
  // had zero effect on the preview or the ZIP. The config now flows into
  // the packaged `public/site-config.js` and the `__SITE_CONFIG_JSON__`
  // embedded in the runtime's compiled-in defaults.
  const { buffer } = await generateBundle({
    ...baseInput,
    heroEyebrow: 'A QUIET PLACE FOR EVERY VISIT',
    heroHeadline: 'Good care|good neighbors.',
    heroText: 'A small neighborhood practice with a calm waiting room.',
    services: ['First visit', 'Wellness plans', 'Senior care', 'Travel certificates']
  }, readTemplate);
  const files = zipEntries(buffer);
  const siteConfig = files.get('public/site-config.js');
  assert.match(siteConfig, /A QUIET PLACE FOR EVERY VISIT/,
    'the hero eyebrow override is not in the packaged site-config.js');
  assert.match(siteConfig, /Good care[\\n]+good neighbors/,
    'the hero headline override is not in the packaged site-config.js');
  assert.match(siteConfig, /A small neighborhood practice with a calm waiting room/,
    'the hero text override is not in the packaged site-config.js');
  assert.match(siteConfig, /First visit/,
    'the service list override is not in the packaged site-config.js');
  // When the input omits the fields, the vertical defaults are used.
  // `baseInput` is a dental practice, so the default eyebrow is the dental
  // vertical's copy, not the veterinary one.
  const { buffer: defaultBuffer } = await generateBundle({ ...baseInput }, readTemplate);
  const defaultFiles = zipEntries(defaultBuffer);
  const defaultSiteConfig = defaultFiles.get('public/site-config.js');
  assert.match(defaultSiteConfig, /A BRIGHTER KIND OF DENTAL CARE/,
    'the hero eyebrow default is not the vertical default for the dental practice');
  const { buffer: vetBuffer } = await generateBundle({ ...baseInput, specialty: 'veterinary' }, readTemplate);
  const vetFiles = zipEntries(vetBuffer);
  const vetSiteConfig = vetFiles.get('public/site-config.js');
  assert.match(vetSiteConfig, /A LITTLE MORE CARE, EVERY DAY/,
    'the hero eyebrow default is not the vertical default for the veterinary practice');
});

test('Brivon font stack is loaded on functional pages where the Brivon continuity CSS targets them', async () => {
  // F9 — `brivon.css` sets `font-family: 'Boldonse', 'Inter Tight', …` and
  // `font-family: 'Inter Tight', …` on `body.theme-brivon-*:not(.brivon-shell)`,
  // so the appointments, owner dashboard, and custom pages need the
  // matching Google Fonts stack loaded — without it every heading silently
  // falls through to a generic sans-serif.
  const { buffer } = await generateBundle({ ...baseInput, theme: 'brivon-dark' }, readTemplate);
  const files = zipEntries(buffer);
  // The packaged manifest.json is generated by package-core.js (it only
  // describes the build), so the source manifest in templates/ is what
  // decides which files go into the ZIP. Read it directly.
  const sourceManifest = JSON.parse(await readFile(new URL('../public/_scaffold/templates/manifest.json', import.meta.url), 'utf8'));
  assert.ok(sourceManifest.sharedPublic.includes('public/brivon-fonts.js'),
    'manifest.json does not list public/brivon-fonts.js');
  const appointments = files.get('public/appointments.html');
  const admin = files.get('public/admin.html');
  assert.match(appointments, /<script src="\/brivon-fonts\.js" defer>/,
    'appointments.html does not load /brivon-fonts.js');
  assert.match(admin, /<script src="\/brivon-fonts\.js" defer>/,
    'admin.html does not load /brivon-fonts.js');
  // The font helper itself is a single-file module that injects the
  // preconnect + stylesheet only when site.theme is brivon-dark or
  // brivon-light; for an Illustration theme no remote font is requested.
  const brivonFonts = files.get('public/brivon-fonts.js');
  assert.match(brivonFonts, /window\.SITE_CONFIG/,
    'brivon-fonts.js does not read window.SITE_CONFIG');
  assert.match(brivonFonts, /fonts\.googleapis\.com/,
    'brivon-fonts.js does not reference the Google Fonts URL');
  assert.match(brivonFonts, /brivon-dark|brivon-light/,
    'brivon-fonts.js does not gate on the Brivon theme name');
});

test('the generated .gitignore covers the secret-bearing wrangler.jsonc', async () => {
  // F7 — the Cloudflare package bakes DATABASE_URL, ADMIN_* and CSRF_SECRET
  // into `wrangler.jsonc vars` so a plain `wrangler deploy` works. Without
  // gitignoring that file, a customer's first `git init && git add . &&
  // git push` would commit their production database password and admin
  // hash to a public repo. The Vercel package has no equivalent: `vercel.json`
  // is purely declarative configuration, no secrets.
  const cf = await packageFiles('cloudflare');
  const vercel = await packageFiles('vercel');
  assert.match(cf.get('.gitignore'), /wrangler\.jsonc/,
    'the Cloudflare .gitignore does not cover wrangler.jsonc');
  assert.doesNotMatch(vercel.get('.gitignore'), /wrangler\.jsonc/,
    'the Vercel .gitignore must not mention wrangler.jsonc');
  assert.match(cf.get('.gitignore'), /\.dev\.vars/,
    'the Cloudflare .gitignore does not cover .dev.vars');
  assert.match(vercel.get('.gitignore'), /^\.env$/m,
    'the Vercel .gitignore does not cover .env');
  // The generated README must spell out the new gitignore behaviour.
  assert.match(cf.get('README.md'), /wrangler\.jsonc[\s\S]{0,200}\.gitignore/,
    'the Cloudflare README does not explain the wrangler.jsonc gitignore rule');
});
