import crypto from 'node:crypto';
import { promisify } from 'node:util';
import db from '../db.js';
import { HttpError } from './http.js';

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;

const SESSION_DAYS = 7;

// Session cookie attributes come from the environment so the same code works locally and in production:
//   COOKIE_SAMESITE  lax (default) | strict | none
//       `lax` is right when the page and the API share a site (local development, or the API reached through the
//       frontend's own domain). `none` is needed when a frontend on another site (e.g. *.vercel.app) calls an API on
//       *.onrender.com directly; browsers then require `Secure`, and the server insists on an Origin header.
//   COOKIE_SECURE    true | false. Default: true when NODE_ENV=production, otherwise false.
export function cookieSettings() {
  const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error(`COOKIE_SAMESITE must be lax, strict or none (got "${process.env.COOKIE_SAMESITE}").`);
  }
  const secureSetting = process.env.COOKIE_SECURE;
  const secure = sameSite === 'none' ? true : secureSetting ? secureSetting === 'true' : process.env.NODE_ENV === 'production';
  return { sameSite, secure };
}

// With Secure the cookie gets the `__Host-` prefix: browsers then accept it only from this exact host, over HTTPS,
// for path /, so a page on a sibling subdomain cannot plant or overwrite the session cookie.
export const sessionCookieName = (secure = cookieSettings().secure) => (secure ? '__Host-pg_session' : 'pg_session');

// ---- Passwords (scrypt, built into Node — no extra dependency) ----
// Stored as  scrypt$ln=16,r=8,p=1$<salt hex>$<key hex>  so the cost can be raised later without breaking old hashes.
// Hashes written before the cost was recorded look like  scrypt$<salt hex>$<key hex>  and used Node's default cost.
// Cost: N = 2^16, r = 8 (64 MiB, about 0.1 s). OWASP suggests 2^17, but that needs 128 MiB per hash, and Node runs up
// to 4 hashes at once: 512 MiB is the whole memory of a small hosted instance. Old hashes are upgraded at login.
const SCRYPT_COST = { ln: 16, r: 8, p: 1 };
const LEGACY_COST = { ln: 14, r: 8, p: 1 };

function parseHash(stored) {
  const parts = String(stored).split('$');
  if (parts[0] !== 'scrypt') return null;
  let cost = LEGACY_COST;
  if (parts.length === 4) {
    const m = /^ln=(\d+),r=(\d+),p=(\d+)$/.exec(parts[1]);
    if (!m) return null;
    cost = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
    // Refuse absurd values: a tampered row must not be able to make the server allocate gigabytes.
    if (cost.ln < 10 || cost.ln > 20 || cost.r < 1 || cost.r > 16 || cost.p < 1 || cost.p > 4) return null;
    parts.splice(1, 1);
  } else if (parts.length !== 3) {
    return null;
  }
  const [, saltHex, keyHex] = parts;
  if (!/^[0-9a-f]{32,}$/.test(saltHex) || !/^[0-9a-f]{64,}$/.test(keyHex)) return null;
  return { cost, salt: Buffer.from(saltHex, 'hex'), key: Buffer.from(keyHex, 'hex') };
}

const derive = (plain, salt, length, { ln, r, p }) => scrypt(plain, salt, length, { N: 2 ** ln, r, p, maxmem: 256 * 2 ** ln * r });

export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await derive(plain, salt, KEY_LEN, SCRYPT_COST);
  const { ln, r, p } = SCRYPT_COST;
  return `scrypt$ln=${ln},r=${r},p=${p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

// True for a real password hash; false for the unusable '!' of a tenant who has not registered yet.
export const isPasswordHash = (stored) => parseHash(stored) !== null;

export async function verifyPassword(plain, stored) {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const actual = await derive(plain, parsed.salt, parsed.key.length, parsed.cost);
  return crypto.timingSafeEqual(parsed.key, actual);
}

// True when a (correct) password was hashed with a lower cost than today's and should be hashed again.
export function needsRehash(stored) {
  const parsed = parseHash(stored);
  return Boolean(parsed) && (parsed.cost.ln < SCRYPT_COST.ln || parsed.cost.r < SCRYPT_COST.r);
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

// Starts a session after a successful login or registration. A session the browser already had is ended first, so a
// token planted in the browser before login is never turned into a logged-in session.
export async function createSession(req, res, userId) {
  const old = readCookie(req, sessionCookieName());
  if (old) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(old)]);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
    sha256(token),
    userId,
    expires.toISOString(),
  ]);
  const { sameSite, secure } = cookieSettings();
  res.cookie(sessionCookieName(secure), token, { httpOnly: true, sameSite, secure, expires, path: '/' });
}

export async function destroySession(req, res) {
  const token = readCookie(req, sessionCookieName());
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  const { sameSite, secure } = cookieSettings();
  // same attributes, or browsers keep it
  res.clearCookie(sessionCookieName(secure), { path: '/', httpOnly: true, sameSite, secure });
}

export async function destroyOtherSessions(userId, req) {
  const token = readCookie(req, sessionCookieName());
  await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [userId, sha256(token || '')]);
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

const findSessionUser = (tokenHash, nowIso) =>
  db.get(
    `SELECT u.id, u.role, u.name, u.email, u.phone, u.owner_id, u.must_change_password
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [tokenHash, nowIso],
  );

// ---- The one owner ----
// The app has exactly one owner account: the one named by OWNER_EMAIL (see lib/owner.js). Any other owner row
// that may exist in an older database is kept but disabled: it cannot log in and its sessions stop working.
// OWNER_EMAIL is read on every call so a changed setting takes effect for sessions that are already open.
export const configuredOwnerEmail = () => (process.env.OWNER_EMAIL || '').trim().toLowerCase() || null;
export const mayUseApp = (user) => user.role !== 'owner' || user.email.toLowerCase() === configuredOwnerEmail();

// Middleware: attaches req.user when a valid session cookie is present. Never rejects.
export async function loadUser(req, res, next) {
  try {
    const token = readCookie(req, sessionCookieName());
    const user = token ? await findSessionUser(sha256(token), new Date().toISOString()) : null;
    req.user = user && mayUseApp(user) ? user : null;
    next();
  } catch (err) {
    next(err);
  }
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

export async function purgeExpiredSessions() {
  await db.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
}

// ---- Tenant invite codes ----
// The owner gets a one-time code when adding a tenant (or resetting their access) and passes it on in person or by
// message. Registering needs the owner-added email AND this code, so knowing someone's email is not enough to take
// over their account. Only a SHA-256 hash of the code is stored; it expires after INVITE_DAYS and is used up on
// registration. 12 characters of Crockford base32 = 60 random bits.
const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U: easy to read aloud and type on a phone
const INVITE_DAYS = 7;

// Undoes the formatting and the usual typos (O for 0, I or L for 1), as Crockford base32 intends.
export const normalizeInviteCode = (code) =>
  String(code).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
export const isInviteCodeShape = (normalized) => /^[0-9A-HJKMNP-TV-Z]{12}$/.test(normalized);
export const hashInviteCode = (code) => sha256(normalizeInviteCode(code));

// Gives the tenant a new invite code (replacing any earlier one) and returns it. This is the only time the plain code
// exists, so it goes straight back to the owner. `q` is `db` or a transaction.
export async function issueInvite(q, tenantId) {
  const raw = Array.from(crypto.randomBytes(12), (b) => INVITE_ALPHABET[b & 31]).join(''); // 256 % 32 = 0: no bias
  const code = raw.match(/.{4}/g).join('-');
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  await q.run("UPDATE users SET invite_hash = ?, invite_expires_at = ? WHERE id = ? AND role = 'tenant'", [
    hashInviteCode(code),
    expiresAt,
    tenantId,
  ]);
  return { code, expires_at: expiresAt };
}

export const sameHash = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---- Security event log ----
// One JSON line per security event (failed logins, rate limits, registrations, access resets), so they can be found in
// the hosting platform's log viewer. Never includes passwords, invite codes or session tokens.
// SECURITY_LOG=off silences it (the tests do this).
export function securityLog(event, fields = {}) {
  if (process.env.SECURITY_LOG === 'off') return;
  console.log(JSON.stringify({ at: new Date().toISOString(), security: event, ...fields }));
}

// ---- Rate limiting (in memory, per key such as IP + email) ----
// An attempt is counted *before* the slow work (password hashing) starts, so a burst of parallel requests cannot all
// get in under the limit. A request that turns out to be legitimate gives its attempt back with release() or clear().
// The counters live in this process only: they reset on restart and are not shared between several server instances.
export function createLimiter(name, maxAttempts, windowMs, message) {
  const attempts = new Map();
  return {
    // Throws 429 if the key has already used all its attempts in the current window.
    hit(key) {
      const now = Date.now();
      if (attempts.size > 10_000) {
        for (const [k, e] of attempts) if (now - e.first >= windowMs) attempts.delete(k);
      }
      const entry = attempts.get(key);
      if (!entry || now - entry.first >= windowMs) {
        attempts.set(key, { first: now, count: 1 });
        return;
      }
      if (entry.count >= maxAttempts) {
        if (!entry.logged) securityLog('rate_limited', { limiter: name, key });
        entry.logged = true;
        throw new HttpError(429, message);
      }
      entry.count++;
    },
    release(key) {
      const entry = attempts.get(key);
      if (entry && entry.count > 0) entry.count--;
    },
    clear(key) {
      attempts.delete(key);
    },
  };
}

