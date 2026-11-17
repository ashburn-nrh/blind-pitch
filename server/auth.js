/* Passwords, session tokens, age and rate limiting. */
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: (await scryptAsync(password, salt, 64)).toString('hex') };
}
export async function verifyPassword(password, salt, hash) {
  const a = await scryptAsync(password, salt, 64), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* The browser holds the raw token in an HttpOnly cookie; the database only stores its hash. */
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = t => createHash('sha256').update(t).digest('hex');

/** Whole years between a YYYY-MM-DD date of birth and now. null if the date isn't real. */
export function ageFromDob(dob, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob ?? ''));
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age;
}

/** Sliding-window limiter kept in memory: allow(key) is false once `max` hits land inside `windowMs`. */
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return key => {
    const now = Date.now();
    if (hits.size > 50_000) hits.clear();
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    const ok = recent.length < max;
    if (ok) recent.push(now);
    hits.set(key, recent);
    return ok;
  };
}
