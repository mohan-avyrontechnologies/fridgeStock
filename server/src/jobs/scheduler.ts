import type { ScheduledTask } from 'node-cron';
import { startPhotoJob } from './photoJob.js';
import { startReminderJob } from './reminderJob.js';

/**
 * Starts the scheduled jobs, unless this server has them switched off (JOBS_ENABLED=false). Exactly one
 * server sharing a database may run them: see docs/PYTHON_MIGRATION.md for which one at each stage.
 */
export function startScheduledJobs(enabled: boolean, log: (message: string) => void = console.log): ScheduledTask[] {
  if (!enabled) {
    log('Scheduled jobs are off on this server (JOBS_ENABLED=false).');
    return [];
  }
  return [startReminderJob(), startPhotoJob()];
}
