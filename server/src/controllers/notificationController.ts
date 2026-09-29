import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as notificationService from '../services/notificationService.js';

/** Thin: parse the request, call the service, send the response. */
export const notificationController = {
  async list(req: Request, res: Response) {
    res.json(await notificationService.listFeed(currentUser(req)));
  },

  async unreadCount(req: Request, res: Response) {
    res.json(await notificationService.unreadCount(currentUser(req)));
  },

  async markAllRead(req: Request, res: Response) {
    await notificationService.markAllRead(currentUser(req));
    res.status(204).end();
  },

  getPreferences(req: Request, res: Response) {
    res.json(notificationService.getPreferences(currentUser(req)));
  },

  async updatePreferences(req: Request, res: Response) {
    res.json(await notificationService.updatePreferences(currentUser(req), req.body));
  },
};
