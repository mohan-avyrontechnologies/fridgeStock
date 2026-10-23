import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/**
 * The shared test cases in shared/test-cases/*.json: inputs and expected outputs that the TypeScript and the
 * Python suites must both pass, so the two languages can never disagree. Each file is
 * `{description, functions: {name: [{args, expected} | {args, throws}]}}`. A name without a function (a
 * constant) is compared with `expected` as it is.
 *
 * Test-only helper (it reads files and uses Vitest), so it is not exported from the package or built.
 */
export interface TestCase {
  args: unknown[];
  expected?: unknown;
  /** The error's name (e.g. "RangeError") when the call must throw. */
  throws?: string;
}

export interface CaseFile {
  description: string;
  functions: Record<string, TestCase[]>;
}

export const CASES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-cases');

export function caseFiles(): string[] {
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

export function loadCases(name: string): CaseFile {
  return JSON.parse(readFileSync(path.join(CASES_DIR, `${name}.json`), 'utf8')) as CaseFile;
}

/** What a result looks like once written as JSON (undefined fields dropped), the form the cases record. */
export const asJson = (value: unknown): unknown => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

/** Calls the implementation with the case's arguments (or takes a constant as it is) and checks the result. */
export function check(implementation: unknown, testCase: TestCase) {
  const call = () =>
    typeof implementation === 'function'
      ? (implementation as (...args: unknown[]) => unknown)(...testCase.args)
      : implementation;
  if (testCase.throws) {
    expect(call).toThrow(expect.objectContaining({ name: testCase.throws }) as unknown as Error);
  } else {
    expect(asJson(call())).toEqual(testCase.expected);
  }
}

/** Checks every case of every name in a file against `implementations`, naming the call that failed. */
export function checkFile(functions: CaseFile['functions'], implementations: Record<string, unknown>) {
  for (const [name, cases] of Object.entries(functions)) {
    expect(implementations, `${name} has no implementation`).toHaveProperty([name]);
    expect(cases.length, name).toBeGreaterThan(0);
    for (const testCase of cases) {
      try {
        check(implementations[name], testCase);
      } catch (error) {
        throw new Error(`${name}(${JSON.stringify(testCase.args).slice(1, -1)}): ${(error as Error).message}`);
      }
    }
  }
}
