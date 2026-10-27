import type { DeleteAccountInput } from '@fridgestock/shared';
import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as accountService from '../services/accountService.js';

/** Thin: call the service, send the response. */
export const accountController = {
  async export(req: Request, res: Response) {
    const data = await accountService.exportAccount(currentUser(req));
    res.setHeader('Content-Disposition', 'attachment; filename="fridgestock-data.json"');
    res.json(data);
  },
  async remove(req: Request, res: Response) {
    await accountService.deleteAccount(currentUser(req), req.body as DeleteAccountInput);
    res.status(204).end();
  },
};
