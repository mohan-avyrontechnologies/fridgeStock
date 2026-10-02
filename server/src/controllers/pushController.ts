import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as pushActionService from '../services/pushActionService.js';
import * as pushService from '../services/pushService.js';

/** Thin: parse the request, call the service, send the response. */
export const pushController = {
  config(_req: Request, res: Response) {
    res.json(pushService.config());
  },

  async subscribe(req: Request, res: Response) {
    res.status(201).json(await pushService.subscribe(currentUser(req), req.body));
  },

  async unsubscribe(req: Request, res: Response) {
    await pushService.unsubscribe(
      currentUser(req),
      'token' in req.body ? { token: req.body.token } : { endpoint: req.body.endpoint },
    );
    res.status(204).end();
  },

  async action(req: Request, res: Response) {
    await pushActionService.handleAction(req.body);
    res.status(204).end();
  },
};
