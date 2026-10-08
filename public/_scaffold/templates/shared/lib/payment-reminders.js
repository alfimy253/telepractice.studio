async function markPaymentProofReminders(sql, siteId) {
  return sql`
    UPDATE appointments AS appointment
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
        SELECT 1 FROM appointment_payment_proofs AS proof
        WHERE proof.site_id = appointment.site_id AND proof.appointment_id = appointment.id
      )
    RETURNING appointment.id, appointment.client_account_id
  `;
}

async function markPaymentOwnerFollowups(sql, siteId) {
  return sql`
    UPDATE appointments AS appointment
    SET payment_owner_attention_at = now()
    WHERE appointment.site_id = ${siteId}
      AND appointment.status <> 'cancelled'
      AND appointment.payment_status = 'awaiting_proof'
      AND appointment.payment_owner_attention_at IS NULL
      AND appointment.payment_due_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM appointment_payment_proofs AS proof
        WHERE proof.site_id = appointment.site_id AND proof.appointment_id = appointment.id
      )
    RETURNING appointment.id, appointment.client_account_id
  `;
}

async function runPaymentReminderChecks(sql, siteId) {
  const reminders = await markPaymentProofReminders(sql, siteId);
  const ownerFollowups = await markPaymentOwnerFollowups(sql, siteId);
  return { reminders, ownerFollowups };
}

export { markPaymentOwnerFollowups, markPaymentProofReminders, runPaymentReminderChecks };
