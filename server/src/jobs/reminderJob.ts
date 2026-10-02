import cron, { type ScheduledTask } from 'node-cron';
import { sweep } from '../services/notificationService.js';

/** Every 5 minutes: deliver reminders whose day has arrived, and meal reminders when their time comes. */
export const REMINDER_SCHEDULE = '*/5 * * * *';

export async function runReminderSweep(): Promise<void> {
  try {
    await sweep();
  } catch (error) {
    console.error('Reminder sweep failed', error);
  }
}

/** Starts the scheduled job and runs one sweep straight away. */
export function startReminderJob(): ScheduledTask {
  void runReminderSweep();
  return cron.schedule(REMINDER_SCHEDULE, runReminderSweep, { name: 'reminder-sweep', noOverlap: true });
}
