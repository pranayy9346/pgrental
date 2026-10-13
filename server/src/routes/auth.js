import { Router } from 'express';
import db from '../db.js';
import {
  checkLoginRate,
  clearLoginFailures,
  createSession,
  destroyOtherSessions,
  destroySession,
  hashPassword,
  publicUser,
  recordLoginFailure,
  requireAuth,
  verifyAgainstDummy,
  verifyPassword,
} from '../lib/auth.js';
import { HttpError, badRequest, conflict } from '../lib/http.js';
import { email, password, phone, str, validate } from '../lib/validate.js';

const router = Router();

// Anyone can sign up as a PG owner. Tenant accounts are created by their owner (see routes/owner/tenants.js).
router.post('/register-owner', async (req, res) => {
  const data = validate(req.body, {
    name: str({ min: 2, max: 100 }),
    email: email(),
    phone: phone(),
    password: password(),
  });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(data.email)) {
    throw conflict('An account with this email already exists');
  }
  const hash = await hashPassword(data.password);
  const { lastInsertRowid } = db
    .prepare("INSERT INTO users (role, name, email, phone, password_hash) VALUES ('owner', ?, ?, ?, ?)")
    .run(data.name, data.email, data.phone, hash);
  createSession(res, lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const data = validate(req.body, { email: email(), password: str({ max: 128 }) });
  const key = `${req.ip}|${data.email}`;
  checkLoginRate(key);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email);
  const ok = user ? await verifyPassword(data.password, user.password_hash) : await verifyAgainstDummy(data.password);
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

export default router;
