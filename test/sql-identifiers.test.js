import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Every table a generated site touches carries the `tele_` prefix, and so does
// the builder's own storage. The regression that motivated this file: the
// shared payment-reminder sweep was left unprefixed during the `tele_` rename,
// so `UPDATE appointments` hit a relation that does not exist (42P01) and the
// 12/15-minute markers were never written — while the existing tests still
// passed, because they matched /appointment_payment_proofs/ as a substring of
// the correctly prefixed names in the runtimes.
//
// Substring assertions cannot catch a missing prefix, so this file parses the
// shipped SQL and checks each table identifier itself, in both directions:
// every referenced table is prefixed (or a CTE of its own statement), and
// every prefixed table referenced exists in db/schema.sql.

const templateRoot = new URL('../public/_scaffold/templates/', import.meta.url);

// Files whose SQL reaches a generated site's database.
const RUNTIME_SQL_SOURCES = [
  'cloudflare/src/index.js',
  'vercel/api/index.js',
  'cloudflare/payment-reminder-worker.js',
  'vercel/payment-reminder-worker.js',
  'shared/lib/payment-reminders.js',
  'shared/lib/admin-security.js',
  'shared/lib/menu-links.js',
  'shared/lib/payment-proof.js',
  'shared/db/connection.js'
];
// The builder's own storage, plus the generator that writes db/seed.sql and
// db/apply-config.sql into every package.
const BUILDER_SQL_SOURCES = [
  { file: '../src/page-edits-store.js', allow: ['builder_page_edits'] },
  { file: '../public/package-core.js', allow: [] }
];
// Names that are not tables: Postgres built-ins, catalog helpers and SQL
// keywords that can follow a verb (`ON CONFLICT … DO UPDATE SET …`).
const NOT_TABLES = new Set([
  'select', 'unnest', 'generate_series', 'jsonb_to_recordset', 'jsonb_each', 'lateral',
  'set', 'from', 'where', 'values', 'returning', 'on', 'as', 'and', 'or', 'not', 'exists',
  'into', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'group', 'order', 'limit',
  'offset', 'having', 'case', 'when', 'then', 'else', 'end', 'distinct', 'union', 'using',
  'null', 'true', 'false', 'only', 'table', 'index', 'if', 'conflict', 'do'
]);
// A statement begins with its verb. Prose that merely contains one ("unpaid
// booking update failed", "Could not update this booking.") is not SQL.
const STATEMENT_START = /^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DO|SET|VALUES)\b/i;

function stripJsComments(source) {
  // Comments may quote example SQL (db-errors.js cites a pre-migration error
  // message); only string and template literals are real queries.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// Pulls every string/template literal that is a SQL statement.
function sqlLiterals(source) {
  const literals = [];
  const pattern = /`(?:\\[\s\S]|[^\\`])*`|'(?:\\[\s\S]|[^\\'])*'|"(?:\\[\s\S]|[^\\"])*"/g;
  for (const match of source.matchAll(pattern)) {
    const text = match[0].slice(1, -1);
    if (!STATEMENT_START.test(text)) continue;
    if (!/\b(FROM|INTO|UPDATE|JOIN|TABLE)\b/i.test(text)) continue;
    literals.push(text);
  }
  return literals;
}

// CTE names declared by one statement; `FROM reviewed` inside that statement
// addresses the CTE, not a table.
function cteNames(statement) {
  const names = new Set();
  for (const match of statement.matchAll(/(?:\bWITH|,)\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

// Table identifiers a statement reads or writes. A name immediately followed by
// `(` is a function call, not a relation.
function referencedTables(statement) {
  const names = new Set();
  const pattern = /\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)\s*(\()?/gi;
  for (const match of statement.matchAll(pattern)) {
    if (match[2] === '(') continue;
    const name = match[1].toLowerCase();
    if (NOT_TABLES.has(name)) continue;
    names.add(name);
  }
  return names;
}

function tablesIn(source, allowedUnprefixed = []) {
  const referenced = new Set();
  const unprefixed = new Set();
  // `source` is normally a JavaScript file: we pull the SQL out of its
  // string/template literals. The self-check calls us with a bare SQL string
  // (already extracted); in that case the whole input is one statement, so
  // `sqlLiterals` would return nothing and the test would pass vacuously.
  // Detect the bare-statement form by leading verb and run the analysis on it
  // directly.
  const statements = STATEMENT_START.test(source)
    ? [source]
    : sqlLiterals(stripJsComments(source));
  for (const statement of statements) {
    const ctes = cteNames(statement);
    for (const table of referencedTables(statement)) {
      if (ctes.has(table)) continue;
      referenced.add(table);
      if (!table.startsWith('tele_') && !allowedUnprefixed.includes(table)) unprefixed.add(table);
    }
  }
  return { referenced, unprefixed };
}

async function read(relative) {
  return readFile(new URL(relative, templateRoot), 'utf8');
}

test('every table the generated package queries is tele_-prefixed', async () => {
  for (const relative of RUNTIME_SQL_SOURCES) {
    const { unprefixed } = tablesIn(await read(relative));
    assert.deepEqual(
      [...unprefixed].sort(), [],
      `${relative} queries tables without the tele_ prefix: ${[...unprefixed].sort().join(', ') || 'none'}`
    );
  }
});

test('the builder queries only tele_builder_page_edits (renaming the legacy table in place)', async () => {
  for (const { file, allow } of BUILDER_SQL_SOURCES) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    const { unprefixed } = tablesIn(source, allow);
    assert.deepEqual(
      [...unprefixed].sort(), [],
      `${file} queries tables without the tele_ prefix: ${[...unprefixed].sort().join(', ') || 'none'}`
    );
  }
});

test('the shared payment-reminder sweeps target tele_appointments and tele_appointment_payment_proofs', async () => {
  const source = await read('shared/lib/payment-reminders.js');
  const { referenced } = tablesIn(source);
  assert.deepEqual(
    [...referenced].sort(),
    ['tele_appointment_payment_proofs', 'tele_appointments'],
    'the reminder sweeps must touch exactly the two prefixed appointment tables'
  );
  // The reminder marker still gets written; the drop statement (the only
  // automatic cancellation) also stamps the owner-notification marker.
  assert.match(source, /SET payment_reminder_sent_at = now\(\)/);
  assert.match(source, /payment_status = 'expired',\s*payment_owner_attention_at = now\(\)/);
  assert.doesNotMatch(source, /DELETE FROM/);
});

test('every tele_ table referenced by the package is created by db/schema.sql', async () => {
  const schema = await read('shared/db/schema.sql');
  const created = new Set(
    [...schema.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_][a-z0-9_]*)/gi)].map((match) => match[1].toLowerCase())
  );
  assert.ok(created.size >= 12, `expected the full tele_ schema, found ${created.size} tables`);

  // The builder creates its own table, so it is not part of the package schema.
  const referenced = new Set();
  for (const relative of RUNTIME_SQL_SOURCES) {
    for (const table of tablesIn(await read(relative)).referenced) referenced.add(table);
  }
  const generator = await readFile(new URL('../public/package-core.js', import.meta.url), 'utf8');
  for (const table of tablesIn(generator).referenced) referenced.add(table);

  const missing = [...referenced].filter((table) => table.startsWith('tele_') && !created.has(table)).sort();
  assert.deepEqual(missing, [], `db/schema.sql does not create: ${missing.join(', ') || 'none'}`);

  const unused = [...created].filter((table) => !referenced.has(table)).sort();
  assert.deepEqual(unused, [], `db/schema.sql creates tables nothing queries: ${unused.join(', ') || 'none'}`);
});

test('the sweep parser catches an unprefixed identifier (self-check)', () => {
  // Guards the guard: if the parser ever stops seeing identifiers, the four
  // assertions above would pass vacuously. The samples are wrapped in template
  // literals because `sqlLiterals` only inspects string literals and template
  // literals — a bare top-level statement in the test source would never be
  // seen by the production parser, and the self-check would pass vacuously.
  const broken = `UPDATE appointments AS a SET x = now() WHERE NOT EXISTS (SELECT 1 FROM appointment_payment_proofs p)`;
  const { unprefixed } = tablesIn(broken);
  assert.deepEqual([...unprefixed].sort(), ['appointment_payment_proofs', 'appointments']);

  const withCte = `WITH reviewed AS (UPDATE tele_appointments SET x = 1 RETURNING id)
    SELECT reviewed.id FROM reviewed JOIN tele_sites ON tele_sites.site_id = reviewed.id`;
  assert.deepEqual([...tablesIn(withCte).unprefixed], [], 'a CTE name must not be reported as a table');
});
