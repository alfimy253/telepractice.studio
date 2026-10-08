import { createNeonClient } from './db/connection.js';
import { markPaymentOwnerFollowups, markPaymentProofReminders } from './lib/payment-reminders.js';

const SITE_ID = '__SITE_ID__';
const REMINDER_INTERVAL_MS = 90_000;
const OWNER_FOLLOWUP_INTERVAL_MS = 180_000;

function createChecks() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before starting the payment reminder worker.');
  const sql = createNeonClient(process.env.DATABASE_URL);
  let reminderBusy = false;
  let ownerFollowupBusy = false;

  return {
    async reminders() {
      if (reminderBusy) return;
      reminderBusy = true;
      try {
        const rows = await markPaymentProofReminders(sql, SITE_ID);
        if (rows.length) console.info(`[payment-reminders] notified ${rows.length} client dashboard(s)`);
      } catch (error) { console.error('[payment-reminders] reminder check failed', error); }
      finally { reminderBusy = false; }
    },
    async ownerFollowups() {
      if (ownerFollowupBusy) return;
      ownerFollowupBusy = true;
      try {
        const rows = await markPaymentOwnerFollowups(sql, SITE_ID);
        if (rows.length) console.info(`[payment-reminders] ${rows.length} unpaid booking(s) need owner review`);
      } catch (error) { console.error('[payment-reminders] owner follow-up check failed', error); }
      finally { ownerFollowupBusy = false; }
    }
  };
}

const checks = createChecks();
const reminderTimer = setInterval(checks.reminders, REMINDER_INTERVAL_MS);
const ownerFollowupTimer = setInterval(checks.ownerFollowups, OWNER_FOLLOWUP_INTERVAL_MS);
void checks.reminders();
void checks.ownerFollowups();

function stop() {
  clearInterval(reminderTimer);
  clearInterval(ownerFollowupTimer);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
console.info('[payment-reminders] worker started: 90-second client reminders, 3-minute owner follow-ups');
