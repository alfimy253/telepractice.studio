// Bug Fix Session #224 — `tele_sites` has its own unique contact-email column.
//
// The site row used to carry the practice email only inside `config` (JSONB).
// These tests pin the schema change (a real `email` column + unique index),
// the idempotent migration that backfills old rows, and the generated runtime
// write paths that keep the column in sync with `config.email`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { generateBundle, normalizeConfig } from '../public/package-core.js';

const readTemplate = (filename) => readFile(new URL(`../public/_scaffold/templates/${filename}`, import.meta.url), 'utf8');
const baseInput = {
  target: 'cloudflare', specialty: 'dental', businessName: 'Email Key Dental', theme: 'canopy',
  timeZone: 'Asia/Manila', email: 'Owner@Example.test',
  adminUsername: 'practiceowner', adminEmail: 'owner@example.test', adminPassword: 'CanopyOwner!8'
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

async function packageFiles(target = 'cloudflare') {
  const { buffer } = await generateBundle({ ...baseInput, target }, readTemplate);
  return zipEntries(buffer);
}

function embeddedStatements(runtime) {
  const line = runtime.split('\n').find((entry) => entry.startsWith('const SCHEMA_STATEMENTS = '));
  assert.ok(line, 'generated runtime does not embed the schema');
  return JSON.parse(line.slice('const SCHEMA_STATEMENTS = '.length).replace(/;$/u, ''));
}

test('generated packages keep the contact email in a separate unique tele_sites column', async () => {
  for (const target of ['cloudflare', 'vercel']) {
    const files = await packageFiles(target);
    const runtimePath = target === 'cloudflare' ? 'src/index.js' : 'api/index.js';
    const runtime = files.get(runtimePath);
    const schema = files.get('db/schema.sql');
    const label = `${target} ${runtimePath}`;

    assert.match(schema, /CREATE TABLE IF NOT EXISTS tele_sites \([\s\S]{0,900}?site_id text PRIMARY KEY,[\s\S]{0,900}?email varchar\(120\)/,
      `${label}: tele_sites has no first-class email column`);
    assert.match(schema, /ALTER TABLE tele_sites ADD COLUMN IF NOT EXISTS email varchar\(120\)/,
      `${label}: existing databases are not migrated to the email column`);
    assert.match(schema, /UPDATE tele_sites\s+SET email = left\(NULLIF\(lower\(btrim\(config ->> 'email'\)\), ''\), 120\)/,
      `${label}: legacy config emails are not backfilled within the column width`);
    assert.match(schema, /CREATE TRIGGER tele_sites_sync_email\s+BEFORE INSERT OR UPDATE OF config ON tele_sites/,
      `${label}: config-only writers can desynchronize the email column`);
    assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS tele_sites_email_unique_idx\s+ON tele_sites \(lower\(email\)\)\s+WHERE email IS NOT NULL/,
      `${label}: the contact email is not the unique business key`);
    assert.match(runtime, /function contactEmail\(value\)/,
      `${label}: the runtime has no canonical contact-email normalizer`);

    const bootstrap = runtime.match(/INSERT INTO tele_sites \(site_id, email, config\)[\s\S]{0,600}?WHERE tele_sites\.updated_at = tele_sites\.created_at/);
    assert.ok(bootstrap, `${label}: ensureSiteRow does not write the email column`);
    assert.match(bootstrap[0], /contactEmail\(DEFAULT_CONFIG\.email\)/,
      `${label}: ensureSiteRow does not derive the column from the compiled contact email`);
    assert.match(bootstrap[0], /DO UPDATE SET email = EXCLUDED\.email, config = EXCLUDED\.config/,
      `${label}: ensureSiteRow does not refresh the email with an untouched seed`);

    const save = runtime.match(/INSERT INTO tele_sites \(site_id, email, config\)[\s\S]{0,420}?updated_at = now\(\) RETURNING config/);
    assert.ok(save, `${label}: PUT /api/site does not write the email column`);
    assert.match(save[0], /contactEmail\(config\.email\)/,
      `${label}: PUT /api/site does not derive the column from the submitted contact email`);
    assert.match(runtime, /already used by another site in this database/,
      `${label}: a duplicate-email rejection has no owner-actionable message`);
    assert.match(runtime, /23505/,
      `${label}: duplicate emails are not recognised as conflicts`);

    const seed = files.get('db/seed.sql');
    assert.match(seed, /INSERT INTO tele_sites \(site_id, email, config\)/,
      `${label}: seed.sql does not populate the email column`);
    assert.match(seed, /'owner@example\.test'/, `${label}: seed.sql does not carry the normalized contact email`);
    const apply = files.get('db/apply-config.sql');
    assert.match(apply, /INSERT INTO tele_sites \(site_id, email, config\)/,
      `${label}: apply-config.sql does not populate the email column`);
    assert.match(apply, /DO UPDATE SET email = EXCLUDED\.email, config = EXCLUDED\.config/,
      `${label}: apply-config.sql does not refresh the email column`);
  }
});

test('normalizeConfig stores the contact email in its canonical lower-case form', () => {
  const config = normalizeConfig({ ...baseInput, target: 'cloudflare' });
  assert.equal(config.email, 'owner@example.test');
  const blank = normalizeConfig({ ...baseInput, target: 'cloudflare', email: '   ' });
  assert.equal(blank.email, 'hello@email-key-dental.example', 'a blank builder email must still produce a unique-able contact email');
});

test('legacy config emails are backfilled and duplicate emails become impossible', async () => {
  const files = await packageFiles('cloudflare');
  const statements = embeddedStatements(files.get('src/index.js'));
  assert.ok(statements.length > 60, 'the packaged schema is missing its #224 statements');

  const db = new PGlite();
  try {
    // A database created by an older package: no email column yet.
    await db.exec(`
      CREATE TABLE tele_sites (
        site_id text PRIMARY KEY,
        config jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO tele_sites (site_id, config, created_at) VALUES
        ('keeper-site', '{"email":"Owner@Example.test"}'::jsonb, now() - interval '3 days'),
        ('later-site', '{"email":"owner@example.test"}'::jsonb, now() - interval '2 days'),
        ('overlong-site', '{"email":"${'a'.repeat(200)}@example.test"}'::jsonb, now() - interval '1 day'),
        ('no-email-site', '{}'::jsonb, now());
    `);

    for (const statement of statements) await db.exec(statement);
    // The packaged schema is reapplied by every fresh Worker isolate. A second
    // pass must not try to restore the duplicate email that the migration
    // deliberately cleared (the existing unique index would reject it).
    for (const statement of statements) await db.exec(statement);

    const migrated = (await db.query(
      `SELECT site_id, email FROM tele_sites ORDER BY site_id`
    )).rows;
    assert.deepEqual(migrated, [
      { site_id: 'keeper-site', email: 'owner@example.test' },
      { site_id: 'later-site', email: null },
      { site_id: 'no-email-site', email: null },
      // Over-long legacy value is truncated to the varchar(120) width; the
      // truncation is no longer a valid address, so cleanup nulls it instead
      // of aborting the whole bootstrap with 22001.
      { site_id: 'overlong-site', email: null }
    ]);

    const indexes = (await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tele_sites'`
    )).rows.map((row) => row.indexname);
    assert.ok(indexes.includes('tele_sites_email_unique_idx'), 'the unique email index was not created');

    // A second site cannot claim an email that already belongs to a site row.
    await assert.rejects(
      db.query(`INSERT INTO tele_sites (site_id, config) VALUES ('new-site', '{"email":"OWNER@example.test"}'::jsonb)`),
      (error) => error?.code === '23505'
    );
    // The migration left one duplicate without a column value; it still cannot
    // be edited into the same email later.
    await assert.rejects(
      db.query(`UPDATE tele_sites SET email = 'owner@example.test' WHERE site_id = 'later-site'`),
      (error) => error?.code === '23505'
    );
    // The trigger keeps the column in sync for packages that only write config.
    await db.query(`UPDATE tele_sites SET config = '{"email":"New@Example.test"}'::jsonb WHERE site_id = 'later-site'`);
    assert.equal((await db.query(`SELECT email FROM tele_sites WHERE site_id = 'later-site'`)).rows[0].email, 'new@example.test');
    await assert.rejects(
      db.query(`UPDATE tele_sites SET config = '{"email":"OWNER@example.test"}'::jsonb WHERE site_id = 'later-site'`),
      (error) => error?.code === '23505'
    );
    // Rows without a contact email remain legal for legacy databases and are
    // not subject to a meaningless empty-string uniqueness rule.
    await db.query(`INSERT INTO tele_sites (site_id, config) VALUES ('second-no-email-site', '{}'::jsonb)`);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM tele_sites WHERE email IS NULL`)).rows[0].count, 3);
    // The trigger also applies the column width, so a legacy config-only
    // writer with an over-long address cannot fail the insert/update.
    const longEmail = `${'b'.repeat(115)}@example.test`;
    await db.query(`UPDATE tele_sites SET config = '{"email":"${longEmail}"}'::jsonb WHERE site_id = 'second-no-email-site'`);
    assert.equal((await db.query(`SELECT length(email)::int AS length FROM tele_sites WHERE site_id = 'second-no-email-site'`)).rows[0].length, 120);
  } finally {
    await db.close();
  }
});
