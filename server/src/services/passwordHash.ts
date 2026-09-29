import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export const passwordHashService = {
  hash: (password: string) => bcrypt.hash(password, ROUNDS),
  verify: (password: string, hash: string) => bcrypt.compare(password, hash),
};
