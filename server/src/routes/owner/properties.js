import { Router } from 'express';
import db from '../../db.js';
import { conflict, idParam } from '../../lib/http.js';
import { int, str, validate } from '../../lib/validate.js';
import { ownedProperty, ownedRoom } from './access.js';

const router = Router();

const propertySchema = {
  name: str({ min: 2, max: 100 }),
  address: str({ min: 3, max: 300 }),
  city: str({ min: 2, max: 100 }),
  description: str({ max: 2000, optional: true }),
};

const roomSchema = {
  room_number: str({ max: 20 }),
  capacity: int({ min: 1, max: 20 }),
  monthly_rent: int({ min: 0, max: 10_000_000 }),
  notes: str({ max: 500, optional: true }),
};

const roomsWithOccupancy = `
  SELECT r.*,
         (SELECT COUNT(*) FROM tenancies t WHERE t.room_id = r.id AND t.status = 'active') AS occupied
  FROM rooms r
`;

// ---- Properties ----

router.get('/properties', (req, res) => {
  const properties = db
    .prepare(
      `SELECT p.*,
              COUNT(r.id) AS room_count,
              COALESCE(SUM(r.capacity), 0) AS total_beds,
              (SELECT COUNT(*) FROM tenancies t JOIN rooms r2 ON r2.id = t.room_id
               WHERE r2.property_id = p.id AND t.status = 'active') AS occupied_beds
       FROM properties p LEFT JOIN rooms r ON r.property_id = p.id
       WHERE p.owner_id = ?
       GROUP BY p.id
       ORDER BY p.name`,
    )
    .all(req.user.id);
  res.json({ properties });
});

router.post('/properties', (req, res) => {
  const data = validate(req.body, propertySchema);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO properties (owner_id, name, address, city, description)
       VALUES (@owner_id, @name, @address, @city, @description)`,
    )
    .run({ ...data, owner_id: req.user.id });
  res.status(201).json({ property: ownedProperty(req.user.id, lastInsertRowid) });
});

router.get('/properties/:id', (req, res) => {
  const property = ownedProperty(req.user.id, idParam(req.params.id));
  const rooms = db
    .prepare(`${roomsWithOccupancy} WHERE r.property_id = ? ORDER BY r.room_number COLLATE NOCASE`)
    .all(property.id);
  const residents = db
    .prepare(
      `SELECT t.room_id, u.id AS tenant_id, u.name
       FROM tenancies t JOIN users u ON u.id = t.tenant_id JOIN rooms r ON r.id = t.room_id
       WHERE r.property_id = ? AND t.status = 'active' ORDER BY u.name`,
    )
    .all(property.id);
  for (const room of rooms) room.tenants = residents.filter((x) => x.room_id === room.id);
  res.json({ property, rooms });
});

router.patch('/properties/:id', (req, res) => {
  const property = ownedProperty(req.user.id, idParam(req.params.id));
  const data = validate(req.body, propertySchema, { partial: true });
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE properties SET ${sets.join(', ')} WHERE id = @id`).run({ ...data, id: property.id });
  res.json({ property: ownedProperty(req.user.id, property.id) });
});

router.delete('/properties/:id', (req, res) => {
  const property = ownedProperty(req.user.id, idParam(req.params.id));
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE property_id = ?').get(property.id);
  if (n > 0) throw conflict('Delete all rooms in this property first');
  db.prepare('DELETE FROM properties WHERE id = ?').run(property.id);
  res.json({ ok: true });
});

// ---- Rooms ----

// All rooms across the owner's properties (used by the "assign tenant" form).
router.get('/rooms', (req, res) => {
  const rooms = db
    .prepare(
      `SELECT r.*, p.name AS property_name,
              (SELECT COUNT(*) FROM tenancies t WHERE t.room_id = r.id AND t.status = 'active') AS occupied
       FROM rooms r JOIN properties p ON p.id = r.property_id
       WHERE p.owner_id = ? ORDER BY p.name, r.room_number COLLATE NOCASE`,
    )
    .all(req.user.id);
  res.json({ rooms });
});

router.post('/properties/:id/rooms', (req, res) => {
  const property = ownedProperty(req.user.id, idParam(req.params.id));
  const data = validate(req.body, roomSchema);
  if (db.prepare('SELECT 1 FROM rooms WHERE property_id = ? AND room_number = ?').get(property.id, data.room_number)) {
    throw conflict(`Room ${data.room_number} already exists in this property`);
  }
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO rooms (property_id, room_number, capacity, monthly_rent, notes)
       VALUES (@property_id, @room_number, @capacity, @monthly_rent, @notes)`,
    )
    .run({ ...data, property_id: property.id });
  res.status(201).json({ room: ownedRoom(req.user.id, lastInsertRowid) });
});

router.patch('/rooms/:id', (req, res) => {
  const room = ownedRoom(req.user.id, idParam(req.params.id));
  const data = validate(req.body, roomSchema, { partial: true });
  if (data.capacity !== undefined && data.capacity < room.occupied) {
    throw conflict(`Capacity cannot be lower than the ${room.occupied} tenant(s) currently in this room`);
  }
  if (
    data.room_number &&
    db
      .prepare('SELECT 1 FROM rooms WHERE property_id = ? AND room_number = ? AND id != ?')
      .get(room.property_id, data.room_number, room.id)
  ) {
    throw conflict(`Room ${data.room_number} already exists in this property`);
  }
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = @id`).run({ ...data, id: room.id });
  res.json({ room: ownedRoom(req.user.id, room.id) });
});

router.delete('/rooms/:id', (req, res) => {
  const room = ownedRoom(req.user.id, idParam(req.params.id));
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM tenancies WHERE room_id = ?').get(room.id);
  if (n > 0) throw conflict('This room has tenant history and cannot be deleted');
  db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
  res.json({ ok: true });
});

export default router;
