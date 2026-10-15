import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  markDroppedBookings,
  markPaymentProofReminders,
  runPaymentReminderChecks
} from '../public/_scaffold/templates/shared/lib/payment-reminders.js';

const templateRoot = new URL('../public/_scaffold/templates/', import.meta.url);
const SITE_ID = 'cron-site';

// ---------------------------------------------------------------------------
// A minimal Postgres lock model. The point of this file is that the payment
// sweep used to run the whole schema bootstrap, and schema DDL takes lock modes
// that conflict with the ROW EXCLUSIVE lock an INSERT takes. Modelling the
// conflict table lets the test prove the sweep cannot block a registration
// instead of just asserting which function name appears in the source.
// ---------------------------------------------------------------------------
const LOCK_MODES = [
  'ACCESS SHARE', 'ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE',
  'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'
];
// Postgres' conflict matrix: two lock modes conflict unless both are at or
// below ROW EXCLUSIVE (with the usual SHARE UPDATE EXCLUSIVE exception, which
// is irrelevant here).
function locksConflict(a, b) {
  return LOCK_MODES.indexOf(a) + LOCK_MODES.indexOf(b) > 4;
}
// The lock a statement takes on the tables it touches.
function lockFor(text) {
  if (/^\s*ALTER TABLE/i.test(text)) return 'ACCESS EXCLUSIVE';
  if (/^\s*CREATE (UNIQUE )?INDEX/i.test(text)) return 'SHARE';
  if (/^\s*CREATE TABLE/i.test(text)) return 'ACCESS EXCLUSIVE';
  if (/^\s*DO \$\$/i.test(text)) return 'ACCESS EXCLUSIVE';
  if (/^\s*(UPDATE|INSERT|DELETE)/i.test(text)) return 'ROW EXCLUSIVE';
  if (/^\s*SELECT/i.test(text)) return 'ACCESS SHARE';
  return 'ACCESS SHARE';
}

// A fake Neon client that records every statement and tracks which locks are
// held. `busy` models a transaction that has not committed yet, so a second
// statement arriving while `busy` is set is what a blocked registration looks
// like.
function fakeClient() {
  const statements = [];
  const held = new Map(); // table -> lock mode currently held
  const blocked = [];
  const record = (text, values) => {
    const mode = lockFor(text);
    const tables = [...text.matchAll(/\btele_[a-z_]+/g)].map((match) => match[0]);
    for (const table of tables) {
      const existing = held.get(table);
      if (existing && locksConflict(existing, mode)) {
        blocked.push({ table, held: existing, wanted: mode, text: text.slice(0, 60) });
      }
      held.set(table, mode);
    }
    statements.push({ text, values, mode, tables });
    return [];
  };
  // Tagged-template form. `strings.join('$1')` reconstructs readable SQL with a
  // placeholder wherever a value was interpolated.
  const client = async (strings, ...values) => record(strings.join('$1'), values);
  client.transaction = async (body) => {
    // Model the real behaviour: locks taken inside the transaction are held
    // until it commits, which is exactly why one big DDL transaction is
    // dangerous. Every statement runs before anything is released.
    const transaction = async (strings, ...values) => record(strings.join('$1'), values);
    // `.query(statement)` takes a plain string, so it must not go through the
    // tagged-template path — `` client`${statement}` `` would yield
    // strings = ['', ''] and lose the statement text entirely.
    transaction.query = async (statement) => record(statement, []);
    const result = await body(transaction);
    held.clear();
    return result;
  };
  client.release = () => held.clear();
  return { client, statements, held, blocked };
}

test('the payment sweep issues only two row-level UPDATEs and opens no transaction', async () => {
  const { client, statements, blocked } = fakeClient();
  const result = await runPaymentReminderChecks(client, SITE_ID);
  assert.deepEqual(result, { reminders: [], dropped: [] });
  assert.equal(statements.length, 2, `the sweep must issue exactly two statements, got ${statements.length}`);
  for (const statement of statements) {
    assert.match(statement.text, /^\s*UPDATE tele_appointments/, 'every sweep statement must be an UPDATE on tele_appointments');
    assert.equal(statement.mode, 'ROW EXCLUSIVE', `a sweep statement took ${statement.mode}, which can block writers`);
    assert.match(statement.text, /RETURNING appointment\.id, appointment\.client_account_id/);
    assert.deepEqual(statement.values, [SITE_ID], 'the sweep must be scoped to one site id');
  }
  assert.deepEqual(blocked, [], 'the sweep must not block itself');
  // Both halves are individually callable, which is what the standalone worker
  // relies on for its two different timers.
  const reminders = fakeClient();
  assert.equal((await markPaymentProofReminders(reminders.client, SITE_ID)).length, 0);
  assert.equal(reminders.statements.length, 1);
  const followups = fakeClient();
  assert.equal((await markDroppedBookings(followups.client, SITE_ID)).length, 0);
  assert.equal(followups.statements.length, 1);
});

test('a concurrent client registration is never blocked by the payment sweep', async () => {
  const { client, blocked } = fakeClient();
  // What the register route does: a plain INSERT, which takes ROW EXCLUSIVE.
  const register = () => client`INSERT INTO tele_client_accounts (site_id, full_name, email, phone, password_hash) VALUES (${SITE_ID}, ${'a'}, ${'b'}, ${'c'}, ${'d'})`;
  await register();
  await runPaymentReminderChecks(client, SITE_ID);
  await register();
  assert.deepEqual(blocked, [], 'registration and the sweep must coexist without a lock conflict');
});

test('the schema bootstrap the sweep must avoid really does conflict with registration', async () => {
  // The counter-case: this is what the every-minute cron used to do. It is kept
  // as a test so the conflict is demonstrated rather than merely described, and
  // so a future refactor that re-routes the sweep through the bootstrapping
  // client fails loudly.
  const { client, blocked } = fakeClient();
  const ddl = [
    'ALTER TABLE tele_appointments ADD COLUMN IF NOT EXISTS payment_owner_attention_at timestamptz',
    'CREATE UNIQUE INDEX IF NOT EXISTS tele_appointments_slot_idx ON tele_appointments(site_id)',
    'DO $$ BEGIN ALTER TABLE tele_client_accounts ADD COLUMN x int; END $$'
  ];
  // A registration is in flight when the cron tick starts its transaction.
  await client.transaction(async (transaction) => {
    for (const statement of ddl) await transaction.query(statement);
    // Still inside the transaction: the locks are held, so this INSERT is what
    // a real registration hit.
    await transaction.query('INSERT INTO tele_client_accounts (site_id) VALUES ($1)');
  });
  assert.ok(blocked.length > 0, 'DDL and a concurrent INSERT must conflict in this model, otherwise the test proves nothing');
  assert.ok(blocked.some((entry) => entry.table === 'tele_client_accounts' && entry.held === 'ACCESS EXCLUSIVE'),
    'the ALTER TABLE / DO $$ ACCESS EXCLUSIVE lock is what blocked the registration');
});

test('the Cloudflare cron sweep uses the raw client and never bootstraps the schema', async () => {
  const source = await readFile(new URL('cloudflare/src/index.js', templateRoot), 'utf8');
  const scheduled = /async scheduled\(_controller, env, ctx\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(scheduled, 'the Cloudflare runtime must export a scheduled() handler');
  const body = scheduled[0];
  assert.match(body, /runPaymentReminderChecks\(rawSql\(env\), SITE_ID\)/,
    'the sweep must run against rawSql(env), the client that does not bootstrap');
  assert.doesNotMatch(body, /runPaymentReminderChecks\(sql\(env\)/,
    'sql(env) wraps every query in ensureSiteRow() -> ensureSchema(), which re-runs all DDL on every cron tick');
  // Prove the two clients really differ: rawSql must not reach the bootstrap,
  // and sql must, otherwise the assertion above is meaningless.
  const rawSqlBody = /function rawSql\(env\) \{[\s\S]*?\n\}/.exec(source)[0];
  assert.doesNotMatch(rawSqlBody, /ensureSchema|ensureSiteRow/, 'rawSql must stay free of the schema bootstrap');
  const sqlBody = /function sql\(env\) \{[\s\S]*?\n\}/.exec(source)[0];
  assert.match(sqlBody, /await ensureSiteRow\(env\)/, 'sql(env) is the bootstrapping client');
  assert.match(sqlBody, /await ensureAdminUser\(env\)/, 'sql(env) must also seed tele_admin_users on first use');
  // A cron trigger is a fresh isolate, so the memos cannot persist. The handler
  // must therefore tolerate a database whose tables do not exist yet instead of
  // logging an error every minute.
  assert.match(body, /42P01/, 'the sweep must treat a missing schema as a quiet skip, not an error');
});

test('the Vercel cron route uses the raw client and never bootstraps the schema', async () => {
  const source = await readFile(new URL('vercel/api/index.js', templateRoot), 'utf8');
  const route = /app\.get\('\/api\/internal\/payment-sweeps'[\s\S]*?\n\}\)\);/.exec(source);
  assert.ok(route, 'the Vercel runtime must expose the payment-sweeps cron route');
  const body = route[0];
  assert.match(body, /runPaymentReminderChecks\(createNeonClient\(process\.env\.DATABASE_URL\), SITE_ID\)/,
    'the sweep must use the raw Neon client');
  assert.doesNotMatch(body, /runPaymentReminderChecks\(getDb\(\)/,
    'getDb() wraps every query in ensureSiteRow() -> ensureSchema()');
  assert.match(body, /CRON_SECRET/, 'the route must still require the cron secret');
  assert.match(body, /timingSafeEqual/, 'the cron secret must be compared in constant time');
  assert.match(body, /42P01/, 'a missing schema must answer as an empty successful sweep, not a 503');
});

test('the standalone reminder worker keeps its documented 90s / 180s cadence', async () => {
  // current_code.md §6 documents these two intervals; both target packages ship
  // their own copy, so check both. This worker already used the raw client,
  // which is the pattern the two cron handlers were fixed to follow.
  for (const target of ['cloudflare', 'vercel']) {
    const worker = await readFile(new URL(`${target}/payment-reminder-worker.js`, templateRoot), 'utf8');
    assert.match(worker, /const REMINDER_INTERVAL_MS = 90_000;/, `${target} client-reminder interval must stay 90s`);
    assert.match(worker, /const OWNER_FOLLOWUP_INTERVAL_MS = 180_000;/, `${target} owner-follow-up interval must stay 180s`);
    assert.match(worker, /createNeonClient\(process\.env\.DATABASE_URL\)/, `${target} worker must use the raw client`);
    assert.doesNotMatch(worker, /ensureSchema|ensureSiteRow|getDb\(\)|SCHEMA_STATEMENTS/,
      `${target} worker must not bootstrap the schema on a timer`);
    assert.match(worker, /reminderBusy/, `${target} worker must guard against overlapping reminder ticks`);
    assert.match(worker, /ownerFollowupBusy/, `${target} worker must guard against overlapping follow-up ticks`);
  }
});

test('the scheduler cadences documented in current_code.md match the shipped config', async () => {
  const docs = await readFile(new URL('../current_code.md', import.meta.url), 'utf8');
  const wrangler = await readFile(new URL('cloudflare/wrangler.jsonc', templateRoot), 'utf8');
  const vercelJson = JSON.parse(await readFile(new URL('vercel/vercel.json', templateRoot), 'utf8'));
  // Cloudflare: documented as `* * * * *`, every minute.
  assert.match(wrangler, /"crons": \["\* \* \* \* \*"\]/, 'the Cloudflare cron must stay every minute');
  assert.match(docs, /Cloudflare Workers:\*\* `wrangler\.jsonc` registers a `\* \* \* \* \*` cron trigger/,
    'current_code.md must keep documenting the every-minute Cloudflare cron');
  // Vercel: documented as daily at 00:00 UTC so Hobby can deploy it.
  assert.equal(vercelJson.crons.length, 1);
  assert.equal(vercelJson.crons[0].path, '/api/internal/payment-sweeps');
  assert.equal(vercelJson.crons[0].schedule, '0 0 * * *', 'the Vercel cron must stay daily for Hobby compatibility');
  assert.match(docs, /schedules `GET \/api\/internal\/payment-sweeps` \*\*once daily at `0 0 \* \* \*` \(00:00 UTC\)\*\*/,
    'current_code.md must keep documenting the daily Vercel cron');
  // The standalone worker cadence the docs promise.
  assert.match(docs, /90-second client-reminder checks and 180-second dropped-booking checks/,
    'current_code.md must keep documenting the standalone worker intervals');
});

test('the sweep drops only unpaid bookings past the 15-minute window, and stamps the owner notification', async () => {
  // Rule (changed 2026-10-15): the reminder statement only stamps its marker
  // and must never cancel; the drop statement is the ONLY automatic
  // cancellation in the system, and it must stamp payment_owner_attention_at
  // in the same statement — that stamp is the owner's notification.
  const { client, statements } = fakeClient();
  await runPaymentReminderChecks(client, SITE_ID);
  assert.equal(statements.length, 2);
  const [reminder, drop] = statements.map((statement) => statement.text);
  assert.doesNotMatch(reminder, /\bstatus\s*=\s*'cancelled'/, 'the reminder must not cancel');
  assert.match(reminder, /SET payment_reminder_sent_at = now\(\)/, 'the reminder only stamps its marker');
  assert.match(drop, /SET status = 'cancelled',\s*payment_status = 'expired',\s*payment_owner_attention_at = now\(\)/,
    'the drop must cancel, expire, and stamp the owner notification atomically');
  for (const statement of statements) {
    assert.doesNotMatch(statement.text, /DELETE FROM/, 'the sweep must not delete rows');
    assert.match(statement.text, /AND appointment\.status <> 'cancelled'/, 'cancelled bookings must be excluded');
    assert.match(statement.text, /NOT EXISTS \(\s*SELECT 1 FROM tele_appointment_payment_proofs/,
      'a booking with a proof must never be touched');
  }
  // Client reminder: 12 minutes after creation, awaiting proof, or approved
  // manually by the owner with no screenshot attached.
  assert.match(reminder, /created_at <= now\(\) - interval '12 minutes'/);
  assert.match(reminder, /payment_status = 'awaiting_proof'[\s\S]*payment_status = 'approved' AND appointment\.payment_manual_received_at IS NOT NULL/);
  // Drop: keyed off payment_due_at (booking + 15 minutes), awaiting proof only.
  assert.match(drop, /payment_due_at <= now\(\)/);
  assert.match(drop, /payment_status = 'awaiting_proof'/);
});

