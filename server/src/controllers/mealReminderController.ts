import type { MealType } from '@cook-first/shared';
import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { validatedParams } from '../middleware/validate.js';
import * as mealReminderService from '../services/mealReminderService.js';

/** Thin: parse the request, call the service, send the response. */
export const mealReminderController = {
  /** What today's reminder for this meal showed (the "Show recipe" screen). */
  async get(req: Request, res: Response) {
    res.json(await mealReminderService.getReminder(currentUser(req), validatedParams<{ meal: MealType }>(req).meal));
  },
};
