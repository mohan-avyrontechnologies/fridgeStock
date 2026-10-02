import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as insightsService from '../services/insightsService.js';

/** Thin: call the service, send the response. */
export const insightsController = {
  async get(req: Request, res: Response) {
    res.json(await insightsService.getInsights(currentUser(req)));
  },
};
