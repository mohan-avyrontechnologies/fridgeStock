import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { passwordHashService } from '../services/passwordHash.js';
import { signToken } from '../services/token.js';
import { AppError } from '../utils/errors.js';
import { isValidTimeZone } from '../utils/dates.js';

export function toUserView(user: UserDoc) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    timeZone: user.timeZone,
    notificationPreferences: {
      approachingExpiry: user.notificationPreferences.approachingExpiry,
      due: user.notificationPreferences.due,
      overdue: user.notificationPreferences.overdue,
    },
  };
}

function zoneOrDefault(timeZone: string | undefined, fallback: string): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : fallback;
}

const emailTaken = () =>
  new AppError(409, 'CONFLICT', 'An account with this email already exists.', 'email');

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

// Compared against when the email is unknown, so both paths cost a bcrypt check.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= passwordHashService.hash('not-a-real-password'));

export const authController = {
  async register(req: Request, res: Response) {
    const { name, email, password, timeZone } = req.body;
    if (await UserModel.exists({ email })) throw emailTaken();
    try {
      const user = await UserModel.create({
        name,
        email,
        passwordHash: await passwordHashService.hash(password),
        timeZone: zoneOrDefault(timeZone, 'UTC'),
      });
      res.status(201).json({ token: signToken(user.id), user: toUserView(user) });
    } catch (error) {
      // Two simultaneous sign-ups can both pass the exists() check.
      if ((error as { code?: number }).code === 11000) throw emailTaken();
      throw error;
    }
  },

  async login(req: Request, res: Response) {
    const { email, password, timeZone } = req.body;
    const user = await UserModel.findOne({ email });
    const valid = await passwordHashService.verify(
      password,
      user?.passwordHash ?? (await getDummyHash()),
    );
    if (!user || !valid) throw invalidCredentials();

    // Keep "today" aligned with wherever the user is signing in from.
    const zone = zoneOrDefault(timeZone, user.timeZone);
    if (zone !== user.timeZone) {
      user.timeZone = zone;
      await user.save();
    }
    res.json({ token: signToken(user.id), user: toUserView(user) });
  },

  me(req: Request, res: Response) {
    res.json({ user: toUserView(currentUser(req)) });
  },

  async updateMe(req: Request, res: Response) {
    const user = currentUser(req);
    const { name, timeZone } = req.body as { name?: string; timeZone?: string };
    if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Time zone is not recognised.', 'timeZone');
    }
    if (name !== undefined) user.name = name;
    if (timeZone !== undefined) user.timeZone = timeZone;
    await user.save();
    res.json({ user: toUserView(user) });
  },
};
