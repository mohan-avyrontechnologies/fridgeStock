import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { currentUser } from '../middleware/auth.js';
import { validatedQuery } from '../middleware/validate.js';
import { NotificationModel, type NotificationDoc } from '../models/Notification.js';
import { dispatchForUser, rescheduleAllForUser } from '../services/notificationService.js';
import { clock } from '../utils/clock.js';
import { toDateKey } from '../utils/dates.js';
import { AppError } from '../utils/errors.js';
import { toUserView } from './authController.js';

function toNotificationView(n: NotificationDoc) {
  return {
    id: n._id.toString(),
    foodId: n.foodId.toString(),
    type: n.type,
    message: n.message ?? '',
    scheduledDate: toDateKey(n.scheduledDate),
    status: n.status,
    sentAt: n.sentAt ? n.sentAt.toISOString() : null,
    readAt: n.readAt ? n.readAt.toISOString() : null,
  };
}

export const notificationController = {
  /** Delivered reminders, newest first. Delivers anything due before listing. */
  async list(req: Request, res: Response) {
    const user = currentUser(req);
    await dispatchForUser(user);
    const { limit, offset } = validatedQuery<{ limit: number; offset: number }>(req);
    const filter = { userId: user._id, status: 'SENT' as const };
    const [items, total, unread] = await Promise.all([
      NotificationModel.find(filter).sort({ sentAt: -1, _id: -1 }).skip(offset).limit(limit),
      NotificationModel.countDocuments(filter),
      NotificationModel.countDocuments({ ...filter, readAt: null }),
    ]);
    res.json({ items: items.map(toNotificationView), total, unread });
  },

  async unreadCount(req: Request, res: Response) {
    const user = currentUser(req);
    await dispatchForUser(user);
    const unread = await NotificationModel.countDocuments({
      userId: user._id,
      status: 'SENT',
      readAt: null,
    });
    res.json({ unread });
  },

  async markRead(req: Request, res: Response) {
    const user = currentUser(req);
    const id = String(req.params.id);
    const notFound = new AppError(404, 'NOT_FOUND', 'Notification not found.');
    if (!isValidObjectId(id)) throw notFound;
    const n = await NotificationModel.findOneAndUpdate(
      { _id: id, userId: user._id, status: 'SENT' },
      { $set: { readAt: clock.now() } },
      { returnDocument: 'after' },
    );
    if (!n) throw notFound;
    res.json(toNotificationView(n));
  },

  async markAllRead(req: Request, res: Response) {
    const user = currentUser(req);
    await NotificationModel.updateMany(
      { userId: user._id, status: 'SENT', readAt: null },
      { $set: { readAt: clock.now() } },
    );
    res.status(204).end();
  },

  getPreferences(req: Request, res: Response) {
    res.json(toUserView(currentUser(req)).notificationPreferences);
  },

  /** A disabled preference stops that reminder type being generated at all. */
  async updatePreferences(req: Request, res: Response) {
    const user = currentUser(req);
    const updates = req.body as Partial<Record<'approachingExpiry' | 'due' | 'overdue', boolean>>;
    for (const [key, value] of Object.entries(updates)) {
      user.notificationPreferences[key as keyof typeof updates] = value;
    }
    await user.save();
    await rescheduleAllForUser(user);
    res.json(toUserView(user).notificationPreferences);
  },
};
