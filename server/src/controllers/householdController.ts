import type { JoinHouseholdInput, Pagination } from '@fridgestock/shared';
import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { validatedParams, validatedQuery } from '../middleware/validate.js';
import * as householdService from '../services/householdService.js';

/** Thin: parse the request, call the service, send the response. */
export const householdController = {
  async get(req: Request, res: Response) {
    res.json(await householdService.getHousehold(currentUser(req)));
  },
  async createInvite(req: Request, res: Response) {
    res.status(201).json(await householdService.createInvite(currentUser(req)));
  },
  async cancelInvite(req: Request, res: Response) {
    await householdService.cancelInvite(currentUser(req), validatedParams<JoinHouseholdInput>(req).code);
    res.status(204).end();
  },
  async join(req: Request, res: Response) {
    res.json(await householdService.joinHousehold(currentUser(req), req.body as JoinHouseholdInput));
  },
  async leave(req: Request, res: Response) {
    res.json(await householdService.leaveHousehold(currentUser(req)));
  },
  async activity(req: Request, res: Response) {
    res.json(await householdService.getActivity(currentUser(req), validatedQuery<Pagination>(req)));
  },
};
