import { describe, expect, it } from 'vitest';
import * as alerts from './alerts.js';
import * as barcode from './barcode.js';
import * as dates from './dates.js';
import * as estimate from './estimate.js';
import * as estimateCopy from './estimateCopy.js';
import * as reference from './foodReference.js';
import * as schemas from './schemas.js';
import { caseFiles, checkFile, loadCases } from './testCases.js';
import { validationResult } from './validationResult.js';
import * as wording from './wording.js';

/** Functions that take a time zone and then a time: the cases write the time as an ISO instant. */
const at =
  <A extends unknown[], R>(fn: (timeZone: string, now: Date, ...rest: A) => R) =>
  (timeZone: string, now: string, ...rest: A) =>
    fn(timeZone, new Date(now), ...rest);

/** Every case file the shared package checks, with the TypeScript implementation of each name in it. */
const IMPLEMENTATIONS: Record<string, Record<string, unknown>> = {
  alerts: { ...alerts, minutesInTz: at(alerts.minutesInTz), isQuietHours: at(alerts.isQuietHours) },
  barcode,
  dates: { ...dates, todayInTz: at(dates.todayInTz), hourInTz: at(dates.hourInTz) },
  estimate: { ...estimate, ...estimateCopy },
  reference,
  // Each request schema, answering as the API does (the first problem only). Written by
  // scripts/generate-validation-cases.ts; when a schema or zod changes on purpose, run it again.
  validation: Object.fromEntries(
    Object.entries(schemas)
      .filter(([name]) => name.endsWith('Schema'))
      .map(([name, schema]) => [name, (input: unknown) => validationResult(schema as never, input)]),
  ),
  wording,
};

/** The case files the server checks against its own code (server/src/tests/sharedCases.test.ts). */
const SERVER_FILES = ['messages', 'priority'];

describe('shared test cases (the Python server runs the same ones)', () => {
  it('every case file is checked, here or by the server', () => {
    expect(caseFiles()).toEqual([...Object.keys(IMPLEMENTATIONS), ...SERVER_FILES].sort());
  });

  for (const [file, implementations] of Object.entries(IMPLEMENTATIONS)) {
    it(file, () => checkFile(loadCases(file).functions, implementations));
  }
});
