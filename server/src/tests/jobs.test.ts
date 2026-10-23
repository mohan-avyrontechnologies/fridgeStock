import cron from 'node-cron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobsEnabledFrom } from '../config/env.js';
import { startScheduledJobs } from '../jobs/scheduler.js';

/**
 * JOBS_ENABLED: while two servers share one database (Node and Python, during the fallback period), exactly
 * one of them runs the scheduled jobs. See docs/PYTHON_MIGRATION.md.
 */
describe('JOBS_ENABLED', () => {
  afterEach(async () => {
    for (const task of cron.getTasks().values()) await task.destroy();
  });

  it('is on when unset, and reads the usual on and off words', () => {
    for (const value of [undefined, '', 'true', 'TRUE', '1', 'on', 'yes', ' true ']) {
      expect(jobsEnabledFrom(value), String(value)).toBe(true);
    }
    for (const value of ['false', 'False', '0', 'off', 'no']) expect(jobsEnabledFrom(value), value).toBe(false);
  });

  it('stops the server on anything else, so a typo never leaves reminders unsent', () => {
    expect(() => jobsEnabledFrom('flase')).toThrow('JOBS_ENABLED must be "true" or "false" (got "flase").');
  });

  it('switched off, starts no job at all and says so', () => {
    const log = vi.fn();
    expect(startScheduledJobs(false, log)).toEqual([]);
    expect(cron.getTasks().size).toBe(0);
    expect(log).toHaveBeenCalledWith('Scheduled jobs are off on this server (JOBS_ENABLED=false).');
  });

  it('switched on, starts the reminder sweep and the photo clean-up', () => {
    const log = vi.fn();
    const tasks = startScheduledJobs(true, log);
    expect(tasks.map((task) => task.name).sort()).toEqual(['photo-cleanup', 'reminder-sweep']);
    expect(log).not.toHaveBeenCalled();
  });
});
