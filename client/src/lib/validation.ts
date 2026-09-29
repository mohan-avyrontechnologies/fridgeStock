import type { ZodType } from 'zod';

/**
 * Runs a shared zod schema in the browser so forms respond instantly with the
 * same messages the server would send. The server's check is the one that counts.
 * Returns the parsed value, or the first error message for each field.
 */
export function check<T>(
  schema: ZodType<T>,
  input: unknown,
): { data: T; errors: null } | { data: null; errors: Record<string, string> } {
  const result = schema.safeParse(input);
  if (result.success) return { data: result.data, errors: null };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length ? String(issue.path[0]) : 'form';
    errors[field] ??= issue.message;
  }
  return { data: null, errors };
}
