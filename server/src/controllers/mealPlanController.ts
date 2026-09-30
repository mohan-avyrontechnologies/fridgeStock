import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as planningService from '../services/planningService.js';

/** Thin: parse the request, call the service, send the response. */
export const mealPlanController = {
  async get(req: Request, res: Response) {
    res.json(await planningService.getPlan(currentUser(req)));
  },

  async set(req: Request, res: Response) {
    res.json(await planningService.setEntry(currentUser(req), String(req.params.date), req.body));
  },

  async clear(req: Request, res: Response) {
    await planningService.clearEntry(currentUser(req), String(req.params.date));
    res.status(204).end();
  },
};
