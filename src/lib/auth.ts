// Простой single-user auth: scrypt password hash + HMAC-signed cookie.
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from 'crypto';

const SECRET = process.env.AUTH_SECRET || '';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);

export const COOKIE_NAME = 'suthouse_auth';

export function verifyPassword(username: string, password: string): boolean {
  if (!ADMIN_HASH || username !== ADMIN_USER) return false;
  const [salt, key] = ADMIN_HASH.split(':');
  if (!salt || !key) return false;
  try {
    const derived = scryptSync(password, salt, 64);
    const stored = Buffer.from(key, 'hex');
    if (derived.length !== stored.length) return false;
    return timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

interface SessionPayload {
  user: string;
  exp: number; // unix seconds
  nonce: string;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function signSession(user: string): { token: string; expires: Date } {
  if (!SECRET) throw new Error('AUTH_SECRET is not set');
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload: SessionPayload = { user, exp, nonce: randomBytes(8).toString('hex') };
  const json = JSON.stringify(payload);
  const data = b64url(json);
  const sig = b64url(createHmac('sha256', SECRET).update(data).digest());
  return { token: `${data}.${sig}`, expires: new Date(exp * 1000) };
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token || !SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = createHmac('sha256', SECRET).update(data).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  try {
    const payload: SessionPayload = JSON.parse(fromB64url(data).toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
