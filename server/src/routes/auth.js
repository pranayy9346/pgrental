import { Router } from 'express';
import db from '../db.js';
import {
  createLimiter,
  createSession,
  destroyOtherSessions,
  destroySession,
  hashInviteCode,
  hashPassword,
  isInviteCodeShape,
  isPasswordHash,
  mayUseApp,
  needsRehash,
  normalizeInviteCode,
  publicUser,
  requireAuth,
  sameHash,
  securityLog,
  verifyAgainstDummy,
  verifyPassword,
} from '../lib/auth.js';
import { HttpError, badRequest } from '../lib/http.js';
import { email, password, phone, secret, str, validate } from '../lib/validate.js';

const router = Router();

// There is no owner sign-up: the single owner account comes from server configuration (see lib/owner.js).
// Tenant accounts are added by the owner and registered by the tenant (see the tenant section below).

const WINDOW = 15 * 60_000;
const tooManyLogins = 'Too many login attempts. Please wait 15 minutes and try again.';
// Guessing one account's password from one address.
const loginPerAccount = createLimiter('login', 10, WINDOW, tooManyLogins);
// Trying many accounts from one address (password spraying). Successful logins give their attempt back, so a hostel
// full of tenants behind one Wi-Fi address is not locked out by normal use.
const loginPerIp = createLimiter('login-ip', 100, WINDOW, tooManyLogins);

router.post('/login', async (req, res) => {
  const data = validate(req.body, { email: email(), password: secret() });
  const key = `${req.ip}|${data.email}`;
  loginPerIp.hit(req.ip);
  loginPerAccount.hit(key);

  const user = await db.get('SELECT * FROM users WHERE lower(email) = ?', [data.email]);
  // Unknown emails, disabled owners and tenants who have not registered yet all cost one full hash, so the response
  // time does not reveal which emails have accounts.
  const usable = user && mayUseApp(user) && isPasswordHash(user.password_hash);
  const ok = usable ? await verifyPassword(data.password, user.password_hash) : await verifyAgainstDummy(data.password);
  if (!ok) {
    securityLog('login_failed', { email: data.email, ip: req.ip });
    throw new HttpError(401, 'Incorrect email or password');
  }
  loginPerAccount.clear(key);
  loginPerIp.release(req.ip);
  if (needsRehash(user.password_hash)) {
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(data.password), user.id]);
  }
  await createSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Users may edit their own name and phone. Email changes are not allowed for tenants (the owner manages them).
router.patch('/profile', requireAuth, async (req, res) => {
  const data = validate(req.body, { name: str({ min: 2, max: 100 }), phone: phone() }, { partial: true });
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`, { ...data, id: req.user.id });
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(user) });
});

// Someone with a stolen session could otherwise try current passwords here without any limit.
const changePasswordAttempts = createLimiter('change-password', 5, WINDOW, 'Too many attempts. Please wait 15 minutes and try again.');

router.post('/change-password', requireAuth, async (req, res) => {
  if (req.user.role === 'owner') {
    throw new HttpError(403, 'The owner password is set in the server configuration (OWNER_PASSWORD), not in the app.');
  }
  const data = validate(req.body, { currentPassword: secret(), newPassword: password() });
  changePasswordAttempts.hit(req.user.id);
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!(await verifyPassword(data.currentPassword, user.password_hash))) {
    securityLog('change_password_failed', { userId: user.id, ip: req.ip });
    throw badRequest('Please correct the highlighted fields', { currentPassword: 'Current password is incorrect' });
  }
  changePasswordAttempts.clear(req.user.id);
  if (data.currentPassword === data.newPassword) {
    throw badRequest('Please correct the highlighted fields', { newPassword: 'Choose a different password' });
  }
  const hash = await hashPassword(data.newPassword);
  await db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, user.id]);
  await destroyOtherSessions(user.id, req); // log out other devices
  securityLog('password_changed', { userId: user.id, ip: req.ip });
  res.json({ ok: true });
});

// ---- Tenant registration ----
// An owner adds a tenant (name + email) on the Tenants page and receives a one-time invite code for them. The tenant
// creates their account here with that email, that code and a password of their choice. Nobody else can register:
// knowing a tenant's email is not enough, and there is no way to register as an owner.
//
// Every refusal (unknown email, wrong or expired code, already registered) gets the same answer, so the form cannot be
// used to find out which emails the owner added. Attempts are limited per IP address.
const registerAttempts = createLimiter('register', 20, WINDOW, 'Too many attempts. Please wait 15 minutes and try again.');

const inviteCode = () => (v) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error('Enter the invite code from your PG owner');
  const code = normalizeInviteCode(v);
  if (!isInviteCodeShape(code)) throw new Error('An invite code has 12 letters and numbers, like ABCD-EFGH-JK23');
  return code;
};

const invalidInvite = () =>
  badRequest('This email and invite code do not match, or the code has expired. Ask your PG owner for a new code.', {
    invite_code: 'Check the code, or ask your PG owner for a new one',
  });

router.post('/tenant/register', async (req, res) => {
  const data = validate(req.body, { email: email(), invite_code: inviteCode(), password: password() });
  registerAttempts.hit(req.ip);

  // Only tenants still waiting to register can match: an owner's email, or an account that is already registered,
  // is refused exactly like an unknown email.
  const tenant = await db.get(
    "SELECT id, invite_hash, invite_expires_at FROM users WHERE lower(email) = ? AND role = 'tenant' AND registered_at IS NULL",
    [data.email],
  );
  const codeHash = hashInviteCode(data.invite_code);
  const valid = tenant && tenant.invite_expires_at > new Date().toISOString() && sameHash(tenant.invite_hash, codeHash);
  if (!valid) {
    securityLog('register_failed', { email: data.email, ip: req.ip });
    throw invalidInvite();
  }

  const hash = await hashPassword(data.password);
  // The WHERE clause makes this the single point of truth: if two requests race, only one can still find the
  // account unregistered with this code, so exactly one succeeds. The code is used up in the same statement.
  const claimed = await db.run(
    `UPDATE users SET password_hash = ?, registered_at = ?, must_change_password = 0, invite_hash = NULL, invite_expires_at = NULL
     WHERE id = ? AND role = 'tenant' AND registered_at IS NULL AND invite_hash = ?`,
    [hash, new Date().toISOString(), tenant.id, codeHash],
  );
  if (claimed.changes !== 1) throw invalidInvite();
  registerAttempts.release(req.ip);
  securityLog('registered', { userId: tenant.id, ip: req.ip });

  await createSession(req, res, tenant.id);
  res.status(201).json({ user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [tenant.id])) });
});

export default router;
