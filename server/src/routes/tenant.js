// Tenant API. Every query here is filtered by req.user.id, so a tenant only ever sees their own data.
import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../lib/auth.js';
import { badRequest, conflict, currentPeriod, idParam, notFound, today } from '../lib/http.js';
import { date, oneOf, str, validate } from '../lib/validate.js';

const router = Router();
router.use(requireRole('tenant'));

function currentStay(tenantId) {
  return (
    db
      .prepare(
        `SELECT t.id, t.start_date, t.monthly_rent, t.deposit, t.due_day,
                r.room_number, r.capacity, r.notes AS room_notes,
                p.id AS property_id, p.name AS property_name, p.address, p.city,
                o.name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
                (SELECT COUNT(*) FROM tenancies x WHERE x.room_id = r.id AND x.status = 'active') AS occupied
         FROM tenancies t JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
         JOIN users o ON o.id = p.owner_id
         WHERE t.tenant_id = ? AND t.status = 'active'`,
      )
      .get(tenantId) || null
  );
}

const paymentsFor = db.prepare(`
  SELECT pay.id, pay.period, pay.amount_due, pay.amount_paid, pay.status, pay.due_date, pay.paid_on,
         pay.method, pay.note, r.room_number, p.name AS property_name
  FROM payments pay JOIN tenancies t ON t.id = pay.tenancy_id
  JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
  WHERE t.tenant_id = ? ORDER BY pay.period DESC
`);

const vacateFor = db.prepare(`
  SELECT v.id, v.requested_date, v.reason, v.status, v.owner_note, v.created_at, v.decided_at,
         r.room_number, p.name AS property_name
  FROM vacate_requests v JOIN tenancies t ON t.id = v.tenancy_id
  JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
  WHERE t.tenant_id = ? ORDER BY v.created_at DESC, v.id DESC
`);

const noticesFor = db.prepare(`
  SELECT n.id, n.title, n.body, n.created_at FROM notices n
  WHERE n.property_id = ? ORDER BY n.created_at DESC, n.id DESC
`);

router.get('/dashboard', (req, res) => {
  const stay = currentStay(req.user.id);
  const payments = paymentsFor.all(req.user.id);
  const thisMonth = payments.find((p) => p.period === currentPeriod()) || null;
  const balanceDue = payments.reduce((sum, p) => sum + (p.amount_due - p.amount_paid), 0);
  const notices = stay ? noticesFor.all(stay.property_id).slice(0, 5) : [];
  const { open_complaints } = db
    .prepare(
      `SELECT COUNT(*) AS open_complaints FROM complaints c JOIN tenancies t ON t.id = c.tenancy_id
       WHERE t.tenant_id = ? AND c.status != 'resolved'`,
    )
    .get(req.user.id);
  const vacateRequest = vacateFor.all(req.user.id).find((v) => v.status === 'pending') || null;
  res.json({ stay, thisMonth, balanceDue, notices, openComplaints: open_complaints, vacateRequest });
});

router.get('/payments', (req, res) => {
  res.json({ payments: paymentsFor.all(req.user.id) });
});

router.get('/notices', (req, res) => {
  const stay = currentStay(req.user.id);
  res.json({ notices: stay ? noticesFor.all(stay.property_id) : [] });
});

router.get('/complaints', (req, res) => {
  const complaints = db
    .prepare(
      `SELECT c.id, c.title, c.description, c.category, c.status, c.owner_reply, c.created_at, c.updated_at,
              r.room_number, p.name AS property_name
       FROM complaints c JOIN tenancies t ON t.id = c.tenancy_id
       JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
       WHERE t.tenant_id = ? ORDER BY c.created_at DESC, c.id DESC`,
    )
    .all(req.user.id);
  res.json({ complaints });
});

router.post('/complaints', (req, res) => {
  const stay = currentStay(req.user.id);
  if (!stay) throw conflict('You can raise a complaint only while you have an active stay');
  const data = validate(req.body, {
    title: str({ min: 3, max: 150 }),
    description: str({ min: 5, max: 2000 }),
    category: oneOf(['electrical', 'plumbing', 'cleaning', 'internet', 'furniture', 'food', 'other'], {
      optional: true,
    }),
  });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO complaints (tenancy_id, title, description, category) VALUES (?, ?, ?, ?)')
    .run(stay.id, data.title, data.description, data.category ?? 'other');
  res.status(201).json({ complaint: db.prepare('SELECT * FROM complaints WHERE id = ?').get(lastInsertRowid) });
});

// ---- Vacate (move-out) requests ----

router.get('/vacate-requests', (req, res) => {
  res.json({ requests: vacateFor.all(req.user.id) });
});

router.post('/vacate-requests', (req, res) => {
  const stay = currentStay(req.user.id);
  if (!stay) throw conflict('You do not have an active stay');
  const data = validate(req.body, { requested_date: date(), reason: str({ max: 500, optional: true }) });
  if (data.requested_date < today()) {
    throw badRequest('Please correct the highlighted fields', { requested_date: 'Choose today or a future date' });
  }
  if (data.requested_date < stay.start_date) {
    throw badRequest('Please correct the highlighted fields', { requested_date: 'Cannot be before your move-in date' });
  }
  if (db.prepare("SELECT 1 FROM vacate_requests WHERE tenancy_id = ? AND status = 'pending'").get(stay.id)) {
    throw conflict('You already have a pending request. Cancel it first to submit a new one.');
  }
  db.prepare('INSERT INTO vacate_requests (tenancy_id, requested_date, reason) VALUES (?, ?, ?)').run(
    stay.id,
    data.requested_date,
    data.reason,
  );
  res.status(201).json({ requests: vacateFor.all(req.user.id) });
});

router.post('/vacate-requests/:id/cancel', (req, res) => {
  const result = db
    .prepare(
      `UPDATE vacate_requests SET status = 'cancelled', decided_at = datetime('now')
       WHERE id = ? AND status = 'pending' AND tenancy_id IN (SELECT id FROM tenancies WHERE tenant_id = ?)`,
    )
    .run(idParam(req.params.id), req.user.id);
  if (!result.changes) throw notFound('Pending request');
  res.json({ requests: vacateFor.all(req.user.id) });
});

export default router;
