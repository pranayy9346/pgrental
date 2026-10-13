import { Router } from 'express';
import db from '../../db.js';
import { badRequest, conflict, idParam, notFound } from '../../lib/http.js';
import { str, validate } from '../../lib/validate.js';
import { endTenancy } from './tenants.js';

const router = Router();

const vacateSelect = `
  SELECT v.*, t.start_date, t.status AS tenancy_status, u.id AS tenant_id, u.name AS tenant_name, u.phone AS tenant_phone,
         r.room_number, p.name AS property_name,
         (SELECT COALESCE(SUM(pay.amount_due - pay.amount_paid), 0) FROM payments pay
          JOIN tenancies t2 ON t2.id = pay.tenancy_id WHERE t2.tenant_id = u.id) AS balance_due
  FROM vacate_requests v
  JOIN tenancies t ON t.id = v.tenancy_id
  JOIN users u ON u.id = t.tenant_id
  JOIN rooms r ON r.id = t.room_id
  JOIN properties p ON p.id = r.property_id
  WHERE p.owner_id = @owner_id
`;

function ownedRequest(ownerId, id) {
  const row = db.prepare(`${vacateSelect} AND v.id = @id`).get({ owner_id: ownerId, id });
  if (!row) throw notFound('Vacate request');
  return row;
}

router.get('/vacate-requests', (req, res) => {
  const requests = db
    .prepare(`${vacateSelect} ORDER BY CASE v.status WHEN 'pending' THEN 0 ELSE 1 END, v.created_at DESC, v.id DESC`)
    .all({ owner_id: req.user.id });
  res.json({ requests });
});

// Approving ends the tenant's stay on the date they asked for.
router.post('/vacate-requests/:id/approve', (req, res) => {
  const request = ownedRequest(req.user.id, idParam(req.params.id));
  const { owner_note } = validate(req.body, { owner_note: str({ max: 500, optional: true }) });
  if (request.status !== 'pending') throw conflict(`This request was already ${request.status}`);
  if (request.requested_date < request.start_date) {
    throw badRequest('The requested date is before the tenant moved in. Reject the request instead.');
  }
  db.transaction(() => {
    endTenancy(request.tenancy_id, request.requested_date);
    db.prepare(
      "UPDATE vacate_requests SET status = 'approved', owner_note = ?, decided_at = datetime('now') WHERE id = ?",
    ).run(owner_note, request.id);
  })();
  res.json({ request: ownedRequest(req.user.id, request.id) });
});

router.post('/vacate-requests/:id/reject', (req, res) => {
  const request = ownedRequest(req.user.id, idParam(req.params.id));
  const { owner_note } = validate(req.body, { owner_note: str({ max: 500, optional: true }) });
  if (request.status !== 'pending') throw conflict(`This request was already ${request.status}`);
  db.prepare(
    "UPDATE vacate_requests SET status = 'rejected', owner_note = ?, decided_at = datetime('now') WHERE id = ?",
  ).run(owner_note, request.id);
  res.json({ request: ownedRequest(req.user.id, request.id) });
});

export default router;
