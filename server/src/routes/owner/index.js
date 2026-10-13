import { Router } from 'express';
import db from '../../db.js';
import { requireRole } from '../../lib/auth.js';
import { currentPeriod, today } from '../../lib/http.js';
import complaints from './complaints.js';
import payments from './payments.js';
import properties from './properties.js';
import tenants from './tenants.js';
import vacate from './vacate.js';

const router = Router();
router.use(requireRole('owner'));

router.get('/dashboard', async (req, res) => {
  const owner = req.user.id;
  const period = currentPeriod();

  const occupancy = await db.get(
      `SELECT (SELECT COUNT(*) FROM properties WHERE owner_id = @owner) AS properties,
              COUNT(r.id) AS rooms,
              COALESCE(SUM(r.capacity), 0) AS total_beds,
              (SELECT COUNT(*) FROM tenancies t JOIN rooms r2 ON r2.id = t.room_id
               JOIN properties p2 ON p2.id = r2.property_id
               WHERE p2.owner_id = @owner AND t.status = 'active') AS occupied_beds
       FROM rooms r JOIN properties p ON p.id = r.property_id WHERE p.owner_id = @owner`,
      { owner },
    );

  const money = await db.get(
      `SELECT COALESCE(SUM(CASE WHEN pay.period = @period THEN pay.amount_due END), 0) AS month_due,
              COALESCE(SUM(CASE WHEN pay.period = @period THEN pay.amount_paid END), 0) AS month_collected,
              COALESCE(SUM(pay.amount_due - pay.amount_paid), 0) AS total_outstanding
       FROM payments pay JOIN tenancies t ON t.id = pay.tenancy_id JOIN rooms r ON r.id = t.room_id
       JOIN properties p ON p.id = r.property_id WHERE p.owner_id = @owner`,
      { owner, period },
    );

  const { missing_charges } = await db.get(
      `SELECT COUNT(*) AS missing_charges FROM tenancies t JOIN rooms r ON r.id = t.room_id
       JOIN properties p ON p.id = r.property_id
       WHERE p.owner_id = @owner AND t.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.tenancy_id = t.id AND x.period = @period)`,
      { owner, period },
    );

  const { open_complaints } = await db.get(
      `SELECT COUNT(*) AS open_complaints FROM complaints c JOIN tenancies t ON t.id = c.tenancy_id
       JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
       WHERE p.owner_id = ? AND c.status != 'resolved'`,
      [owner],
    );

  const { pending_vacates } = await db.get(
      `SELECT COUNT(*) AS pending_vacates FROM vacate_requests v JOIN tenancies t ON t.id = v.tenancy_id
       JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
       WHERE p.owner_id = ? AND v.status = 'pending'`,
      [owner],
    );

  const overdue = await db.all(
      `SELECT pay.id, pay.period, pay.amount_due, pay.amount_paid, pay.due_date, u.id AS tenant_id,
              u.name AS tenant_name, r.room_number, p.name AS property_name
       FROM payments pay JOIN tenancies t ON t.id = pay.tenancy_id JOIN users u ON u.id = t.tenant_id
       JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
       WHERE p.owner_id = ? AND pay.status != 'paid' AND pay.due_date < ?
       ORDER BY pay.due_date LIMIT 8`,
      [owner, today()],
    );

  const recentComplaints = await db.all(
      `SELECT c.id, c.title, c.status, c.created_at, u.name AS tenant_name, r.room_number, p.name AS property_name
       FROM complaints c JOIN tenancies t ON t.id = c.tenancy_id JOIN users u ON u.id = t.tenant_id
       JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id
       WHERE p.owner_id = ? AND c.status != 'resolved' ORDER BY c.created_at DESC LIMIT 5`,
      [owner],
    );

  res.json({
    period,
    stats: { ...occupancy, ...money, missing_charges, open_complaints, pending_vacates },
    overdue,
    recentComplaints,
  });
});

router.use(properties);
router.use(tenants);
router.use(payments);
router.use(complaints);
router.use(vacate);

export default router;
