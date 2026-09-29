import bcrypt from 'bcrypt';

/** bcrypt at cost 12. Plaintext passwords are never stored, logged or returned. */
export const BCRYPT_COST = 12;

export const passwordHashService = {
  hash: (password: string) => bcrypt.hash(password, BCRYPT_COST),
  verify: (password: string, hash: string) => bcrypt.compare(password, hash),
};
