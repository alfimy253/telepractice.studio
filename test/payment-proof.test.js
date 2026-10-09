import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_PAYMENT_PROOF_BYTES,
  PAYMENT_PROOF_MIME_TYPES,
  detectPaymentProofMime,
  paymentProofFromBase64,
  paymentProofToBase64
} from '../public/_scaffold/templates/shared/lib/payment-proof.js';

const templateRoot = new URL('../public/_scaffold/templates/', import.meta.url);

function bytes(...values) { return new Uint8Array(values); }

test('payment proof helper recognizes only supported image signatures', () => {
  assert.deepEqual(PAYMENT_PROOF_MIME_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(MAX_PAYMENT_PROOF_BYTES, 3 * 1024 * 1024);
  assert.equal(detectPaymentProofMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
  assert.equal(detectPaymentProofMime(bytes(0xff, 0xd8, 0xff, 0x00)), 'image/jpeg');
  assert.equal(detectPaymentProofMime(bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50)), 'image/webp');
  assert.equal(detectPaymentProofMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), '');
});

test('payment proof base64 helpers round-trip binary data without changing bytes', () => {
  const original = bytes(0, 1, 127, 128, 200, 255);
  const encoded = paymentProofToBase64(original);
  assert.equal(typeof encoded, 'string');
  assert.deepEqual(paymentProofFromBase64(encoded), original);
});

test('both generated runtimes preserve bookings and support the 12/15-minute reminder flow', async () => {
  const [vercel, cloudflare, schema, reminders, worker, wranglerConfig, vercelConfig, appointments, clientScript, adminScript, adminHtml] = await Promise.all([
    readFile(new URL('vercel/api/index.js', templateRoot), 'utf8'),
    readFile(new URL('cloudflare/src/index.js', templateRoot), 'utf8'),
    readFile(new URL('shared/db/schema.sql', templateRoot), 'utf8'),
    readFile(new URL('shared/lib/payment-reminders.js', templateRoot), 'utf8'),
    readFile(new URL('vercel/payment-reminder-worker.js', templateRoot), 'utf8'),
    readFile(new URL('cloudflare/wrangler.jsonc', templateRoot), 'utf8'),
    readFile(new URL('vercel/vercel.json', templateRoot), 'utf8'),
    readFile(new URL('shared/public/appointments.html', templateRoot), 'utf8'),
    readFile(new URL('shared/public/appointments.js', templateRoot), 'utf8'),
    readFile(new URL('shared/public/admin.js', templateRoot), 'utf8'),
    readFile(new URL('shared/public/admin.html', templateRoot), 'utf8')
  ]);

  for (const runtime of [vercel, cloudflare]) {
    assert.match(runtime, /now\(\) \+ interval '15 minutes'/);
    assert.match(runtime, /payment_status = 'awaiting_proof'/);
    assert.match(runtime, /payment_manual_received_at = now\(\)/);
    assert.match(runtime, /paymentManualReceivedAt/);
    assert.match(runtime, /payment_status = 'approved' AND appointment\.payment_manual_received_at IS NOT NULL/);
    assert.match(runtime, /CASE WHEN target\.payment_status = 'approved' THEN 'approved' ELSE 'pending_review' END/);
    assert.match(runtime, /appointment_payment_proofs/);
    assert.match(runtime, /runPaymentReminderChecks/);
    assert.match(runtime, /payment-proofs/);
    assert.match(runtime, /Cache-Control['"]?[, :]+['"]private, no-store/);
    assert.match(runtime, /review_status = 'approved'/);
    assert.match(runtime, /payment_status = 'rejected', status = 'cancelled'/);
    assert.doesNotMatch(runtime, /expireUnpaidAppointments/);
  }
  assert.match(reminders, /interval '12 minutes'/);
  assert.match(reminders, /payment_owner_attention_at = now\(\)/);
  assert.match(reminders, /payment_due_at <= now\(\)/);
  assert.match(reminders, /payment_status = 'approved' AND appointment\.payment_manual_received_at IS NOT NULL/);
  assert.doesNotMatch(reminders, /SET status = 'cancelled'/);
  assert.match(worker, /90_000/);
  assert.match(worker, /180_000/);
  assert.match(wranglerConfig, /\"crons\": \[\"\* \* \* \* \*\"\]/);
  assert.match(cloudflare, /const MAX_JSON_BYTES = 256 \* 1024/);
  assert.match(cloudflare, /request\.body\?\.getReader\(\)/);
  assert.match(cloudflare, /total > MAX_JSON_BYTES/);
  assert.match(vercelConfig, /\"path\": \"\/api\/internal\/payment-sweeps\", \"schedule\": \"0 0 \* \* \*\"/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS appointment_payment_proofs/);
  assert.match(schema, /image_base64 text NOT NULL/);
  assert.match(schema, /payment_reminder_sent_at timestamptz/);
  assert.match(schema, /payment_owner_attention_at timestamptz/);
  assert.match(schema, /payment_manual_received_at timestamptz/);
  assert.match(appointments, /Payment screenshots are stored privately and visible only to the practice owner/);
  assert.match(appointments, /within 15 minutes/);
  assert.match(appointments, /remind you after 12 minutes/);
  assert.match(clientScript, /\/api\/client\/appointments\/\$\{encodeURIComponent\(appointmentId\)\}\/payment-proof/);
  assert.match(clientScript, /PAYMENT_PROOF_MIME_TYPES/);
  assert.match(clientScript, /paymentReminderSentAt/);
  assert.match(clientScript, /manuallyReceivedWithoutProof/);
  assert.match(clientScript, /Payment received · proof reminder/);
  assert.match(clientScript, /remains scheduled/);
  assert.match(adminHtml, /Bookings Without Payments/);
  assert.match(adminHtml, /data-payment-tab="payments">Payments/);
  assert.match(adminScript, /relativeElapsed\(payment\.uploadedAt\)/);
  assert.match(adminScript, /togglePaymentPreview/);
  assert.match(adminScript, /reviewPaymentProof/);
  assert.match(adminScript, /Release booking/);
  assert.match(adminScript, /Mark received/);
});
