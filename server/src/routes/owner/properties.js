import { Router } from 'express';
import db from '../../db.js';
import { badRequest, conflict, idParam, notFound } from '../../lib/http.js';
import { int, str, validate } from '../../lib/validate.js';
import { ownedProperty, ownedRoom } from './access.js';

const router = Router();

const propertySchema = {
  name: str({ min: 2, max: 100 }),
  address: str({ min: 3, max: 300 }),
  city: str({ min: 2, max: 100 }),
  description: str({ max: 2000, optional: true }),
  total_floors: int({ min: 1, max: 50, optional: true }),
};

const roomSchema = {
  room_number: str({ max: 20 }),
  capacity: int({ min: 1, max: 20 }),
  monthly_rent: int({ min: 0, max: 10_000_000 }),
  floor: int({ min: 0, max: 49, optional: true }), // 0 = ground floor
  notes: str({ max: 500, optional: true }),
};

// Vacant / partly filled / full, worked out from the number of tenants currently in the room.
export const roomStatus = (r) => (r.occupied === 0 ? 'vacant' : r.occupied >= r.capacity ? 'full' : 'partial');

export const withStatus = (room) => ({ ...room, status: roomStatus(room) });

function checkFloor(property, floor) {
  if (floor >= property.total_floors) {
    throw badRequest('Please correct the highlighted fields', {
      floor: `This PG has ${property.total_floors} floor(s). Increase the number of floors in PG Details first.`,
    });
  }
}

// Case-insensitive, so "g1" and "G1" count as the same room number.
function roomNumberTaken(propertyId, roomNumber, exceptRoomId = 0) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM rooms WHERE property_id = ? AND room_number = ? COLLATE NOCASE AND id != ?')
      .get(propertyId, roomNumber, exceptRoomId),
  );
}

const roomsWithOccupancy = `
  SELECT r.*,
         (SELECT COUNT(*) FROM tenancies t WHERE t.room_id = r.id AND t.status = 'active') AS occupied
  FROM rooms r
`;

// ---- Properties ----

// The number of floors can't be lowered below the highest floor that already has rooms.
function checkFloorCount(property, data) {
  if ('total_floors' in data && data.total_floors === null) delete data.total_floors;
  if (data.total_floors === undefined) return;
  const { top } = db.prepare('SELECT COALESCE(MAX(floor), -1) AS top FROM rooms WHERE property_id = ?').get(property.id);
  if (data.total_floors <= top) {
    throw conflict(`Rooms already exist on floor ${top}. Move or delete them before reducing the number of floors.`);
  }
}

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
  if (db.prepare('SELECT 1 FROM properties WHERE owner_id = ?').get(req.user.id)) {
    throw conflict('You already have a PG. Each owner manages exactly one PG; edit its details instead.');
  }
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO properties (owner_id, name, address, city, description, total_floors)
       VALUES (@owner_id, @name, @address, @city, @description, @total_floors)`,
    )
    .run({ ...data, total_floors: data.total_floors ?? 1, owner_id: req.user.id });
  res.status(201).json({ property: ownedProperty(req.user.id, lastInsertRowid) });
});

router.get('/properties/:id', (req, res) => {
  const property = ownedProperty(req.user.id, idParam(req.params.id));
  const rooms = db
    .prepare(`${roomsWithOccupancy} WHERE r.property_id = ? ORDER BY r.floor, r.room_number COLLATE NOCASE`)
    .all(property.id);
  const residents = db
    .prepare(
      `SELECT t.room_id, u.id AS tenant_id, u.name
       FROM tenancies t JOIN users u ON u.id = t.tenant_id JOIN rooms r ON r.id = t.room_id
       WHERE r.property_id = ? AND t.status = 'active' ORDER BY u.name`,
    )
    .all(property.id);
  for (const room of rooms) room.tenants = residents.filter((x) => x.room_id === room.id);
  res.json({ property, rooms: rooms.map(withStatus) });
});

router.patch('/properties/:id', (req, res) => {
  const property = ownedProperty(req.user.id, idParam(req.params.id));
  const data = validate(req.body, propertySchema, { partial: true });
  checkFloorCount(property, data);
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
       WHERE p.owner_id = ? ORDER BY p.name, r.floor, r.room_number COLLATE NOCASE`,
    )
    .all(req.user.id);
  res.json({ rooms: rooms.map(withStatus) });
});

function createRoom(ownerId, property, body) {
  const data = validate(body, roomSchema);
  const floor = data.floor ?? 0;
  checkFloor(property, floor);
  if (roomNumberTaken(property.id, data.room_number)) {
    throw conflict(`Room ${data.room_number} already exists in this PG`);
  }
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO rooms (property_id, room_number, floor, capacity, monthly_rent, notes)
       VALUES (@property_id, @room_number, @floor, @capacity, @monthly_rent, @notes)`,
    )
    .run({ ...data, floor, property_id: property.id });
  return withStatus(ownedRoom(ownerId, lastInsertRowid));
}

router.post('/properties/:id/rooms', (req, res) => {
  const property = ownedProperty(req.user.id, idParam(req.params.id));
  res.status(201).json({ room: createRoom(req.user.id, property, req.body) });
});

router.patch('/rooms/:id', (req, res) => {
  const room = ownedRoom(req.user.id, idParam(req.params.id));
  const data = validate(req.body, roomSchema, { partial: true });
  if (data.floor === null) delete data.floor; // floor can't be blank
  if (data.floor !== undefined) checkFloor(ownedProperty(req.user.id, room.property_id), data.floor);
  if (data.capacity !== undefined && data.capacity < room.occupied) {
    throw conflict(`Capacity cannot be lower than the ${room.occupied} tenant(s) currently in this room`);
  }
  if (data.room_number && roomNumberTaken(room.property_id, data.room_number, room.id)) {
    throw conflict(`Room ${data.room_number} already exists in this PG`);
  }
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = @id`).run({ ...data, id: room.id });
  res.json({ room: withStatus(ownedRoom(req.user.id, room.id)) });
});

router.delete('/rooms/:id', (req, res) => {
  const room = ownedRoom(req.user.id, idParam(req.params.id));
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM tenancies WHERE room_id = ?').get(room.id);
  if (n > 0) throw conflict('This room has tenant history and cannot be deleted');
  db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
  res.json({ ok: true });
});

// ---- "My PG": the single PG an owner manages (this is what the app's screens use) ----

const ownerPg = (ownerId) => db.prepare('SELECT * FROM properties WHERE owner_id = ? ORDER BY id LIMIT 1').get(ownerId);
const requirePg = (ownerId) => {
  const pg = ownerPg(ownerId);
  if (!pg) throw notFound('PG. Set up your PG details first');
  return pg;
};

router.get('/pg', (req, res) => {
  const pg = ownerPg(req.user.id);
  if (!pg) return res.json({ pg: null, rooms: [] });
  const rooms = db
    .prepare(`${roomsWithOccupancy} WHERE r.property_id = ? ORDER BY r.floor, r.room_number COLLATE NOCASE`)
    .all(pg.id);
  const residents = db
    .prepare(
      `SELECT t.room_id, u.id AS tenant_id, u.name
       FROM tenancies t JOIN users u ON u.id = t.tenant_id JOIN rooms r ON r.id = t.room_id
       WHERE r.property_id = ? AND t.status = 'active' ORDER BY u.name`,
    )
    .all(pg.id);
  for (const room of rooms) room.tenants = residents.filter((x) => x.room_id === room.id);
  res.json({ pg, rooms: rooms.map(withStatus) });
});

// Create the PG on first save, update it afterwards.
router.put('/pg', (req, res) => {
  const existing = ownerPg(req.user.id);
  const data = validate(req.body, propertySchema, existing ? { partial: true } : {});
  if (!existing) {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO properties (owner_id, name, address, city, description, total_floors)
         VALUES (@owner_id, @name, @address, @city, @description, @total_floors)`,
      )
      .run({ ...data, total_floors: data.total_floors ?? 1, owner_id: req.user.id });
    return res.status(201).json({ pg: ownedProperty(req.user.id, lastInsertRowid) });
  }
  checkFloorCount(existing, data);
  const sets = Object.keys(data).map((k) => `${k} = @${k}`);
  if (sets.length) db.prepare(`UPDATE properties SET ${sets.join(', ')} WHERE id = @id`).run({ ...data, id: existing.id });
  res.json({ pg: ownedProperty(req.user.id, existing.id) });
});

router.post('/pg/rooms', (req, res) => {
  res.status(201).json({ room: createRoom(req.user.id, requirePg(req.user.id), req.body) });
});

export default router;
