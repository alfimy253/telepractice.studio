import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateBundle } from '../public/package-core.js';
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
    assert.match(runtime, /INSERT INTO tele_sites \(site_id, config\) VALUES \([\s\S]*?ON CONFLICT \(site_id\) DO NOTHING/,
      `${label}: the bootstrap must never overwrite owner-edited settings`);
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

test('generated article writes map camelCase dashboard payloads to the SQL column names', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const runtime = (await packageFiles(target)).get(target === 'cloudflare' ? 'src/index.js' : 'api/index.js');
    const label = `${target} runtime`;
    assert.match(runtime, /function articleGalleryRows\(gallery\)/, `${label}: gallery mapper missing`);
    assert.match(runtime, /image_url: image\?\.imageUrl \?\? ''/, `${label}: imageUrl is not mapped to image_url`);
    assert.match(runtime, /alt_text: image\?\.altText \?\? ''/, `${label}: altText is not mapped to alt_text`);
    assert.match(runtime, /sort_order: Number\(image\?\.sortOrder \?\? 0\)/, `${label}: sortOrder is not mapped to sort_order`);
    // Both the create and the update statement must use it.
    const usages = runtime.match(/jsonb_to_recordset\(\$\{articleGalleryRows\(post\.gallery\)\}/g) || [];
    assert.equal(usages.length, 2, `${label}: expected the mapper in both the insert and the update query`);
    assert.doesNotMatch(runtime, /jsonb_to_recordset\(\$\{JSON\.stringify\(post\.gallery\)\}/,
      `${label}: a query still passes camelCase gallery objects straight to jsonb_to_recordset`);
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
    assert.match(seed, /INSERT INTO tele_sites \(site_id, config\) VALUES \([\s\S]*?ON CONFLICT \(site_id\) DO NOTHING/,
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
    // PBKDF2 salt. Every other entry must be byte-identical.
    const differing = [...a.keys()].filter((name) => name !== envFile && a.get(name) !== b.get(name));
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
    assert.match(runtime, /INSERT INTO tele_admin_users[\s\S]{0,200}?ON CONFLICT \(site_id\) DO NOTHING/,
      `${label}: the first boot must seed the admin row without overwriting a changed password`);
    assert.match(runtime, /FROM tele_admin_users WHERE site_id = \$\{SITE_ID\}/, `${label}: sign-in does not read the database`);
    assert.match(runtime, /password_hash = EXCLUDED\.password_hash/, `${label}: the account route cannot store a new password hash`);
    const schema = files.get('db/schema.sql');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS tele_admin_users/, `${target}: schema.sql has no admin table`);
    assert.match(schema, /password_hash text NOT NULL/, `${target}: the admin table cannot store a password hash`);
    const readme = files.get('README.md');
    assert.match(readme, /owner account lives in the database, in `tele_admin_users`/i,
      `${target}: the README does not explain where the owner sign-in lives`);
    assert.match(readme, /Sign-in panel/, `${target}: the README does not point at the dashboard sign-in panel`);
    assert.match(readme, /never overwrites a changed account/, `${target}: the README does not state that redeploys keep a changed account`);
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
    const page = files.get(target === 'cloudflare' ? 'public/appointments.js' : 'appointments.js');
    assert.doesNotMatch(page, /fillPercent|capacity-meter|renderMeter/, `${target}: the client page still renders the meter`);
    const html = files.get(target === 'cloudflare' ? 'public/appointments.html' : 'appointments.html');
    assert.doesNotMatch(html, /capacity-meter|calendar-capacity-card/, `${target}: the client page still carries meter markup`);
    assert.match(files.get('README.md'), /owner-only/i, `${target}: the README does not say capacity is owner-only`);
  }
});
