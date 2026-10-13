import { Router } from 'express';
import db from '../../db.js';
import { badRequest, conflict, idParam, nowStamp, today } from '../../lib/http.js';
import { date, email, int, oneOf, phone, str, validate } from '../../lib/validate.js';
import { activeTenancy, ownedRoom, ownedTenant } from './access.js';

const router = Router();

const tenantSelect = `
  SELECT u.id, u.name, u.email, u.phone, u.created_at, u.registered_at,
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

const tenantSummary = (ownerId, tenantId, q = db) => q.get(`${tenantSelect} AND u.id = ?`, [ownerId, tenantId]);

router.get('/tenants', async (req, res) => {
  const { status = 'all' } = validate(req.query, { status: oneOf(['active', 'past', 'all'], { optional: true }) });
  let where = '';
  if (status === 'active') where = ' AND t.id IS NOT NULL';
  if (status === 'past') where = ' AND t.id IS NULL';
  const tenants = await db.all(`${tenantSelect}${where} ORDER BY lower(u.name)`, [req.user.id]);
  res.json({ tenants });
});

router.get('/tenants/:id', async (req, res) => {
  const tenant = await ownedTenant(req.user.id, idParam(req.params.id));
  const summary = await tenantSummary(req.user.id, tenant.id);
  const tenancies = await db.all(
    `SELECT t.*, r.room_number, p.name AS property_name
     FROM tenancies t JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
     WHERE t.tenant_id = ? ORDER BY t.start_date DESC, t.id DESC`,
    [tenant.id],
  );
  const payments = await db.all(
    `SELECT pay.* FROM payments pay JOIN tenancies t ON t.id = pay.tenancy_id
     WHERE t.tenant_id = ? ORDER BY pay.period DESC`,
    [tenant.id],
  );
  res.json({ tenant: summary, tenancies, payments });
});

const assignmentSchema = {
  room_id: int({ min: 1 }),
  start_date: date(),
  monthly_rent: int({ min: 0, max: 10_000_000, optional: true }),
  deposit: int({ min: 0, max: 10_000_000, optional: true }),
  due_day: int({ min: 1, max: 28, optional: true }),
};

// Puts a tenant into a room. Must be called inside a transaction; `tx` is that transaction.
async function placeInRoom(tx, ownerId, tenantId, data) {
  const room = await ownedRoom(ownerId, data.room_id, tx);
  if (room.occupied >= room.capacity) throw conflict(`Room ${room.room_number} is full`);
  await tx.run(
    `INSERT INTO tenancies (tenant_id, room_id, start_date, monthly_rent, deposit, due_day)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, room.id, data.start_date, data.monthly_rent ?? room.monthly_rent, data.deposit ?? 0, data.due_day ?? 5],
  );
}

// Ends a stay and cancels any vacate request still waiting on it. `q` is `db` or a transaction.
export async function endTenancy(q, tenancyId, endDate) {
  await q.run("UPDATE tenancies SET status = 'ended', end_date = ? WHERE id = ?", [endDate, tenancyId]);
  await q.run(
    "UPDATE vacate_requests SET status = 'cancelled', decided_at = ? WHERE tenancy_id = ? AND status = 'pending'",
    [nowStamp(), tenancyId],
  );
}

// Add a tenant to the owner's PG and (optionally) put them in a room. This does not create a login yet:
// the tenant registers themselves with this email and chooses their own password.
router.post('/tenants', async (req, res) => {
  const data = validate(req.body, {
    name: str({ min: 2, max: 100 }),
    email: email(),
    phone: phone(),
    room_id: int({ min: 1, optional: true }),
  });
  const assignment = data.room_id ? validate(req.body, assignmentSchema) : null;
  if (await db.get('SELECT 1 AS ok FROM users WHERE lower(email) = ?', [data.email])) {
    throw conflict('An account with this email already exists');
  }

  const id = await db.transaction(async (tx) => {
    // '!' can never match a real password hash, so this account cannot log in until the tenant registers.
    const newId = await tx.insert(
      `INSERT INTO users (role, name, email, phone, password_hash, owner_id)
       VALUES ('tenant', ?, ?, ?, '!', ?)`,
      [data.name, data.email, data.phone, req.user.id],
    );
    if (assignment) await placeInRoom(tx, req.user.id, newId, assignment);
    return newId;
  });

  res.status(201).json({ tenant: await tenantSummary(req.user.id, id) });
});

router.patch('/tenants/:id', async (req, res) => {
  const tenant = await ownedTenant(req.user.id, idParam(req.params.id));
  const data = validate(req.body, { name: str({ min: 2, max: 100 }), email: email(), phone: phone() }, { partial: true });
  if (data.email && data.email !== tenant.email && tenant.registered_at) {
    throw conflict('This tenant has already registered, so their email cannot be changed');
  }
  if (data.email && (await db.get('SELECT 1 AS ok FROM users WHERE lower(email) = ? AND id != ?', [data.email, tenant.id]))) {
    throw conflict('An account with this email already exists');
  }
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`, { ...data, id: tenant.id });
  res.json({ tenant: await tenantSummary(req.user.id, tenant.id) });
});

// Forgotten password / lost access: the tenant is logged out everywhere and must register again
// with a new password, exactly like a newly added tenant.
router.post('/tenants/:id/reset-access', async (req, res) => {
  const tenant = await ownedTenant(req.user.id, idParam(req.params.id));
  await db.transaction(async (tx) => {
    await tx.run("UPDATE users SET password_hash = '!', registered_at = NULL, must_change_password = 0 WHERE id = ?", [tenant.id]);
    await tx.run('DELETE FROM sessions WHERE user_id = ?', [tenant.id]);
  });
  res.json({ tenant: await tenantSummary(req.user.id, tenant.id) });
});

// Assign a tenant to a room. If they already live somewhere, this is a room transfer:
// the old stay ends on the new start date.
router.post('/tenants/:id/assign', async (req, res) => {
  const tenant = await ownedTenant(req.user.id, idParam(req.params.id));
  const data = validate(req.body, assignmentSchema);
  await db.transaction(async (tx) => {
    const current = await activeTenancy(tenant.id, tx);
    if (current) {
      if (current.room_id === data.room_id) throw conflict('Tenant is already in this room');
      if (data.start_date < current.start_date) {
        throw badRequest('Please correct the highlighted fields', {
          start_date: `Must be on or after the current stay's start date (${current.start_date})`,
        });
      }
      await endTenancy(tx, current.id, data.start_date);
    }
    await placeInRoom(tx, req.user.id, tenant.id, data);
  });
  res.json({ tenant: await tenantSummary(req.user.id, tenant.id) });
});

// Change the rent, due day or deposit of the current stay. Applies to charges created from now on;
// existing charges can be edited on the Rent & Payments page.
router.patch('/tenants/:id/tenancy', async (req, res) => {
  const tenant = await ownedTenant(req.user.id, idParam(req.params.id));
  const current = await activeTenancy(tenant.id);
  if (!current) throw conflict('This tenant does not have an active stay');
  const data = validate(
    req.body,
    { monthly_rent: int({ max: 10_000_000 }), due_day: int({ min: 1, max: 28 }), deposit: int({ max: 10_000_000 }) },
    { partial: true },
  );
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  await db.run(`UPDATE tenancies SET ${sets.join(', ')} WHERE id = @id`, { ...data, id: current.id });
  res.json({ tenant: await tenantSummary(req.user.id, tenant.id) });
});

router.post('/tenants/:id/move-out', async (req, res) => {
  const tenant = await ownedTenant(req.user.id, idParam(req.params.id));
  const { end_date } = validate(req.body, { end_date: date({ optional: true }) });
  const current = await activeTenancy(tenant.id);
  if (!current) throw conflict('This tenant does not have an active stay');
  const endDate = end_date ?? today();
  if (endDate < current.start_date) {
    throw badRequest('Please correct the highlighted fields', {
      end_date: `Must be on or after the move-in date (${current.start_date})`,
    });
  }
  await db.transaction((tx) => endTenancy(tx, current.id, endDate));
  res.json({ tenant: await tenantSummary(req.user.id, tenant.id) });
});

export default router;
