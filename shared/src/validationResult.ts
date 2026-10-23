import type { ZodType } from 'zod';

/** What the API answers for a request value: the parsed data, or the first problem's message and dotted field. */
export type ValidationResult = { valid: true; data: unknown } | { valid: false; message: string; field: string | null };

/**
 * Checks a value the way the server's validate middleware does (only the first issue counts), in the form
 * shared/test-cases/validation.json records. A missing body is checked as an empty object, as the server does.
 */
export function validationResult(schema: ZodType, input: unknown): ValidationResult {
  const result = schema.safeParse(input ?? {});
  if (result.success) return { valid: true, data: JSON.parse(JSON.stringify(result.data ?? null)) };
  const issue = result.error.issues[0]!;
  return { valid: false, message: issue.message, field: issue.path.length ? issue.path.map(String).join('.') : null };
}
