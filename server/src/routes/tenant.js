// Tenant API. Every query here is filtered by req.user.id, so a tenant only ever sees their own data.
import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../lib/auth.js';
import { badRequest, conflict, currentPeriod, idParam, notFound, nowStamp, today } from '../lib/http.js';
import { dateLabel, notify } from '../lib/notify.js';
import { date, oneOf, str, validate } from '../lib/validate.js';

const router = Router();
router.use(requireRole('tenant'));

async function currentStay(tenantId) {
  return (
    (await db.get(
      `SELECT t.id, t.start_date, t.monthly_rent, t.deposit, t.due_day,
              r.room_number, r.capacity, r.notes AS room_notes,
              p.id AS property_id, p.name AS property_name, p.address, p.city,
              o.name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
              (SELECT COUNT(*) FROM tenancies x WHERE x.room_id = r.id AND x.status = 'active') AS occupied
       FROM tenancies t JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
       JOIN users o ON o.id = p.owner_id
       WHERE t.tenant_id = ? AND t.status = 'active'`,
      [tenantId],
    )) || null
  );
}

const paymentsFor = (tenantId) =>
  db.all(
    `SELECT pay.id, pay.period, pay.amount_due, pay.amount_paid, pay.status, pay.due_date, pay.paid_on,
            pay.method, pay.note, r.room_number, p.name AS property_name
     FROM payments pay JOIN tenancies t ON t.id = pay.tenancy_id
     JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
     WHERE t.tenant_id = ? ORDER BY pay.period DESC`,
    [tenantId],
  );

const vacateFor = (tenantId) =>
  db.all(
    `SELECT v.id, v.requested_date, v.reason, v.status, v.owner_note, v.created_at, v.decided_at,
            r.room_number, p.name AS property_name
     FROM vacate_requests v JOIN tenancies t ON t.id = v.tenancy_id
     JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
     WHERE t.tenant_id = ? ORDER BY v.created_at DESC, v.id DESC`,
    [tenantId],
  );

const noticesFor = (propertyId) =>
  db.all(
    `SELECT n.id, n.title, n.body, n.created_at FROM notices n
     WHERE n.property_id = ? ORDER BY n.created_at DESC, n.id DESC`,
    [propertyId],
  );

router.get('/dashboard', async (req, res) => {
  const stay = await currentStay(req.user.id);
  const payments = await paymentsFor(req.user.id);
  const thisMonth = payments.find((p) => p.period === currentPeriod()) || null;
  const balanceDue = payments.reduce((sum, p) => sum + (p.amount_due - p.amount_paid), 0);
  const notices = stay ? (await noticesFor(stay.property_id)).slice(0, 5) : [];
  const { open_complaints } = await db.get(
    `SELECT COUNT(*) AS open_complaints FROM complaints c JOIN tenancies t ON t.id = c.tenancy_id
     WHERE t.tenant_id = ? AND c.status != 'resolved'`,
    [req.user.id],
  );
  const vacateRequest = (await vacateFor(req.user.id)).find((v) => v.status === 'pending') || null;
  res.json({ stay, thisMonth, balanceDue, notices, openComplaints: open_complaints, vacateRequest });
});

router.get('/payments', async (req, res) => {
  res.json({ payments: await paymentsFor(req.user.id) });
});

router.get('/notices', async (req, res) => {
  const stay = await currentStay(req.user.id);
  res.json({ notices: stay ? await noticesFor(stay.property_id) : [] });
});

router.get('/complaints', async (req, res) => {
  const complaints = await db.all(
    `SELECT c.id, c.title, c.description, c.category, c.status, c.owner_reply, c.created_at, c.updated_at,
            r.room_number, p.name AS property_name
     FROM complaints c JOIN tenancies t ON t.id = c.tenancy_id
     JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
     WHERE t.tenant_id = ? ORDER BY c.created_at DESC, c.id DESC`,
    [req.user.id],
  );
  res.json({ complaints });
});

router.post('/complaints', async (req, res) => {
  const stay = await currentStay(req.user.id);
  if (!stay) throw conflict('You can raise a complaint only while you have an active stay');
  const data = validate(req.body, {
    title: str({ min: 3, max: 150 }),
    description: str({ min: 5, max: 2000 }),
    category: oneOf(['electrical', 'plumbing', 'cleaning', 'internet', 'furniture', 'food', 'other'], {
      optional: true,
    }),
  });
  // The complaint and the owner's notification are created together or not at all.
  const id = await db.transaction(async (tx) => {
    const complaintId = await tx.insert('INSERT INTO complaints (tenancy_id, title, description, category) VALUES (?, ?, ?, ?)', [
      stay.id,
      data.title,
      data.description,
      data.category ?? 'other',
    ]);
    await notify(tx, {
      to: req.user.owner_id,
      type: 'complaint.new',
      entityId: complaintId,
      title: `New complaint: ${data.title}`,
      body: `${req.user.name} (Room ${stay.room_number}): ${data.description}`,
    });
    return complaintId;
  });
  res.status(201).json({ complaint: await db.get('SELECT * FROM complaints WHERE id = ?', [id]) });
});

// ---- Vacate (move-out) requests ----

router.get('/vacate-requests', async (req, res) => {
  res.json({ requests: await vacateFor(req.user.id) });
});

router.post('/vacate-requests', async (req, res) => {
  const stay = await currentStay(req.user.id);
  if (!stay) throw conflict('You do not have an active stay');
  const data = validate(req.body, { requested_date: date(), reason: str({ max: 500, optional: true }) });
  if (data.requested_date < today()) {
    throw badRequest('Please correct the highlighted fields', { requested_date: 'Choose today or a future date' });
  }
  if (data.requested_date < stay.start_date) {
    throw badRequest('Please correct the highlighted fields', { requested_date: 'Cannot be before your move-in date' });
  }
  if (await db.get("SELECT 1 AS ok FROM vacate_requests WHERE tenancy_id = ? AND status = 'pending'", [stay.id])) {
    throw conflict('You already have a pending request. Cancel it first to submit a new one.');
  }
  await db.transaction(async (tx) => {
    const requestId = await tx.insert('INSERT INTO vacate_requests (tenancy_id, requested_date, reason) VALUES (?, ?, ?)', [
      stay.id,
      data.requested_date,
      data.reason,
    ]);
    await notify(tx, {
      to: req.user.owner_id,
      type: 'vacate.requested',
      entityId: requestId,
      title: `Move-out request from ${req.user.name}`,
      body: `Room ${stay.room_number}: wants to leave on ${dateLabel(data.requested_date)}.`,
    });
  });
  res.status(201).json({ requests: await vacateFor(req.user.id) });
});

router.post('/vacate-requests/:id/cancel', async (req, res) => {
  const id = idParam(req.params.id);
  await db.transaction(async (tx) => {
    const result = await tx.run(
      `UPDATE vacate_requests SET status = 'cancelled', decided_at = ?
       WHERE id = ? AND status = 'pending' AND tenancy_id IN (SELECT id FROM tenancies WHERE tenant_id = ?)`,
      [nowStamp(), id, req.user.id],
    );
    if (!result.changes) throw notFound('Pending request');
    await notify(tx, {
      to: req.user.owner_id,
      type: 'vacate.withdrawn',
      entityId: id,
      title: `${req.user.name} withdrew their move-out request`,
    });
  });
  res.json({ requests: await vacateFor(req.user.id) });
});

export default router;
