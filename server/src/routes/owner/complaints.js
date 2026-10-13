import { Router } from 'express';
import db from '../../db.js';
import { idParam, notFound } from '../../lib/http.js';
import { int, oneOf, str, validate } from '../../lib/validate.js';
import { ownedProperty } from './access.js';

const router = Router();

// ---- Complaints / maintenance requests ----

const complaintSelect = `
  SELECT c.*, u.id AS tenant_id, u.name AS tenant_name, u.phone AS tenant_phone,
         r.room_number, p.id AS property_id, p.name AS property_name
  FROM complaints c
  JOIN tenancies t ON t.id = c.tenancy_id
  JOIN users u ON u.id = t.tenant_id
  JOIN rooms r ON r.id = t.room_id
  JOIN properties p ON p.id = r.property_id
  WHERE p.owner_id = @owner_id
`;

router.get('/complaints', (req, res) => {
  const q = validate(req.query, { status: oneOf(['open', 'in_progress', 'resolved'], { optional: true }) });
  let sql = complaintSelect;
  if (q.status) sql += ' AND c.status = @status';
  sql += " ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, c.created_at DESC";
  res.json({ complaints: db.prepare(sql).all({ owner_id: req.user.id, ...q }) });
});

router.patch('/complaints/:id', (req, res) => {
  const id = idParam(req.params.id);
  const existing = db.prepare(`${complaintSelect} AND c.id = @id`).get({ owner_id: req.user.id, id });
  if (!existing) throw notFound('Complaint');
  const data = validate(
    req.body,
    { status: oneOf(['open', 'in_progress', 'resolved']), owner_reply: str({ max: 2000, optional: true }) },
    { partial: true },
  );
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE complaints SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({
    ...data,
    id,
  });
  res.json({ complaint: db.prepare(`${complaintSelect} AND c.id = @id`).get({ owner_id: req.user.id, id }) });
});

// ---- Notices (announcements shown to tenants of a property) ----

router.get('/notices', (req, res) => {
  const notices = db
    .prepare(
      `SELECT n.*, p.name AS property_name FROM notices n JOIN properties p ON p.id = n.property_id
       WHERE p.owner_id = ? ORDER BY n.created_at DESC, n.id DESC`,
    )
    .all(req.user.id);
  res.json({ notices });
});

router.post('/notices', (req, res) => {
  const data = validate(req.body, {
    property_id: int({ min: 1 }),
    title: str({ min: 2, max: 150 }),
    body: str({ max: 5000 }),
  });
  ownedProperty(req.user.id, data.property_id);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO notices (property_id, title, body) VALUES (@property_id, @title, @body)')
    .run(data);
  res.status(201).json({ notice: db.prepare('SELECT * FROM notices WHERE id = ?').get(lastInsertRowid) });
});

router.delete('/notices/:id', (req, res) => {
  const id = idParam(req.params.id);
  const notice = db
    .prepare('SELECT n.id FROM notices n JOIN properties p ON p.id = n.property_id WHERE n.id = ? AND p.owner_id = ?')
    .get(id, req.user.id);
  if (!notice) throw notFound('Notice');
  db.prepare('DELETE FROM notices WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
