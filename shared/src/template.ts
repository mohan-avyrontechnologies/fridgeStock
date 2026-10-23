/**
 * Fills the {placeholders} in a sentence from shared/data. A placeholder with no value is left as it is, so a
 * missing value shows up in a test instead of silently disappearing. The Python server has the same function.
 */
export function fillTemplate(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
