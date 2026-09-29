import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as foodService from '../services/foodService.js';

const id = (req: Request) => String(req.params.id);

/** Thin: parse the request, call the service, send the response. */
export const foodController = {
  async list(req: Request, res: Response) {
    res.json(await foodService.listFoods(currentUser(req)));
  },

  async cookFirst(req: Request, res: Response) {
    res.json(await foodService.listCookFirst(currentUser(req)));
  },

  async get(req: Request, res: Response) {
    res.json(await foodService.getFood(currentUser(req), id(req)));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await foodService.createFood(currentUser(req), req.body));
  },

  async update(req: Request, res: Response) {
    res.json(await foodService.updateFood(currentUser(req), id(req), req.body));
  },

  async remove(req: Request, res: Response) {
    await foodService.removeFood(currentUser(req), id(req));
    res.status(204).end();
  },

  async use(req: Request, res: Response) {
    res.json(await foodService.useFood(currentUser(req), id(req), req.body));
  },

  async bulkCreate(req: Request, res: Response) {
    res.status(201).json(await foodService.bulkCreate(currentUser(req), req.body));
  },

  async undo(req: Request, res: Response) {
    res.json(await foodService.undoLastAction(currentUser(req), id(req)));
  },

  async waste(req: Request, res: Response) {
    res.json(await foodService.wasteFood(currentUser(req), id(req)));
  },
};
