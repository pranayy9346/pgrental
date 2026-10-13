import crypto from 'node:crypto';
import { Router } from 'express';
import db from '../../db.js';
import { hashPassword } from '../../lib/auth.js';
import { badRequest, conflict, idParam, today } from '../../lib/http.js';
import { date, email, int, oneOf, phone, str, validate } from '../../lib/validate.js';
import { activeTenancy, ownedRoom, ownedTenant } from './access.js';

const router = Router();

// Readable temporary password, e.g. "pg-7Hk2-x9Qa". Shown to the owner once; the tenant must change it.
function temporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => chars[b % chars.length]).join('');
  return `pg-${pick(4)}-${pick(4)}`;
}

const tenantSelect = `
  SELECT u.id, u.name, u.email, u.phone, u.created_at,
         t.id AS tenancy_id, t.start_date, t.monthly_rent, t.deposit, t.due_day,
         r.id AS room_id, r.room_number, p.id AS property_id, p.name AS property_name,
         (SELECT COALESCE(SUM(pay.amount_due - pay.amount_paid), 0)
          FROM payments pay JOIN tenancies t2 ON t2.id = pay.tenancy_id
          WHERE t2.tenant_id = u.id) AS balance_due
  FROM users u
  LEFT JOIN tenancies t ON t.tenant_id = u.id AND t.status = 'active'
  LEFT JOIN rooms r ON r.id = t.room_id
  LEFT JOIN properties p ON p.id = r.property_id
  WHERE u.role = 'tenant' AND u.owner_id = ?
`;

router.get('/tenants', (req, res) => {
  const { status = 'all' } = validate(req.query, { status: oneOf(['active', 'past', 'all'], { optional: true }) });
  let where = '';
  if (status === 'active') where = ' AND t.id IS NOT NULL';
  if (status === 'past') where = ' AND t.id IS NULL';
  const tenants = db.prepare(`${tenantSelect}${where} ORDER BY u.name COLLATE NOCASE`).all(req.user.id);
  res.json({ tenants });
});

router.get('/tenants/:id', (req, res) => {
  const tenant = ownedTenant(req.user.id, idParam(req.params.id));
  const summary = db.prepare(`${tenantSelect} AND u.id = ?`).get(req.user.id, tenant.id);
  const tenancies = db
    .prepare(
      `SELECT t.*, r.room_number, p.name AS property_name
       FROM tenancies t JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
       WHERE t.tenant_id = ? ORDER BY t.start_date DESC, t.id DESC`,
    )
    .all(tenant.id);
  const payments = db
    .prepare(
      `SELECT pay.* FROM payments pay JOIN tenancies t ON t.id = pay.tenancy_id
       WHERE t.tenant_id = ? ORDER BY pay.period DESC`,
    )
    .all(tenant.id);
  res.json({ tenant: summary, tenancies, payments });
});

const assignmentSchema = {
  room_id: int({ min: 1 }),
  start_date: date(),
  monthly_rent: int({ min: 0, max: 10_000_000, optional: true }),
  deposit: int({ min: 0, max: 10_000_000, optional: true }),
  due_day: int({ min: 1, max: 28, optional: true }),
};

// Puts a tenant into a room. Must be called inside a transaction.
function placeInRoom(ownerId, tenantId, data) {
  const room = ownedRoom(ownerId, data.room_id);
  if (room.occupied >= room.capacity) throw conflict(`Room ${room.room_number} is full`);
  db.prepare(
    `INSERT INTO tenancies (tenant_id, room_id, start_date, monthly_rent, deposit, due_day)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(tenantId, room.id, data.start_date, data.monthly_rent ?? room.monthly_rent, data.deposit ?? 0, data.due_day ?? 5);
}

// Ends a stay and cancels any vacate request still waiting on it.
export function endTenancy(tenancyId, endDate) {
  db.prepare("UPDATE tenancies SET status = 'ended', end_date = ? WHERE id = ?").run(endDate, tenancyId);
  db.prepare(
    "UPDATE vacate_requests SET status = 'cancelled', decided_at = datetime('now') WHERE tenancy_id = ? AND status = 'pending'",
  ).run(tenancyId);
}

// Create a tenant login and (optionally) place them in a room in one step.
router.post('/tenants', async (req, res) => {
  const data = validate(req.body, {
    name: str({ min: 2, max: 100 }),
    email: email(),
    phone: phone(),
    room_id: int({ min: 1, optional: true }),
  });
  const assignment = data.room_id ? validate(req.body, assignmentSchema) : null;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(data.email)) {
    throw conflict('An account with this email already exists');
  }
  const tempPassword = temporaryPassword();
  const hash = await hashPassword(tempPassword);

  const id = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO users (role, name, email, phone, password_hash, owner_id, must_change_password)
         VALUES ('tenant', ?, ?, ?, ?, ?, 1)`,
      )
      .run(data.name, data.email, data.phone, hash, req.user.id);
    if (assignment) placeInRoom(req.user.id, lastInsertRowid, assignment);
    return lastInsertRowid;
  })();

  const tenant = db.prepare(`${tenantSelect} AND u.id = ?`).get(req.user.id, id);
  res.status(201).json({ tenant, tempPassword });
});

router.patch('/tenants/:id', (req, res) => {
  const tenant = ownedTenant(req.user.id, idParam(req.params.id));
  const data = validate(req.body, { name: str({ min: 2, max: 100 }), email: email(), phone: phone() }, { partial: true });
  if (data.email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(data.email, tenant.id)) {
    throw conflict('An account with this email already exists');
  }
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run({ ...data, id: tenant.id });
  res.json({ tenant: db.prepare(`${tenantSelect} AND u.id = ?`).get(req.user.id, tenant.id) });
});

router.post('/tenants/:id/reset-password', async (req, res) => {
  const tenant = ownedTenant(req.user.id, idParam(req.params.id));
  const tempPassword = temporaryPassword();
  const hash = await hashPassword(tempPassword);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, tenant.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(tenant.id);
  })();
  res.json({ tempPassword });
});

// Assign a tenant to a room. If they already live somewhere, this is a room transfer:
// the old stay ends on the new start date.
router.post('/tenants/:id/assign', (req, res) => {
  const tenant = ownedTenant(req.user.id, idParam(req.params.id));
  const data = validate(req.body, assignmentSchema);
  db.transaction(() => {
    const current = activeTenancy(tenant.id);
    if (current) {
      if (current.room_id === data.room_id) throw conflict('Tenant is already in this room');
      if (data.start_date < current.start_date) {
        throw badRequest('Please correct the highlighted fields', {
          start_date: `Must be on or after the current stay's start date (${current.start_date})`,
        });
      }
      endTenancy(current.id, data.start_date);
    }
    placeInRoom(req.user.id, tenant.id, data);
  })();
  res.json({ tenant: db.prepare(`${tenantSelect} AND u.id = ?`).get(req.user.id, tenant.id) });
});

// Change the rent, due day or deposit of the current stay. Applies to charges created from now on;
// existing charges can be edited on the Rent & Payments page.
router.patch('/tenants/:id/tenancy', (req, res) => {
  const tenant = ownedTenant(req.user.id, idParam(req.params.id));
  const current = activeTenancy(tenant.id);
  if (!current) throw conflict('This tenant does not have an active stay');
  const data = validate(
    req.body,
    { monthly_rent: int({ max: 10_000_000 }), due_day: int({ min: 1, max: 28 }), deposit: int({ max: 10_000_000 }) },
    { partial: true },
  );
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE tenancies SET ${sets.join(', ')} WHERE id = @id`).run({ ...data, id: current.id });
  res.json({ tenant: db.prepare(`${tenantSelect} AND u.id = ?`).get(req.user.id, tenant.id) });
});

router.post('/tenants/:id/move-out', (req, res) => {
  const tenant = ownedTenant(req.user.id, idParam(req.params.id));
  const { end_date } = validate(req.body, { end_date: date({ optional: true }) });
  const current = activeTenancy(tenant.id);
  if (!current) throw conflict('This tenant does not have an active stay');
  const endDate = end_date ?? today();
  if (endDate < current.start_date) {
    throw badRequest('Please correct the highlighted fields', {
      end_date: `Must be on or after the move-in date (${current.start_date})`,
    });
  }
  endTenancy(current.id, endDate);
  res.json({ tenant: db.prepare(`${tenantSelect} AND u.id = ?`).get(req.user.id, tenant.id) });
});

export default router;
