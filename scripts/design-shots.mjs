/* global process, console */
// Captures the design review screenshots: every main screen at 375 px wide, in light and dark mode.
//   npm run design:shots -- 2        (the stage number names the folder: docs/design-review/stage-2)
import { spawnSync } from 'node:child_process';

const stage = process.argv[2] ?? '0';
const result = spawnSync('npx', ['playwright', 'test', '--project=review', '--workers=1'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DESIGN_STAGE: stage },
});
if (result.status === 0) console.log(`Screenshots are in docs/design-review/stage-${stage}/light and /dark`);
process.exit(result.status ?? 1);
