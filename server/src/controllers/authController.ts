import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as authService from '../services/authService.js';
import { toUserView } from '../services/views.js';

/** Thin: parse the request, call the service, send the response. */
export const authController = {
  async register(req: Request, res: Response) {
    res.status(201).json(await authService.register(req.body));
  },

  async login(req: Request, res: Response) {
    res.json(await authService.login(req.body));
  },

  me(req: Request, res: Response) {
    res.json({ user: toUserView(currentUser(req)) });
  },

  async updateMe(req: Request, res: Response) {
    res.json({ user: await authService.updateAccount(currentUser(req), req.body) });
  },
};
