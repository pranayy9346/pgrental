// Notification API, shared by owners and tenants. Every query is filtered by the logged-in user's id (the recipient),
// so nobody can see, count or mark another user's notifications. A foreign id answers 404, the same as a missing one.
// Nothing here marks anything as read unless the caller explicitly asks (POST ... /read).
import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { idParam, notFound, nowStamp } from '../lib/http.js';
import { CATEGORIES, ENTITY_TYPES, linkFor } from '../lib/notify.js';
import { int, oneOf, validate } from '../lib/validate.js';

const router = Router();
router.use(requireAuth);
// Counts change all the time and differ per user: never let a browser or proxy reuse an answer.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Unread counts per category. One indexed query (the partial index only contains unread rows).
async function summaryFor(userId) {
  const rows = await db.all(
    'SELECT category, COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND read_at IS NULL GROUP BY category',
    [userId],
  );
  const summary = { total: 0, notices: 0, complaints: 0, payments: 0, moveout: 0 };
  for (const r of rows) {
    summary[r.category] = Number(r.n);
    summary.total += Number(r.n);
  }
  return summary;
}

router.get('/summary', async (req, res) => {
  res.json({ summary: await summaryFor(req.user.id) });
});

// The notification center. Newest first, paged by id: pass `before` = the `nextBefore` of the previous page.
router.get('/', async (req, res) => {
  const q = validate(req.query, {
    status: oneOf(['unread', 'all'], { optional: true }),
    category: oneOf(CATEGORIES, { optional: true }),
    before: int({ min: 1, optional: true }),
    limit: int({ min: 1, max: 50, optional: true }),
  });
  const limit = q.limit ?? 20;
  let sql = `SELECT id, category, type, entity_type, entity_id, title, body, created_at, read_at
             FROM notifications WHERE recipient_id = @me`;
  if (q.status === 'unread') sql += ' AND read_at IS NULL';
  if (q.category) sql += ' AND category = @category';
  if (q.before) sql += ' AND id < @before';
  sql += ' ORDER BY id DESC LIMIT @fetch';
  const rows = await db.all(sql, { me: req.user.id, category: q.category, before: q.before, fetch: limit + 1 });
  const page = rows.slice(0, limit);
  res.json({
    notifications: page.map((r) => ({ ...r, link: linkFor(req.user.role, r.entity_type) })),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
    summary: await summaryFor(req.user.id),
  });
});

// Which records have unread notifications, so a list page can tag them "New". Reading this changes nothing.
router.get('/unread-entities', async (req, res) => {
  const q = validate(req.query, { category: oneOf(CATEGORIES, { optional: true }) });
  let sql = `SELECT entity_type, entity_id, COUNT(*) AS n FROM notifications WHERE recipient_id = @me AND read_at IS NULL`;
  if (q.category) sql += ' AND category = @category';
  sql += ' GROUP BY entity_type, entity_id';
  const rows = await db.all(sql, { me: req.user.id, category: q.category });
  res.json({ items: rows.map((r) => ({ entity_type: r.entity_type, entity_id: r.entity_id, count: Number(r.n) })) });
});

// Explicit "Mark all as read" ({ all: true }) or "Mark as read" for one record's notifications
// ({ entity_type, entity_id }, used by the "Mark as read" button on list pages).
router.post('/read', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let result;
  if (body.all === true) {
    result = await db.run('UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL', [nowStamp(), req.user.id]);
  } else {
    const d = validate(body, { entity_type: oneOf(ENTITY_TYPES), entity_id: int({ min: 1 }) });
    result = await db.run(
      'UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND entity_type = ? AND entity_id = ? AND read_at IS NULL',
      [nowStamp(), req.user.id, d.entity_type, d.entity_id],
    );
  }
  res.json({ updated: result.changes, summary: await summaryFor(req.user.id) });
});

// Marks one notification as read (opening it in the notification center). Safe to repeat.
router.post('/:id/read', async (req, res) => {
  const id = idParam(req.params.id);
  const mine = await db.get('SELECT id FROM notifications WHERE id = ? AND recipient_id = ?', [id, req.user.id]);
  if (!mine) throw notFound('Notification');
  const result = await db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_id = ? AND read_at IS NULL', [
    nowStamp(),
    id,
    req.user.id,
  ]);
  res.json({ updated: result.changes, summary: await summaryFor(req.user.id) });
});

export default router;
