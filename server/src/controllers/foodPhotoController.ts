import type { PhotoSizeInput } from '@cook-first/shared';
import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { validatedQuery } from '../middleware/validate.js';
import * as foodPhotoService from '../services/foodPhotoService.js';

const id = (req: Request) => String(req.params.id);

/** Thin: parse the request, call the service, send the response. */
export const foodPhotoController = {
  async upload(req: Request, res: Response) {
    res.json(await foodPhotoService.uploadPhoto(currentUser(req), id(req), req.file?.buffer));
  },

  /**
   * A photo is only ever served here, to a signed-in member of the household that owns it. It is private
   * to that person's browser (never a shared cache), and the browser must trust the type we give it.
   */
  async get(req: Request, res: Response) {
    const { size } = validatedQuery<PhotoSizeInput>(req);
    const bytes = await foodPhotoService.getPhoto(currentUser(req), id(req), size);
    res
      .status(200)
      .set({
        'Content-Type': 'image/webp',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(bytes);
  },

  async remove(req: Request, res: Response) {
    await foodPhotoService.removePhoto(currentUser(req), id(req));
    res.status(204).end();
  },
};
