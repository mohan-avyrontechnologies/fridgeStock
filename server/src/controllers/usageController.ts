import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { validatedQuery } from '../middleware/validate.js';
import { UsageRecordModel, USAGE_ACTIONS, type UsageAction } from '../models/UsageRecord.js';
import { toUsageView } from './foodController.js';

export const usageController = {
  /** The user's usage/waste history, newest first, with per-action totals. */
  async list(req: Request, res: Response) {
    const user = currentUser(req);
    const { limit, offset } = validatedQuery<{ limit: number; offset: number }>(req);
    const filter = { userId: user._id };
    const [records, total, grouped] = await Promise.all([
      UsageRecordModel.find(filter).sort({ date: -1, _id: -1 }).skip(offset).limit(limit),
      UsageRecordModel.countDocuments(filter),
      UsageRecordModel.aggregate<{ _id: UsageAction; count: number }>([
        { $match: filter },
        { $group: { _id: '$action', count: { $sum: 1 } } },
      ]),
    ]);
    const counts = Object.fromEntries(USAGE_ACTIONS.map((a) => [a, 0])) as Record<UsageAction, number>;
    for (const g of grouped) counts[g._id] = g.count;
    res.json({ items: records.map(toUsageView), total, counts });
  },
};
