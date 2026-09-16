import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH);

  return `scrypt$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

export async function verifyPassword(password, encodedHash) {
  const [algorithm, encodedSalt, encodedKey] = encodedHash?.split('$') ?? [];

  if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false;

  const expectedKey = Buffer.from(encodedKey, 'base64');
  const actualKey = await scrypt(
    password,
    Buffer.from(encodedSalt, 'base64'),
    expectedKey.length
  );

  return actualKey.length === expectedKey.length &&
    timingSafeEqual(actualKey, expectedKey);
}
