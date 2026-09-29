import type { AuthResponse, LoginInput, RegisterInput, UpdateAccountInput, User } from '@cook-first/shared';
import { UserModel, type UserDoc } from '../models/User.js';
import { AppError } from './errors.js';
import { passwordHashService } from './passwordHash.js';
import { isValidTimeZone } from './timeZone.js';
import { signToken } from './token.js';
import { toUserView } from './views.js';

const emailTaken = () => new AppError(409, 'CONFLICT', 'An account with this email already exists.', 'email');
const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

function zoneOrDefault(timeZone: string | undefined, fallback: string): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : fallback;
}

// Compared against when the email is unknown, so both paths cost a bcrypt check.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= passwordHashService.hash('not-a-real-password'));

export async function register({ name, email, password, timeZone }: RegisterInput): Promise<AuthResponse> {
  if (await UserModel.exists({ email })) throw emailTaken();
  try {
    const user = await UserModel.create({
      name,
      email,
      passwordHash: await passwordHashService.hash(password),
      timeZone: zoneOrDefault(timeZone, 'UTC'),
    });
    return { token: signToken(user.id), user: toUserView(user) };
  } catch (error) {
    // Two simultaneous sign-ups can both pass the exists() check.
    if ((error as { code?: number }).code === 11000) throw emailTaken();
    throw error;
  }
}

export async function login({ email, password, timeZone }: LoginInput): Promise<AuthResponse> {
  const user = await UserModel.findOne({ email });
  const valid = await passwordHashService.verify(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid) throw invalidCredentials();

  // Keep "today" aligned with wherever the user is signing in from.
  const zone = zoneOrDefault(timeZone, user.timeZone);
  if (zone !== user.timeZone) {
    user.timeZone = zone;
    await user.save();
  }
  return { token: signToken(user.id), user: toUserView(user) };
}

export async function updateAccount(user: UserDoc, { name, timeZone }: UpdateAccountInput): Promise<User> {
  if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Time zone is not recognised.', 'timeZone');
  }
  if (name !== undefined) user.name = name;
  if (timeZone !== undefined) user.timeZone = timeZone;
  await user.save();
  return toUserView(user);
}

/** Resolves the user named by a verified token, or null if they no longer exist. */
export function findUserById(id: string): Promise<UserDoc | null> {
  return UserModel.findById(id);
}
