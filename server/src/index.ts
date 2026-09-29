import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { startReminderJob } from './jobs/reminderJob.js';

async function main() {
  await connectDatabase();
  createApp().listen(env.port, () => console.log(`API listening on http://localhost:${env.port}/api`));
  startReminderJob();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
