import type { MealType } from '@fridgestock/shared';
import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { validatedParams, validatedQuery } from '../middleware/validate.js';
import * as planningService from '../services/planningService.js';

type DateParam = { date: string };

/** Thin: parse the request, call the service, send the response. */
export const mealPlanController = {
  async get(req: Request, res: Response) {
    res.json(await planningService.getPlan(currentUser(req)));
  },

  async set(req: Request, res: Response) {
    res.json(await planningService.setEntry(currentUser(req), validatedParams<DateParam>(req).date, req.body));
  },

  async clear(req: Request, res: Response) {
    const { meal } = validatedQuery<{ meal: MealType }>(req);
    await planningService.clearEntry(currentUser(req), validatedParams<DateParam>(req).date, meal);
    res.status(204).end();
  },
};
