import crypto from 'node:crypto';
import { promisify } from 'node:util';
import db from '../db.js';
import { HttpError } from './http.js';

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;

export const SESSION_COOKIE = 'pg_session';
const SESSION_DAYS = 7;
const isProduction = process.env.NODE_ENV === 'production';

// ---- Passwords (scrypt, built into Node — no extra dependency) ----

export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(plain, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// A real hash used when the email does not exist, so login takes the same time either way.
const dummyHashPromise = hashPassword('dummy-password-for-timing');
export async function verifyAgainstDummy(plain) {
  await verifyPassword(plain, await dummyHashPromise);
  return false;
}

// ---- Sessions ----
// The browser holds a random token in an httpOnly cookie; the database stores only its SHA-256 hash,
// so a leaked database cannot be used to log in.

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    expires.toISOString(),
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    expires,
    path: '/',
  });
}

export function destroySession(req, res) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function destroyOtherSessions(userId, req) {
  const token = readCookie(req, SESSION_COOKIE);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(token || ''));
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const findSessionUser = db.prepare(`
  SELECT u.id, u.role, u.name, u.email, u.phone, u.owner_id, u.must_change_password
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ? AND s.expires_at > ?
`);

// ---- The one owner ----
// The app has exactly one owner account: the one named by OWNER_EMAIL (see lib/owner.js). Any other owner row
// that may exist in an older database is kept but disabled: it cannot log in and its sessions stop working.
// OWNER_EMAIL is read on every call so a changed setting takes effect for sessions that are already open.
export const configuredOwnerEmail = () => (process.env.OWNER_EMAIL || '').trim().toLowerCase() || null;
export const mayUseApp = (user) => user.role !== 'owner' || user.email.toLowerCase() === configuredOwnerEmail();

// Middleware: attaches req.user when a valid session cookie is present. Never rejects.
export function loadUser(req, res, next) {
  const token = readCookie(req, SESSION_COOKIE);
  const user = token ? findSessionUser.get(sha256(token), new Date().toISOString()) : null;
  req.user = user && mayUseApp(user) ? user : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in'));
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please log in'));
    if (req.user.role !== role) return next(new HttpError(403, 'You do not have access to this page'));
    next();
  };
}

export function publicUser(u) {
  return {
    id: u.id,
    role: u.role,
    name: u.name,
    email: u.email,
    phone: u.phone,
    mustChangePassword: Boolean(u.must_change_password),
  };
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

// ---- Rate limiting (in memory, per key such as IP + email) ----
export function createLimiter(maxAttempts, windowMs, message) {
  const attempts = new Map();
  return {
    // Throws 429 if the key has already failed too many times in the window.
    check(key) {
      const entry = attempts.get(key);
      if (entry && Date.now() - entry.first < windowMs && entry.count >= maxAttempts) throw new HttpError(429, message);
    },
    fail(key) {
      const now = Date.now();
      if (attempts.size > 10_000) {
        for (const [k, e] of attempts) if (now - e.first >= windowMs) attempts.delete(k);
      }
      const entry = attempts.get(key);
      if (!entry || now - entry.first >= windowMs) attempts.set(key, { first: now, count: 1 });
      else entry.count++;
    },
    clear(key) {
      attempts.delete(key);
    },
  };
}

const loginLimiter = createLimiter(10, 15 * 60_000, 'Too many login attempts. Please wait 15 minutes and try again.');
export const checkLoginRate = (key) => loginLimiter.check(key);
export const recordLoginFailure = (key) => loginLimiter.fail(key);
export const clearLoginFailures = (key) => loginLimiter.clear(key);
