import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as suggestionService from '../services/suggestionService.js';

/** Thin: parse the request, call the service, send the response. */
export const suggestionController = {
  async lifespans(req: Request, res: Response) {
    res.json({ items: await suggestionService.learnedLifespans(currentUser(req)) });
  },
};
