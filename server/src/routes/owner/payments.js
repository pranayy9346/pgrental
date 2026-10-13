import { Router } from 'express';
import db from '../../db.js';
import { badRequest, conflict, currentPeriod, idParam, notFound, today } from '../../lib/http.js';
import { date, int, oneOf, period, str, validate } from '../../lib/validate.js';

const router = Router();

const paymentSelect = `
  SELECT pay.*, u.id AS tenant_id, u.name AS tenant_name, r.room_number, p.name AS property_name
  FROM payments pay
  JOIN tenancies t ON t.id = pay.tenancy_id
  JOIN users u ON u.id = t.tenant_id
  JOIN rooms r ON r.id = t.room_id
  JOIN properties p ON p.id = r.property_id
  WHERE p.owner_id = @owner_id
`;

async function ownedPayment(ownerId, id) {
  const row = await db.get(`${paymentSelect} AND pay.id = @id`, { owner_id: ownerId, id });
  if (!row) throw notFound('Payment');
  return row;
}

const statusFor = (due, paid) => (paid >= due ? 'paid' : paid > 0 ? 'partial' : 'pending');

router.get('/payments', async (req, res) => {
  const q = validate(req.query, {
    period: period({ optional: true }),
    status: oneOf(['pending', 'partial', 'paid', 'unpaid'], { optional: true }),
    tenant_id: int({ min: 1, optional: true }),
  });
  let sql = paymentSelect;
  if (q.period) sql += ' AND pay.period = @period';
  if (q.status === 'unpaid') sql += " AND pay.status != 'paid'";
  else if (q.status) sql += ' AND pay.status = @status';
  if (q.tenant_id) sql += ' AND u.id = @tenant_id';
  sql += ' ORDER BY pay.period DESC, p.name, r.room_number, u.name';
  const payments = await db.all(sql, { owner_id: req.user.id, ...q });
  res.json({ payments });
});

// Creates the monthly rent charge for every active tenant who does not have one for that month yet.
router.post('/payments/generate', async (req, res) => {
  const p = validate(req.body, { period: period({ optional: true }) }).period ?? currentPeriod();
  const lastDay = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).toISOString().slice(0, 10);
  // due date = the month + the stay's due day written with two digits (due_day is always 1-28)
  const result = await db.run(
    `INSERT INTO payments (tenancy_id, period, amount_due, due_date)
     SELECT t.id, CAST(@period AS TEXT), t.monthly_rent,
            CAST(@period AS TEXT) || '-' || CASE WHEN t.due_day < 10 THEN '0' || CAST(t.due_day AS TEXT) ELSE CAST(t.due_day AS TEXT) END
     FROM tenancies t JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
     WHERE p.owner_id = @owner_id AND t.status = 'active' AND t.start_date <= CAST(@last_day AS TEXT)
       AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.tenancy_id = t.id AND x.period = CAST(@period AS TEXT))`,
    { owner_id: req.user.id, period: p, last_day: lastDay },
  );
  res.json({ created: result.changes, period: p });
});

// Record money received (can be called several times for part payments).
router.post('/payments/:id/record', async (req, res) => {
  const payment = await ownedPayment(req.user.id, idParam(req.params.id));
  const data = validate(req.body, {
    amount: int({ min: 1, max: 10_000_000 }),
    paid_on: date({ optional: true }),
    method: oneOf(['cash', 'upi', 'bank_transfer', 'card', 'other'], { optional: true }),
    note: str({ max: 300, optional: true }),
  });
  const remaining = payment.amount_due - payment.amount_paid;
  if (remaining <= 0) throw conflict('This rent is already fully paid');
  if (data.amount > remaining) {
    throw badRequest('Please correct the highlighted fields', { amount: `Only ₹${remaining} is outstanding` });
  }
  const paid = payment.amount_paid + data.amount;
  await db.run(
    `UPDATE payments SET amount_paid = ?, status = ?, paid_on = ?, method = COALESCE(?, method), note = COALESCE(?, note)
     WHERE id = ?`,
    [paid, statusFor(payment.amount_due, paid), data.paid_on ?? today(), data.method, data.note, payment.id],
  );
  res.json({ payment: await ownedPayment(req.user.id, payment.id) });
});

// Adjust the amount due (e.g. add an electricity charge) or the note.
router.patch('/payments/:id', async (req, res) => {
  const payment = await ownedPayment(req.user.id, idParam(req.params.id));
  const data = validate(
    req.body,
    { amount_due: int({ min: 0, max: 10_000_000 }), due_date: date(), note: str({ max: 300, optional: true }) },
    { partial: true },
  );
  const due = data.amount_due ?? payment.amount_due;
  if (due < payment.amount_paid) {
    throw badRequest('Please correct the highlighted fields', {
      amount_due: `Cannot be less than the ₹${payment.amount_paid} already paid`,
    });
  }
  await db.run('UPDATE payments SET amount_due = ?, due_date = ?, note = ?, status = ? WHERE id = ?', [
    due,
    data.due_date ?? payment.due_date,
    'note' in data ? data.note : payment.note,
    statusFor(due, payment.amount_paid),
    payment.id,
  ]);
  res.json({ payment: await ownedPayment(req.user.id, payment.id) });
});

router.delete('/payments/:id', async (req, res) => {
  const payment = await ownedPayment(req.user.id, idParam(req.params.id));
  if (payment.amount_paid > 0) throw conflict('A charge that has money recorded against it cannot be deleted');
  await db.run('DELETE FROM payments WHERE id = ?', [payment.id]);
  res.json({ ok: true });
});

export default router;
