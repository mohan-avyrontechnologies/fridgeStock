import { describe, it } from 'vitest';
import { checkFile, loadCases } from '../../../shared/src/testCases.js';
import { adjustedCopy, aiCopy, aiPrompts, mealCopy, promptLine, pushCopy, reminderCopy } from '../copy.js';
import * as priority from '../services/priorityEngine.js';

/**
 * The shared test cases for the server's own logic (shared/test-cases/priority.json and messages.json). The
 * Python server runs the same files, so the two can never disagree. The shared package checks the rest.
 */
const groups = {
  reminder: reminderCopy,
  push: pushCopy,
  adjusted: adjustedCopy,
  ai: aiCopy,
  aiPrompts,
  meal: mealCopy,
};
const messages: Record<string, unknown> = { promptLine };
for (const [group, values] of Object.entries(groups)) {
  for (const [key, value] of Object.entries(values)) messages[`${group}.${key}`] = value;
}

describe('shared test cases (the Python server runs the same ones)', () => {
  it('priority', () => checkFile(loadCases('priority').functions, priority));
  it('messages', () => checkFile(loadCases('messages').functions, messages));
});
