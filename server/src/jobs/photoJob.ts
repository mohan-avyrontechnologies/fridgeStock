import cron, { type ScheduledTask } from 'node-cron';
import { purgeClosedPhotos } from '../services/foodPhotoService.js';

/** Daily at 03:30 server time: delete the photos of food closed more than 30 days ago. */
export const PHOTO_CLEANUP_SCHEDULE = '30 3 * * *';

export async function runPhotoCleanup(): Promise<void> {
  try {
    await purgeClosedPhotos();
  } catch (error) {
    console.error('Photo cleanup failed', error);
  }
}

/** Starts the scheduled job and runs one clean-up straight away (so a server that was off for days catches up). */
export function startPhotoJob(): ScheduledTask {
  void runPhotoCleanup();
  return cron.schedule(PHOTO_CLEANUP_SCHEDULE, runPhotoCleanup, { name: 'photo-cleanup', noOverlap: true });
}
