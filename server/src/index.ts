import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { aiStartupWarnings, env } from './config/env.js';
import { startScheduledJobs } from './jobs/scheduler.js';

async function main() {
  for (const warning of aiStartupWarnings(env.ai, env.isProduction)) console.warn(`WARNING: ${warning}`);
  await connectDatabase();
  createApp().listen(env.port, () => console.log(`API listening on http://localhost:${env.port}/api`));
  startScheduledJobs(env.jobsEnabled);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
