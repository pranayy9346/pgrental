import { Router } from 'express';
import db from '../db.js';
import {
  checkLoginRate,
  clearLoginFailures,
  createLimiter,
  createSession,
  destroyOtherSessions,
  destroySession,
  hashPassword,
  mayUseApp,
  publicUser,
  recordLoginFailure,
  requireAuth,
  verifyAgainstDummy,
  verifyPassword,
} from '../lib/auth.js';
import { HttpError, badRequest, conflict } from '../lib/http.js';
import { email, password, phone, str, validate } from '../lib/validate.js';

const router = Router();

// There is no owner sign-up: the single owner account comes from server configuration (see lib/owner.js).
// Tenant accounts are added by the owner and registered by the tenant (see the tenant section below).

router.post('/login', async (req, res) => {
  const data = validate(req.body, { email: email(), password: str({ max: 128 }) });
  const key = `${req.ip}|${data.email}`;
  checkLoginRate(key);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email);
  const ok = user && mayUseApp(user) ? await verifyPassword(data.password, user.password_hash) : await verifyAgainstDummy(data.password);
  if (!ok) {
    recordLoginFailure(key);
    throw new HttpError(401, 'Incorrect email or password');
  }
  clearLoginFailures(key);
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Users may edit their own name and phone. Email changes are not allowed for tenants (the owner manages them).
router.patch('/profile', requireAuth, (req, res) => {
  const data = validate(req.body, { name: str({ min: 2, max: 100 }), phone: phone() }, { partial: true });
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run({ ...data, id: req.user.id });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  if (req.user.role === 'owner') {
    throw new HttpError(403, 'The owner password is set in the server configuration (OWNER_PASSWORD), not in the app.');
  }
  const data = validate(req.body, { currentPassword: str({ max: 128 }), newPassword: password() });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await verifyPassword(data.currentPassword, user.password_hash))) {
    throw badRequest('Please correct the highlighted fields', { currentPassword: 'Current password is incorrect' });
  }
  if (data.currentPassword === data.newPassword) {
    throw badRequest('Please correct the highlighted fields', { newPassword: 'Choose a different password' });
  }
  const hash = await hashPassword(data.newPassword);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
  destroyOtherSessions(user.id, req); // log out other devices
  res.json({ ok: true });
});

// ---- Tenant registration ----
// An owner adds a tenant (name + email) on the Tenants page. That tenant can then create their account here with
// that exact email (case-insensitive) and a password of their choice. Nobody else can register: unknown emails are
// refused and there is no way to register as an owner.

// Failed attempts (unknown or already-registered email) are limited per IP so the form cannot be used to guess
// which emails the owner added.
const registerFailures = createLimiter(20, 15 * 60_000, 'Too many attempts. Please wait 15 minutes and try again.');

const alreadyRegistered = () => conflict('An account with this email already exists. Please log in instead.');

router.post('/tenant/register', async (req, res) => {
  const data = validate(req.body, { email: email(), password: password() });
  registerFailures.check(req.ip);

  // Only tenant rows count: an owner's email is treated like any other email the owner has not added.
  const tenant = db.prepare("SELECT id, registered_at FROM users WHERE email = ? AND role = 'tenant'").get(data.email);
  if (!tenant) {
    registerFailures.fail(req.ip);
    throw new HttpError(404, 'This email has not been added by a PG owner. Ask your owner to add it on the Tenants page first.');
  }
  if (tenant.registered_at) {
    registerFailures.fail(req.ip);
    throw alreadyRegistered();
  }

  const hash = await hashPassword(data.password);
  // The WHERE clause makes this the single point of truth: if two requests race, only one can still find the
  // account unregistered, so exactly one succeeds and the other gets the "already exists" answer.
  const claimed = db
    .prepare(
      `UPDATE users SET password_hash = ?, registered_at = ?, must_change_password = 0
       WHERE id = ? AND role = 'tenant' AND registered_at IS NULL`,
    )
    .run(hash, new Date().toISOString(), tenant.id);
  if (claimed.changes !== 1) throw alreadyRegistered();

  createSession(res, tenant.id);
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(tenant.id)) });
});

export default router;
