import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Food-safety boundary guard (BRD §10.3, FRD §15). The app only ever shows an
 * "expected expiry" estimate and must never suggest food is fit to eat.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const SRC_ROOTS = [path.resolve('src'), path.resolve('../client/src'), path.resolve('../shared/src')];
const COPY_FILES = [path.resolve('src/copy.ts'), path.resolve('../client/src/copy.ts')];

const BANNED_PHRASES = [
  'safe until',
  'safe to eat',
  'safe to consume',
  'fresh until',
  'good until',
  'still good',
  'guaranteed',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const sourceFiles = SRC_ROOTS.flatMap(files).filter(
  (file) => /\.(ts|tsx)$/.test(file) && path.resolve(file) !== THIS_FILE,
);

const rel = (file: string) => path.relative(path.resolve('..'), file).replaceAll('\\', '/');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('food-safety wording', () => {
  it('scans a real set of source files', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
    for (const copy of COPY_FILES) expect(sourceFiles).toContain(copy);
  });

  it('no .ts/.tsx file in client/src or server/src contains a banned phrase', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        if (text.includes(phrase)) offenders.push(`${rel(file)}: "${phrase}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the service worker, app manifest and index.html never call food safe', () => {
    const publicFiles = ['../client/public/sw.js', '../client/public/manifest.webmanifest', '../client/index.html'];
    for (const file of publicFiles.map((f) => path.resolve(f))) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const phrase of BANNED_PHRASES) expect(text, rel(file)).not.toContain(phrase);
      expect(text, rel(file)).not.toMatch(/\bsafe\b/);
    }
  });

  it('neither copy file contains the standalone word "safe"', () => {
    for (const file of COPY_FILES) {
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/\bsafe\b/i);
    }
  });

  it('expiry wording lives only in the two copy files', () => {
    // "expiry", "expire(s|d)" or "expiring" as a word of text. Identifiers such
    // as expiryDate, OVERDUE or expiresIn don't match.
    const wording = /(?<![\w$.])expir(?:y|e|es|ed|ing)(?![\w$])/i;
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      if (COPY_FILES.includes(file) || /[\\/](tests?|mocks)[\\/]|\.test\.tsx?$/.test(file)) continue;
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (wording.test(line)) offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the required estimate line is defined in the client copy file', () => {
    expect(readFileSync(COPY_FILES[1]!, 'utf8')).toContain(
      "'Expected expiry is an estimate to help you plan. Always check your food before eating it.'",
    );
  });
});
