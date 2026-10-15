import { createNeonClient } from './db/connection.js';
import { markDroppedBookings, markPaymentProofReminders } from './lib/payment-reminders.js';

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
        const rows = await markDroppedBookings(sql, SITE_ID);
        if (rows.length) console.info(`[payment-reminders] ${rows.length} booking(s) dropped (no payment proof within 15 minutes); owner notified in the dashboard, client notified in their appointment list`);
      } catch (error) { console.error('[payment-reminders] booking drop check failed', error); }
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
console.info('[payment-reminders] worker started: 90-second client reminders, 3-minute dropped-booking checks');
