import type { DateString } from '@fridgestock/shared';
import { NotificationModel } from '../models/Notification.js';
import type { UserDoc } from '../models/User.js';

/**
 * Records that today's daily summary has been sent to this person (on its own, or inside a meal reminder that
 * carried it), so it isn't sent again, and marks today's delivered reminders as pushed.
 */
export async function markDigestSent(user: UserDoc, today: DateString, now: Date): Promise<void> {
  user.lastDigestDate = today;
  await user.save();
  await NotificationModel.updateMany(
    { userId: user._id, status: 'SENT', scheduledDate: today, pushedAt: null },
    { $set: { pushedAt: now } },
  );
}
