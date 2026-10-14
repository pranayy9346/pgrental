import { Router } from 'express';
import db from '../../db.js';
import { conflict, idParam, notFound, nowStamp } from '../../lib/http.js';
import { eventStamp, markEntityRead, notify, removeForEntity, statusLabels } from '../../lib/notify.js';
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

router.get('/complaints', async (req, res) => {
  const q = validate(req.query, { status: oneOf(['open', 'in_progress', 'resolved'], { optional: true }) });
  let sql = complaintSelect;
  if (q.status) sql += ' AND c.status = @status';
  sql += " ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, c.created_at DESC";
  res.json({ complaints: await db.all(sql, { owner_id: req.user.id, ...q }) });
});

router.patch('/complaints/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const existing = await db.get(`${complaintSelect} AND c.id = @id`, { owner_id: req.user.id, id });
  if (!existing) throw notFound('Complaint');
  const data = validate(
    req.body,
    { status: oneOf(['open', 'in_progress', 'resolved']), owner_reply: str({ max: 2000, optional: true }) },
    { partial: true },
  );
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  const nextStatus = data.status ?? existing.status;
  const statusChanged = nextStatus !== existing.status;
  const replyChanged = 'owner_reply' in data && (data.owner_reply ?? null) !== (existing.owner_reply ?? null);

  await db.transaction(async (tx) => {
    if (statusChanged || replyChanged) {
      // Compare-and-set: apply the change only if the complaint is still as we read it. Two identical updates sent at
      // the same moment then change the row once and notify once; the loser finds the work already done.
      const applied = await tx.run(
        `UPDATE complaints SET ${sets.join(', ')}, updated_at = @updated_at
         WHERE id = @id AND status = @old_status AND COALESCE(owner_reply, '') = @old_reply`,
        { ...data, updated_at: nowStamp(), id, old_status: existing.status, old_reply: existing.owner_reply ?? '' },
      );
      if (applied.changes === 0) {
        const now = await tx.get('SELECT status, owner_reply FROM complaints WHERE id = ?', [id]);
        const alreadyDone =
          now && now.status === nextStatus && (!('owner_reply' in data) || (now.owner_reply ?? null) === (data.owner_reply ?? null));
        if (!alreadyDone) throw conflict('This complaint was just updated. Please reload and try again.');
      } else {
        const parts = [];
        if (statusChanged) parts.push(`Status: ${statusLabels[nextStatus]}`);
        if (replyChanged && data.owner_reply) parts.push(`Reply: ${data.owner_reply}`);
        if (parts.length) {
          await notify(tx, {
            to: existing.tenant_id,
            type: 'complaint.updated',
            entityId: id,
            version: eventStamp(),
            title: `Update on your complaint "${existing.title}"`,
            body: parts.join(' · '),
          });
        }
      }
    } else {
      // Nothing the tenant would care about changed: keep the existing behaviour (only touch updated_at).
      await tx.run(`UPDATE complaints SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id`, {
        ...data,
        updated_at: nowStamp(),
        id,
      });
    }
    // Acting on a complaint counts as acknowledging it: the owner's "new complaint" notification is done.
    await markEntityRead(tx, req.user.id, 'complaint', id);
  });
  res.json({ complaint: await db.get(`${complaintSelect} AND c.id = @id`, { owner_id: req.user.id, id }) });
});

// ---- Notices (announcements shown to tenants of a property) ----

router.get('/notices', async (req, res) => {
  const notices = await db.all(
    `SELECT n.*, p.name AS property_name FROM notices n JOIN properties p ON p.id = n.property_id
     WHERE p.owner_id = ? ORDER BY n.created_at DESC, n.id DESC`,
    [req.user.id],
  );
  res.json({ notices });
});

router.post('/notices', async (req, res) => {
  const data = validate(req.body, {
    property_id: int({ min: 1 }),
    title: str({ min: 2, max: 150 }),
    body: str({ max: 5000 }),
  });
  await ownedProperty(req.user.id, data.property_id);
  // The notice and one notification per current tenant of this PG are created together or not at all.
  const id = await db.transaction(async (tx) => {
    const noticeId = await tx.insert('INSERT INTO notices (property_id, title, body) VALUES (@property_id, @title, @body)', data);
    const tenants = await tx.all(
      `SELECT DISTINCT t.tenant_id FROM tenancies t JOIN rooms r ON r.id = t.room_id
       WHERE r.property_id = ? AND t.status = 'active'`,
      [data.property_id],
    );
    for (const t of tenants) {
      await notify(tx, { to: t.tenant_id, type: 'notice.published', entityId: noticeId, title: `New notice: ${data.title}`, body: data.body });
    }
    return noticeId;
  });
  res.status(201).json({ notice: await db.get('SELECT * FROM notices WHERE id = ?', [id]) });
});

router.delete('/notices/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const notice = await db.get(
    'SELECT n.id FROM notices n JOIN properties p ON p.id = n.property_id WHERE n.id = ? AND p.owner_id = ?',
    [id, req.user.id],
  );
  if (!notice) throw notFound('Notice');
  // Rule for deleted records: the notifications about a deleted notice are deleted with it, so no badge or link
  // is left pointing at something that no longer exists.
  await db.transaction(async (tx) => {
    await removeForEntity(tx, 'notice', id);
    await tx.run('DELETE FROM notices WHERE id = ?', [id]);
  });
  res.json({ ok: true });
});

export default router;
