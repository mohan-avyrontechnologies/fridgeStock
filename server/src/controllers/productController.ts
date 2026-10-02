import type { PhotoCheckInput, ReceiptInput } from '@cook-first/shared';
import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { validatedQuery } from '../middleware/validate.js';
import * as photoService from '../services/photoService.js';
import * as productService from '../services/productService.js';
import * as receiptService from '../services/receiptService.js';

/** Thin: parse the request, call the service, send the response. */
export const productController = {
  async barcode(req: Request, res: Response) {
    const { code } = validatedQuery<{ code: string }>(req);
    res.json(await productService.lookupBarcode(code));
  },

  async photo(req: Request, res: Response) {
    res.json(await photoService.checkPhoto(currentUser(req), req.body as PhotoCheckInput));
  },

  async receipt(req: Request, res: Response) {
    res.json(await receiptService.readReceipt(currentUser(req), req.body as ReceiptInput));
  },
};
