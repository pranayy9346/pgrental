// Every owner lookup goes through these helpers. Each one checks that the record belongs to the
// logged-in owner, and responds 404 otherwise — so owners can never see or change each other's data.
import db from '../../db.js';
import { notFound } from '../../lib/http.js';

export function ownedProperty(ownerId, propertyId) {
  const row = db.prepare('SELECT * FROM properties WHERE id = ? AND owner_id = ?').get(propertyId, ownerId);
  if (!row) throw notFound('Property');
  return row;
}

export function ownedRoom(ownerId, roomId) {
  const row = db
    .prepare(
      `SELECT r.*, p.name AS property_name,
              (SELECT COUNT(*) FROM tenancies t WHERE t.room_id = r.id AND t.status = 'active') AS occupied
       FROM rooms r JOIN properties p ON p.id = r.property_id
       WHERE r.id = ? AND p.owner_id = ?`,
    )
    .get(roomId, ownerId);
  if (!row) throw notFound('Room');
  return row;
}

export function ownedTenant(ownerId, tenantId) {
  const row = db
    .prepare("SELECT * FROM users WHERE id = ? AND role = 'tenant' AND owner_id = ?")
    .get(tenantId, ownerId);
  if (!row) throw notFound('Tenant');
  return row;
}

export function activeTenancy(tenantId) {
  return db.prepare("SELECT * FROM tenancies WHERE tenant_id = ? AND status = 'active'").get(tenantId) || null;
}
