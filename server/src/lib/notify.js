// In-app notifications (unread badges). The routes call these helpers INSIDE the same database transaction as the
// change they describe, so a notification can never exist without its event, nor the other way round.
//
// Rules (also documented in DEPLOYMENT.md):
//  * One row per recipient per event. Read state lives on the row, so every user's read/unread state is independent.
//  * (recipient_id, dedupe_key) is unique and inserts use ON CONFLICT DO NOTHING: processing the same event twice
//    notifies once. Events that can legitimately happen several times for one record (a complaint updated again, a
//    charge changed again) carry a `version` in the key.
//  * Existing data is never turned into notifications. Only events that happen after this feature exists notify.
//  * Deleting a record deletes the notifications about it (removeForEntity), so nothing links to a missing page.
import { nowStamp } from './http.js';

// type -> [category (which sidebar item gets the badge), entity_type (what the notification is about)]
const TYPES = {
  'notice.published': ['notices', 'notice'],
  'complaint.new': ['complaints', 'complaint'],
  'complaint.updated': ['complaints', 'complaint'],
  'payment.charged': ['payments', 'payment'],
  'payment.received': ['payments', 'payment'],
  'payment.adjusted': ['payments', 'payment'],
  'vacate.requested': ['moveout', 'vacate_request'],
  'vacate.withdrawn': ['moveout', 'vacate_request'],
  'vacate.approved': ['moveout', 'vacate_request'],
  'vacate.rejected': ['moveout', 'vacate_request'],
  'vacate.cancelled': ['moveout', 'vacate_request'],
};

export const CATEGORIES = ['notices', 'complaints', 'payments', 'moveout'];
export const ENTITY_TYPES = ['notice', 'complaint', 'payment', 'vacate_request'];

// Where a notification leads, by who receives it. Fixed paths only: no user input ever ends up in a link.
const LINKS = {
  tenant: { notice: '/tenant/notices', complaint: '/tenant/complaints', payment: '/tenant/payments', vacate_request: '/tenant/vacate' },
  owner: { complaint: '/owner/complaints', vacate_request: '/owner/vacate-requests' },
};
export const linkFor = (role, entityType) => LINKS[role]?.[entityType] ?? `/${role}`;

const cut = (text, max) => {
  const s = String(text ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const rupeeFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const rupees = (n) => rupeeFormat.format(n || 0);

export function periodLabel(period) {
  const [y, m] = String(period).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// '2026-10-14' -> '14 Oct 2026' (a plain calendar date, so no time-zone shift)
export const dateLabel = (isoDate) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const statusLabels = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

// Identifies one specific occurrence of an event that can repeat for the same record (millisecond precision).
export const eventStamp = () => new Date().toISOString();

// Creates one notification. `q` is the database or the surrounding transaction. Returns true if a row was created,
// false if the same event had already notified this recipient.
export async function notify(q, { to, type, entityId, title, body = null, version = '' }) {
  const spec = TYPES[type];
  if (!spec) throw new Error(`Unknown notification type "${type}"`);
  if (!Number.isInteger(to) || !Number.isInteger(entityId)) throw new Error('A notification needs a recipient and a record id');
  const key = version === '' ? `${type}:${entityId}` : `${type}:${entityId}:${version}`;
  const result = await q.run(
    `INSERT INTO notifications (recipient_id, category, type, entity_type, entity_id, title, body, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (recipient_id, dedupe_key) DO NOTHING`,
    [to, spec[0], type, spec[1], entityId, cut(title, 150), body ? cut(body, 300) : null, key],
  );
  return result.changes === 1;
}

// Deletes every notification about a record that is being deleted (all recipients).
export async function removeForEntity(q, entityType, entityId) {
  const result = await q.run('DELETE FROM notifications WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  return result.changes;
}

// Marks one user's unread notifications about a record as read. Used when the person acts on the record
// (the owner updating a complaint or deciding a move-out request), which is an explicit acknowledgement.
export async function markEntityRead(q, recipientId, entityType, entityId) {
  const result = await q.run(
    'UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND entity_type = ? AND entity_id = ? AND read_at IS NULL',
    [nowStamp(), recipientId, entityType, entityId],
  );
  return result.changes;
}
