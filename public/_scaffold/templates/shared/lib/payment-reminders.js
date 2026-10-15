// Shared payment-reminder sweeps. Both generated runtimes call
// runPaymentReminderChecks() from their native scheduler (Cloudflare
// `scheduled()`, the Vercel cron route) and the standalone Node worker calls
// the two mark* helpers directly on its own timers.
//
// Every table here carries the `tele_` prefix, matching db/schema.sql and the
// rest of the package: an unprefixed name does not exist in the generated
// database and the sweep fails with 42P01 instead of marking anything.
// test/sql-identifiers.test.js enforces that.
//
// The sweep has exactly two jobs:
//   1. Remind the client (payment_reminder_sent_at) once a booking is
//      12 minutes old and still has no payment proof.
//   2. Drop the booking (status 'cancelled', payment_status 'expired') once
//      the 15-minute payment window (payment_due_at) has passed with no
//      proof uploaded, stamping payment_owner_attention_at in the same
//      statement. That stamp is the owner notification: the dashboard's
//      "Dropped bookings" list is built from it the moment the sweep commits,
//      and the client sees the release ('Slot released') in their own
//      appointment list. No other code path cancels a booking automatically.
async function markPaymentProofReminders(sql, siteId) {
  return sql`
    UPDATE tele_appointments AS appointment
    SET payment_reminder_sent_at = now()
    WHERE appointment.site_id = ${siteId}
      AND appointment.status <> 'cancelled'
      AND (
        appointment.payment_status = 'awaiting_proof'
        OR (appointment.payment_status = 'approved' AND appointment.payment_manual_received_at IS NOT NULL)
      )
      AND appointment.payment_reminder_sent_at IS NULL
      AND appointment.created_at <= now() - interval '12 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM tele_appointment_payment_proofs AS proof
        WHERE proof.site_id = appointment.site_id AND proof.appointment_id = appointment.id
      )
    RETURNING appointment.id, appointment.client_account_id
  `;
}

async function markDroppedBookings(sql, siteId) {
  return sql`
    UPDATE tele_appointments AS appointment
    SET status = 'cancelled',
        payment_status = 'expired',
        payment_owner_attention_at = now()
    WHERE appointment.site_id = ${siteId}
      AND appointment.status <> 'cancelled'
      AND appointment.payment_status = 'awaiting_proof'
      AND appointment.payment_owner_attention_at IS NULL
      AND appointment.payment_due_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM tele_appointment_payment_proofs AS proof
        WHERE proof.site_id = appointment.site_id AND proof.appointment_id = appointment.id
      )
    RETURNING appointment.id, appointment.client_account_id
  `;
}

async function runPaymentReminderChecks(sql, siteId) {
  const reminders = await markPaymentProofReminders(sql, siteId);
  const dropped = await markDroppedBookings(sql, siteId);
  return { reminders, dropped };
}

export { markDroppedBookings, markPaymentProofReminders, runPaymentReminderChecks };
