import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PASSWORD_PREFIX = 'scrypt-v1';

function scryptAsync(password: string, salt: Buffer, keyLength = 64): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validatePassword(password: string) {
  if (password.length < 8 || password.length > 256) {
    throw Object.assign(new Error('Password must be between 8 and 256 characters'), { code: 'INVALID_PASSWORD' });
  }
}

export async function hashPassword(password: string) {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt);
  return `${PASSWORD_PREFIX}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [prefix, saltText, expectedText] = stored.split('$');
  if (prefix !== PASSWORD_PREFIX || !saltText || !expectedText) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltText, 'base64url');
    expected = Buffer.from(expectedText, 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
