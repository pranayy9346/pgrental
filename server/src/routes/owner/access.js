// Every owner lookup goes through these helpers. Each one checks that the record belongs to the
// logged-in owner, and responds 404 otherwise — so owners can never see or change each other's data.
// The optional last argument `q` lets a helper run inside a transaction (pass the `tx` object).
import db from '../../db.js';
import { notFound } from '../../lib/http.js';

export async function ownedProperty(ownerId, propertyId, q = db) {
  const row = await q.get('SELECT * FROM properties WHERE id = ? AND owner_id = ?', [propertyId, ownerId]);
  if (!row) throw notFound('Property');
  return row;
}

export async function ownedRoom(ownerId, roomId, q = db) {
  const row = await q.get(
    `SELECT r.*, p.name AS property_name,
            (SELECT COUNT(*) FROM tenancies t WHERE t.room_id = r.id AND t.status = 'active') AS occupied
     FROM rooms r JOIN properties p ON p.id = r.property_id
     WHERE r.id = ? AND p.owner_id = ?`,
    [roomId, ownerId],
  );
  if (!row) throw notFound('Room');
  return row;
}

export async function ownedTenant(ownerId, tenantId, q = db) {
  const row = await q.get("SELECT * FROM users WHERE id = ? AND role = 'tenant' AND owner_id = ?", [tenantId, ownerId]);
  if (!row) throw notFound('Tenant');
  return row;
}

export async function activeTenancy(tenantId, q = db) {
  return (await q.get("SELECT * FROM tenancies WHERE tenant_id = ? AND status = 'active'", [tenantId])) || null;
}
