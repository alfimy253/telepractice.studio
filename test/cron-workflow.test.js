// End-to-end cron workflow test against a real Postgres (PGlite).
//
// The question this answers: when the scheduler fires, can it break a client
// who is booking, or who clicks "Upload payment proof"? The sweep only stamps
// two marker columns, but the client reminder (created_at + 12 min) and the
// owner follow-up (payment_due_at = booking time + 15 min) land exactly in
// the window where a real client is still paying, so the ordering is tested,
// not assumed.
//
// Nothing here re-types the SQL. The booking and payment-proof statements are
// extracted from the shipped Cloudflare template, parameterised, and executed
// verbatim; the schema is the generated package's own SCHEMA_STATEMENTS; the
// sweep is the shared runPaymentReminderChecks() the cron handlers call.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { generateBundle } from '../public/package-core.js';
import { runPaymentReminderChecks } from '../public/_scaffold/templates/shared/lib/payment-reminders.js';

const SITE_ID = 'cron-workflow';
const TIME_ZONE = 'Asia/Manila';
// 1x1 PNG. Must satisfy CHECK (length(image_base64) BETWEEN 16 AND 4194304).
const PROOF_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function extractTemplate(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `template marker not found: ${marker}`);
  return source.slice(source.lastIndexOf('`', at) + 1, source.indexOf('`', at));
}

function parameterize(raw) {
  const exprs = [];
  const text = raw.replace(/\$\{([^}]*)\}/g, (_, expr) => { exprs.push(expr.trim()); return `$${exprs.length}`; });
  return { text, exprs };
}

// Resolve a template expression (${SITE_ID}, ${client.id}, ...) to a value.
function resolve(exprs, context) {
  return exprs.map((expr) => {
    switch (expr) {
      case 'SITE_ID': return SITE_ID;
      case 'client.id': return context.clientId;
      case 'client.name': return 'Workflow Client';
      case 'client.email': return 'workflow@example.test';
      case 'client.phone': return '+639000000000';
      case 'service': return 'Consultation';
      case 'context': return '';
      case 'paymentMethod': return 'gcash';
      case 'slotId': return context.slotId;
      case 'phone': return '+639171234567';
      case 'id': return context.appointmentId;
      case 'contentType': return 'image/png';
      case 'imageBase64': return PROOF_BASE64;
      case 'localToday()': return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      case 'SITE_TIME_ZONE': case 'siteTimeZone': return TIME_ZONE;
      default: throw new Error(`unmapped template expression: ${expr}`);
    }
  });
}

let db;
let bookingSql;
let proofSql;
let clientId;
let monthStart;
let slotDate;

function taggedSql(strings, ...values) {
  let text = '';
  strings.forEach((part, index) => { text += part; if (index < values.length) text += `$${index + 1}`; });
  return db.query(text, values).then((result) => result.rows);
}

async function makeSlot(time) {
  const { rows } = await db.query(
    `INSERT INTO tele_consultation_slots (site_id, month_start, slot_date, slot_time, is_open) VALUES ($1,$2,$3,$4,true) RETURNING id`,
    [SITE_ID, monthStart, slotDate, time]
  );
  return rows[0].id;
}

async function book(slotId) {
  const { rows } = await db.query(bookingSql.text, resolve(bookingSql.exprs, { clientId, slotId }));
  assert.equal(rows.length, 1, 'booking must return the new appointment');
  return rows[0].id;
}

async function uploadProof(appointmentId) {
  const { rows } = await db.query(proofSql.text, resolve(proofSql.exprs, { clientId, appointmentId }));
  return rows;
}

async function appointmentState(id) {
  const { rows } = await db.query(
    `SELECT status, payment_status, payment_reminder_sent_at IS NOT NULL AS reminded, payment_owner_attention_at IS NOT NULL AS owner_flagged FROM tele_appointments WHERE id = $1`,
    [id]
  );
  return rows[0];
}

const sweep = () => runPaymentReminderChecks(taggedSql, SITE_ID);

before(async () => {
  const source = await readFile(new URL('../public/_scaffold/templates/cloudflare/src/index.js', import.meta.url), 'utf8');
  bookingSql = parameterize(extractTemplate(source, 'INSERT INTO tele_appointments (site_id, client_account_id, availability_slot_id'));
  proofSql = parameterize(extractTemplate(source, 'WITH target AS ('));

  db = new PGlite();
  // Apply the exact schema statements the generated Worker runs, so the
  // splitter that understands the DO $$ blocks is the production one.
  const readTemplate = async (file) => readFile(new URL(`../public/_scaffold/templates/${file}`, import.meta.url), 'utf8');
  const { buffer } = await generateBundle({
    target: 'cloudflare', specialty: 'dental', businessName: 'Cron Workflow', theme: 'canopy',
    timeZone: TIME_ZONE, adminUsername: 'practiceowner', adminEmail: 'owner@example.test',
    adminPassword: 'CanopyOwner!8', databaseUrl: 'postgres://u:p@h.neon.tech/db'
  }, readTemplate);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  let generated = '';
  while (offset + 30 <= buffer.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(buffer.subarray(offset + 30, offset + 30 + nameLength));
    if (name === 'src/index.js') generated = decoder.decode(buffer.subarray(offset + 30 + nameLength + extraLength, offset + 30 + nameLength + extraLength + size));
    offset += 30 + nameLength + extraLength + size;
  }
  const schemaLine = generated.split('\n').find((line) => line.startsWith('const SCHEMA_STATEMENTS'));
  const statements = JSON.parse(schemaLine.replace('const SCHEMA_STATEMENTS = ', '').replace(/;\s*$/, ''));
  assert.equal(statements.length, 59);
  for (const statement of statements) await db.exec(statement);

  slotDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  monthStart = `${slotDate.slice(0, 8)}01`;
  await db.query(`INSERT INTO tele_sites (site_id, config) VALUES ($1, '{}'::jsonb)`, [SITE_ID]);
  await db.query(`INSERT INTO tele_monthly_schedules (site_id, month_start, status) VALUES ($1,$2,'published')`, [SITE_ID, monthStart]);
  const client = await db.query(
    `INSERT INTO tele_client_accounts (site_id, full_name, email, phone, password_hash) VALUES ($1,'Workflow Client','workflow@example.test','+639000000000','pbkdf2$x') RETURNING id`,
    [SITE_ID]
  );
  clientId = client.rows[0].id;
});

test('booking, then the 12-minute cron reminder, then the pay button', async () => {
  const id = await book(await makeSlot('09:00'));

  // A cron tick in the first minutes after booking must touch nothing: the
  // reminder needs created_at <= now() - 12 minutes.
  let result = await sweep();
  assert.equal(result.reminders.length, 0);
  assert.equal(result.dropped.length, 0);

  // Twelve minutes pass with no proof. On Cloudflare the next tick (at most a
  // minute later) stamps the client reminder.
  await db.query(`UPDATE tele_appointments SET created_at = now() - interval '13 minutes' WHERE id = $1`, [id]);
  result = await sweep();
  assert.equal(result.reminders.length, 1);
  assert.equal(result.reminders[0].id, id);
  assert.equal(result.dropped.length, 0, 'the drop waits for payment_due_at (booking + 15 min)');

  // The client now clicks Upload payment proof. The stamped marker must not
  // reject it: the proof route does not test payment_reminder_sent_at.
  const uploaded = await uploadProof(id);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].status, 'pending_review');
  const state = await appointmentState(id);
  assert.equal(state.payment_status, 'pending_review');
  assert.equal(state.status, 'confirmed');

  result = await sweep();
  assert.equal(result.reminders.length, 0);
  assert.equal(result.dropped.length, 0);
});

test('a booking with no proof is dropped at 15 minutes, and a late upload is rejected', async () => {
  const id = await book(await makeSlot('10:00'));

  // Twenty minutes pass with no proof. One sweep stamps the client reminder
  // AND drops the booking, because payment_due_at (booking + 15 minutes) has
  // passed. The drop stamps payment_owner_attention_at in the same statement:
  // that stamp is the owner notification the dashboard reads.
  await db.query(`UPDATE tele_appointments SET created_at = now() - interval '20 minutes', payment_due_at = now() - interval '5 minutes' WHERE id = $1`, [id]);
  const result = await sweep();
  assert.equal(result.reminders.length, 1);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].id, id);
  const flagged = await appointmentState(id);
  assert.equal(flagged.reminded, true);
  assert.equal(flagged.owner_flagged, true, 'the drop must stamp the owner notification marker');
  assert.equal(flagged.status, 'cancelled');
  assert.equal(flagged.payment_status, 'expired');

  // The slot is released, so a late upload can no longer attach: the proof
  // statement matches nothing (the route turns this into a 409 telling the
  // client the practice released the booking).
  const uploaded = await uploadProof(id);
  assert.equal(uploaded.length, 0, 'a dropped booking must not accept a proof');

  // Further sweeps are no-ops for the dropped booking.
  const again = await sweep();
  assert.equal(again.reminders.length, 0);
  assert.equal(again.dropped.length, 0);
});

test('a new booking lands while a due sweep is running', async () => {
  const dueId = await book(await makeSlot('11:00'));
  await db.query(`UPDATE tele_appointments SET created_at = now() - interval '13 minutes' WHERE id = $1`, [dueId]);

  const freshSlot = await makeSlot('13:00');
  const [result, freshId] = await Promise.all([
    sweep(),
    book(freshSlot)
  ]);
  assert.equal(result.reminders.length, 1);
  assert.equal(result.reminders[0].id, dueId);
  assert.ok(freshId, 'concurrent booking must succeed');
  assert.equal((await appointmentState(freshId)).payment_status, 'awaiting_proof');
});

test('both shipped runtime templates parse as valid JavaScript', async () => {
  // A duplicated fragment once landed after the Cloudflare export's closing
  // brace (and after Vercel's `export default app;`), leaving both templates
  // syntactically broken while every test still passed — nothing parsed the
  // files a generated ZIP actually ships. Parse them.
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(`${tmpdir()}/runtime-syntax-`);
  for (const relative of ['cloudflare/src/index.js', 'vercel/api/index.js']) {
    const source = await readFile(new URL(`../public/_scaffold/templates/${relative}`, import.meta.url), 'utf8');
    const file = `${dir}/${relative.replaceAll('/', '-')}.mjs`;
    await writeFile(file, source);
    await new Promise((resolve, reject) => {
      execFile(process.execPath, ['--check', file], (error, _stdout, stderr) => {
        if (error) reject(new Error(`${relative} does not parse: ${stderr}`));
        else resolve();
      });
    });
  }
});

test('the Vercel runtime ships the same booking and payment-proof SQL', async () => {
  const vercel = await readFile(new URL('../public/_scaffold/templates/vercel/api/index.js', import.meta.url), 'utf8');
  const strip = (raw) => raw.replace(/\$\{[^}]*\}/g, '?').replace(/\s+/g, ' ').trim();
  assert.equal(
    strip(extractTemplate(vercel, 'INSERT INTO tele_appointments (site_id, client_account_id, availability_slot_id')),
    strip(extractTemplate(await readFile(new URL('../public/_scaffold/templates/cloudflare/src/index.js', import.meta.url), 'utf8'), 'INSERT INTO tele_appointments (site_id, client_account_id, availability_slot_id'))
  );
  assert.equal(
    strip(extractTemplate(vercel, 'WITH target AS (')),
    strip(proofSql.text.replace(/\$\d+/g, '?'))
  );
});
