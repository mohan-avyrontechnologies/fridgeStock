import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as favouriteService from '../services/favouriteService.js';

const id = (req: Request) => String(req.params.id);

/** Thin: parse the request, call the service, send the response. */
export const favouriteController = {
  async list(req: Request, res: Response) {
    res.json({ items: await favouriteService.listFavourites(currentUser(req)) });
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await favouriteService.createFavourite(currentUser(req), req.body));
  },

  async remove(req: Request, res: Response) {
    await favouriteService.removeFavourite(currentUser(req), id(req));
    res.status(204).end();
  },

  async add(req: Request, res: Response) {
    res.status(201).json(await favouriteService.addFromFavourite(currentUser(req), id(req)));
  },
};
