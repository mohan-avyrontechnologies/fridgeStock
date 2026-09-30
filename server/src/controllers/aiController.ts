import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as aiService from '../services/aiService.js';
import * as planningService from '../services/planningService.js';

/** Thin: parse the request, call the service, send the response. */
export const aiController = {
  async status(req: Request, res: Response) {
    res.json(await aiService.status(currentUser(req)));
  },

  async recipes(req: Request, res: Response) {
    res.json(await planningService.suggestRecipes(currentUser(req)));
  },

  async mealPlan(req: Request, res: Response) {
    res.json(await planningService.suggestPlan(currentUser(req)));
  },
};
