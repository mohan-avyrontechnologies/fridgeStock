import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REMINDER_SCHEDULE } from '../jobs/reminderJob.js';

/** Architecture rules for server/src, checked against the source itself. */
const SRC = path.resolve('src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const rel = (file: string) => path.relative(SRC, file).replaceAll('\\', '/');
const appFiles = files(SRC).filter((f) => f.endsWith('.ts') && !rel(f).startsWith('tests/'));
const source = (file: string) => readFileSync(file, 'utf8');
const imports = (file: string) => [...source(file).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('server/src layout', () => {
  it('has the agreed folders plus copy.ts, app.ts and index.ts', () => {
    for (const dir of ['config', 'middleware', 'models', 'services', 'controllers', 'routes', 'jobs', 'tests']) {
      expect(statSync(path.join(SRC, dir)).isDirectory(), dir).toBe(true);
    }
    expect(existsSync(path.join(SRC, 'copy.ts'))).toBe(true);
    const topLevel = readdirSync(SRC).filter((name) => statSync(path.join(SRC, name)).isDirectory());
    expect(topLevel.sort()).toEqual(['config', 'controllers', 'jobs', 'middleware', 'models', 'routes', 'services', 'tests']);
  });
});

describe('request flow: routes → middleware → controllers → services → models', () => {
  it('controllers are thin: they never import models, mongoose or another controller', () => {
    for (const file of appFiles.filter((f) => rel(f).startsWith('controllers/'))) {
      for (const spec of imports(file)) {
        expect(spec, rel(file)).not.toMatch(/\/models\/|^mongoose$|^mongodb$|\/controllers\//);
      }
    }
  });

  it('controllers contain no business logic: every handler just calls a service and responds', () => {
    for (const file of appFiles.filter((f) => rel(f).startsWith('controllers/'))) {
      const code = stripComments(source(file));
      expect(code, rel(file)).not.toMatch(/\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|\bthrow\b|\.find\(|\.save\(/);
    }
  });

  it('routes only wire paths to middleware and controllers', () => {
    for (const spec of imports(path.join(SRC, 'routes/index.ts'))) {
      expect(spec).not.toMatch(/\/models\/|\/services\/|^mongoose$/);
    }
  });

  it('only models (and the connection in config/db.ts) talk to MongoDB directly', () => {
    for (const file of appFiles) {
      const r = rel(file);
      if (r.startsWith('models/') || r === 'config/db.ts') continue;
      const code = stripComments(source(file));
      expect(imports(file), r).not.toContain('mongodb');
      expect(code, r).not.toMatch(/mongoose\.(connection|connect|model)\b|\.collection\./);
    }
  });
});

describe('dates', () => {
  it('server code never calls new Date() or Date.now() for date logic (only services/clock.ts may)', () => {
    const offenders = appFiles
      .filter((f) => rel(f) !== 'services/clock.ts')
      .filter((f) => /new Date\(\s*\)|Date\.now\(/.test(stripComments(source(f))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('date helpers come from @cook-first/shared, not local copies', () => {
    for (const file of appFiles) {
      expect(stripComments(source(file)), rel(file)).not.toMatch(/function\s+(addDays|diffDays|todayInTz|isValidDate|formatDisplay)\b/);
    }
  });
});

describe('urgency threshold', () => {
  const REPO = path.resolve('..');
  const everySourceFile = [
    ...appFiles,
    ...files(path.join(REPO, 'client/src')).filter((f) => /\.tsx?$/.test(f) && !/[\\/](test|mocks)[\\/]/.test(f)),
    ...files(path.join(REPO, 'shared/src')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')),
  ];

  it('is defined once, as APPROACHING_EXPIRY_DAYS in config/urgency.ts', () => {
    expect(source(path.join(SRC, 'config/urgency.ts'))).toMatch(/export const APPROACHING_EXPIRY_DAYS = 3;/);
  });

  it('is not hard-coded anywhere else in client, server or shared', () => {
    // Comparisons with 3, "3 days", or ±3 day offsets.
    const hardCoded = /[<>]=?\s*3\b|\b3\s*(day|days)\b|addDays\([^)]*,\s*-?3\s*\)|useSoonDays/i;
    const offenders = everySourceFile
      .filter((f) => path.resolve(f) !== path.join(SRC, 'config/urgency.ts'))
      .filter((f) => hardCoded.test(stripComments(source(f))))
      .map((f) => path.relative(REPO, f));
    expect(offenders).toEqual([]);
  });
});

describe('expiry date', () => {
  it('is calculated in the food service, not by a Mongoose hook', () => {
    const model = stripComments(source(path.join(SRC, 'models/FoodItem.ts')));
    expect(model).not.toMatch(/\.pre\(|\.post\(|addDays/);
    const service = source(path.join(SRC, 'services/foodService.ts'));
    expect(service).toMatch(/expiryDate: expiryFor\(addedDate, lifespanDays\)/);
    expect(service).toMatch(/food\.expiryDate = expiryFor\(/);
  });
});

describe('scheduled jobs', () => {
  it('the reminder sweep is a node-cron job in jobs/, every 15 minutes', () => {
    expect(imports(path.join(SRC, 'jobs/reminderJob.ts'))).toContain('node-cron');
    expect(REMINDER_SCHEDULE).toBe('*/15 * * * *');
    expect(source(path.join(SRC, 'index.ts'))).toContain('startReminderJob');
    for (const file of appFiles) expect(source(file), rel(file)).not.toMatch(/setInterval\(/);
  });
});

describe('environment variables', () => {
  it('the server reads PORT, MONGO_URI, JWT_SECRET, JWT_EXPIRES_IN and CLIENT_ORIGIN, with the agreed defaults', () => {
    const env = source(path.join(SRC, 'config/env.ts'));
    expect(env).toMatch(/process\.env\.PORT \?\? 4000/);
    expect(env).toContain('process.env.MONGO_URI');
    expect(env).toContain('process.env.JWT_SECRET');
    expect(env).toMatch(/process\.env\.JWT_EXPIRES_IN \?\? '7d'/);
    expect(env).toMatch(/process\.env\.CLIENT_ORIGIN \?\? 'http:\/\/localhost:5173'/);
    const all = appFiles.map(source).join('\n');
    expect(all).not.toMatch(/MONGODB_URI|CORS_ORIGIN/);
  });
});
