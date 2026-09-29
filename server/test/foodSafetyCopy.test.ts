import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Food-safety boundary guard (BRD §10.3, FRD §15): no code outside comments
 * may call food "safe" or promise it is fine to eat. The app only ever
 * presents an "expected expiry" estimate.
 */
const ROOTS = [path.resolve('src'), path.resolve('../client/src'), path.resolve('../client/index.html')];
const BANNED = [/\bsafe\b/i, /\bsafe to (eat|consume)\b/i, /\bguaranteed\b/i, /\bgood until\b/i, /\bfresh until\b/i];

function files(p: string): string[] {
  try {
    if (statSync(p).isFile()) return [p];
  } catch {
    return [];
  }
  return readdirSync(p).flatMap((name) => files(path.join(p, name)));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('food-safety wording', () => {
  it('no source file calls food safe', () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap(files)) {
      if (!/\.(ts|tsx|html)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of BANNED) {
        const match = code.match(pattern);
        if (match) offenders.push(`${path.relative(process.cwd(), file)}: "${match[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
