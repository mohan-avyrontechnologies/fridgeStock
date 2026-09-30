import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as shoppingService from '../services/shoppingService.js';

/** Thin: parse the request, call the service, send the response. */
export const shoppingController = {
  async list(req: Request, res: Response) {
    res.json(await shoppingService.list(currentUser(req)));
  },

  async add(req: Request, res: Response) {
    res.status(201).json(await shoppingService.add(currentUser(req), req.body));
  },

  async update(req: Request, res: Response) {
    res.json(await shoppingService.update(currentUser(req), String(req.params.id), req.body));
  },

  async remove(req: Request, res: Response) {
    await shoppingService.remove(currentUser(req), String(req.params.id));
    res.status(204).end();
  },

  async clearChecked(req: Request, res: Response) {
    await shoppingService.clearChecked(currentUser(req));
    res.status(204).end();
  },
};
