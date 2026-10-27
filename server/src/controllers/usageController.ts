import type { Pagination } from '@fridgestock/shared';
import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { validatedQuery } from '../middleware/validate.js';
import * as usageService from '../services/usageService.js';

/** Thin: parse the request, call the service, send the response. */
export const usageController = {
  async list(req: Request, res: Response) {
    res.json(await usageService.listHistory(currentUser(req), validatedQuery<Pagination>(req)));
  },
};
