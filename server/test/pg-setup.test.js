// One PG per owner, floors and rooms, room capacity limits, and owner isolation.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { asOwner, signInOwner } from './helpers.js';
import { migrate } from '../src/schema.js';

process.env.DB_PATH = ':memory:';
const { default: app } = await import('../src/app.js');
const { default: db } = await import('../src/db.js');

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

const anon = client();
const ownerA = asOwner(client(), 'a@x.com');
const ownerB = asOwner(client(), 'b@x.com');
const ownerC = asOwner(client(), 'c@x.com'); // never sets up a PG
const ids = {};
const room = (n, extra = {}) => ({ room_number: n, capacity: 2, monthly_rent: 6000, ...extra });
const addRoom = (c, body) => c('POST', '/api/owner/pg/rooms', body);
const addTenant = (c, n, roomId) =>
  c('POST', '/api/owner/tenants', { name: `Tenant ${n}`, email: `t${n}@x.com`, room_id: roomId, start_date: '2026-01-01' });

describe('PG details (one PG per owner)', () => {
  test('owners exist; before setup there is no PG', async () => {
    for (const [c, n] of [[ownerA, 'a'], [ownerB, 'b'], [ownerC, 'c']]) {
      await signInOwner(c, `${n}@x.com`, `Owner ${n}`);
    }
    const r = await ownerA('GET', '/api/owner/pg');
    assert.equal(r.status, 200);
    assert.equal(r.data.pg, null);
    assert.deepEqual(r.data.rooms, []);
  });

  test('rooms cannot be added before the PG exists', async () => {
    assert.equal((await addRoom(ownerC, room('1'))).status, 404);
  });

  test('PG details are validated', async () => {
    const empty = await ownerA('PUT', '/api/owner/pg', {});
    assert.equal(empty.status, 400);
    assert.ok(empty.data.details.name && empty.data.details.address && empty.data.details.city);
    for (const total_floors of [0, 51, 'many', 2.5]) {
      const r = await ownerA('PUT', '/api/owner/pg', { name: 'PG', address: '1 Road', city: 'Pune', total_floors });
      assert.equal(r.status, 400, `total_floors=${total_floors}`);
      assert.ok(r.data.details.total_floors);
    }
  });

  test('saving PG details creates the PG (3 floors) and returns it', async () => {
    const r = await ownerA('PUT', '/api/owner/pg', { name: 'Sunrise PG', address: '12 MG Road', city: 'Pune', total_floors: 3 });
    assert.equal(r.status, 201);
    assert.equal(r.data.pg.total_floors, 3);
    ids.pgA = r.data.pg.id;
  });

  test('saving again updates the same PG instead of creating another', async () => {
    const r = await ownerA('PUT', '/api/owner/pg', { name: 'Sunrise PG Deluxe', description: 'Meals included' });
    assert.equal(r.status, 200);
    assert.equal(r.data.pg.id, ids.pgA);
    assert.equal(r.data.pg.name, 'Sunrise PG Deluxe');
    assert.equal(r.data.pg.address, '12 MG Road', 'fields that were not sent are kept');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM properties WHERE owner_id = (SELECT id FROM users WHERE email = ?)', ['a@x.com'])).n, 1);
  });

  test('a second PG is refused by the API and by the database', async () => {
    const r = await ownerA('POST', '/api/owner/properties', { name: 'Second', address: '2 Road', city: 'Pune' });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /exactly one PG/);
    const ownerId = (await db.get("SELECT id FROM users WHERE email = 'a@x.com'")).id;
    await assert.rejects(
      db.run("INSERT INTO properties (owner_id, name, address, city) VALUES (?, 'Sneaky', 'x', 'y')", [ownerId]),
      /only one PG/,
    );
  });

  test('each owner has their own PG and cannot read another owner’s', async () => {
    const b = await ownerB('PUT', '/api/owner/pg', { name: 'B PG', address: '9 Road', city: 'Delhi' });
    assert.equal(b.status, 201);
    ids.pgB = b.data.pg.id;
    assert.equal((await ownerB('GET', '/api/owner/pg')).data.pg.name, 'B PG');
    assert.equal((await ownerA('GET', '/api/owner/pg')).data.pg.name, 'Sunrise PG Deluxe');
    assert.equal((await ownerB('GET', `/api/owner/properties/${ids.pgA}`)).status, 404);
    assert.equal((await ownerB('PATCH', `/api/owner/properties/${ids.pgA}`, { name: 'Hacked' })).status, 404);
  });

  test('only owners can use the PG endpoints', async () => {
    assert.equal((await anon('GET', '/api/owner/pg')).status, 401);
    assert.equal((await anon('PUT', '/api/owner/pg', { name: 'x' })).status, 401);
  });
});

describe('floors and rooms', () => {
  test('rooms are added on specific floors; room 1 defaults to the ground floor', async () => {
    const g = await addRoom(ownerA, room('G1'));
    assert.equal(g.status, 201, JSON.stringify(g.data));
    assert.equal(g.data.room.floor, 0);
    assert.equal(g.data.room.status, 'vacant');
    ids.g1 = g.data.room.id;
    for (const [n, floor] of [['101', 1], ['102', 1], ['103', 1], ['201', 2]]) {
      const r = await addRoom(ownerA, room(n, { floor, capacity: n === '103' ? 1 : 2 }));
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.room.floor, floor);
      ids[`r${n}`] = r.data.room.id;
    }
  });

  test('GET /pg lists rooms ordered by floor, with occupancy status', async () => {
    const { rooms } = (await ownerA('GET', '/api/owner/pg')).data;
    assert.deepEqual(rooms.map((r) => `${r.floor}:${r.room_number}`), ['0:G1', '1:101', '1:102', '1:103', '2:201']);
    assert.ok(rooms.every((r) => r.status === 'vacant' && r.occupied === 0));
  });

  test('a room on a floor the PG does not have is rejected', async () => {
    const r = await addRoom(ownerA, room('301', { floor: 3 }));
    assert.equal(r.status, 400);
    assert.match(r.data.details.floor, /3 floor/);
    assert.equal((await addRoom(ownerA, room('302', { floor: -1 }))).status, 400);
    assert.equal((await addRoom(ownerA, room('303', { floor: 'top' }))).status, 400);
  });

  test('room number, capacity and rent are validated', async () => {
    const r = await addRoom(ownerA, { capacity: 0, monthly_rent: -1 });
    assert.equal(r.status, 400);
    assert.ok(r.data.details.room_number && r.data.details.capacity && r.data.details.monthly_rent);
    assert.equal((await addRoom(ownerA, room('X', { capacity: 21 }))).status, 400);
  });

  test('duplicate room numbers are refused across all floors and regardless of case', async () => {
    assert.equal((await addRoom(ownerA, room('101', { floor: 2 }))).status, 409, 'same number on another floor');
    assert.equal((await addRoom(ownerA, room('g1', { floor: 1 }))).status, 409, 'different letter case');
    assert.equal((await addRoom(ownerA, room(' 101 ', { floor: 0 }))).status, 409, 'surrounding spaces');
  });

  test('another PG may reuse the same room numbers', async () => {
    assert.equal((await addRoom(ownerB, room('101'))).status, 201);
  });

  test('renaming or moving a room keeps the same rules', async () => {
    assert.equal((await ownerA('PATCH', `/api/owner/rooms/${ids.r102}`, { room_number: '101' })).status, 409);
    assert.equal((await ownerA('PATCH', `/api/owner/rooms/${ids.r102}`, { floor: 5 })).status, 400);
    const ok = await ownerA('PATCH', `/api/owner/rooms/${ids.r102}`, { floor: 2, monthly_rent: 6500 });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.room.floor, 2);
    assert.equal(ok.data.room.monthly_rent, 6500);
    assert.equal((await ownerA('PATCH', `/api/owner/rooms/${ids.r102}`, { floor: 1 })).status, 200);
    assert.equal((await ownerA('PATCH', `/api/owner/rooms/${ids.r102}`, { room_number: '102' })).status, 200, 'keeping its own number is fine');
  });

  test('the number of floors cannot drop below the highest floor that has rooms', async () => {
    const r = await ownerA('PUT', '/api/owner/pg', { total_floors: 2 });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /floor 2/);
    assert.equal((await ownerA('PUT', '/api/owner/pg', { total_floors: 4 })).status, 200);
    assert.equal((await addRoom(ownerA, room('301', { floor: 3 }))).status, 201, 'now floor 3 exists');
  });

  test('owners cannot change or delete each other’s rooms', async () => {
    assert.equal((await ownerB('PATCH', `/api/owner/rooms/${ids.g1}`, { monthly_rent: 1 })).status, 404);
    assert.equal((await ownerB('DELETE', `/api/owner/rooms/${ids.g1}`)).status, 404);
    assert.equal((await ownerB('GET', '/api/owner/rooms')).data.rooms.every((r) => r.property_name === 'B PG'), true);
  });
});

describe('capacity limits', () => {
  test('tenants fill a room one by one and the status follows', async () => {
    assert.equal((await addTenant(ownerA, 1, ids.r101)).status, 201);
    assert.equal((await ownerA('GET', '/api/owner/rooms')).data.rooms.find((r) => r.id === ids.r101).status, 'partial');
    assert.equal((await addTenant(ownerA, 2, ids.r101)).status, 201);
    const full = (await ownerA('GET', '/api/owner/rooms')).data.rooms.find((r) => r.id === ids.r101);
    assert.equal(full.status, 'full');
    assert.equal(full.occupied, 2);
  });

  test('a full room refuses another tenant, and nothing is created', async () => {
    const r = await addTenant(ownerA, 3, ids.r101);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /full/);
    assert.equal((await db.get("SELECT 1 FROM users WHERE email = 't3@x.com'")), undefined);
  });

  test('a single-bed room takes exactly one tenant', async () => {
    assert.equal((await addTenant(ownerA, 4, ids.r103)).status, 201);
    assert.equal((await addTenant(ownerA, 5, ids.r103)).status, 409);
  });

  test('moving an existing tenant into a full room is refused; into a free room it works', async () => {
    const t4 = (await db.get("SELECT id FROM users WHERE email = 't4@x.com'")).id;
    assert.equal((await ownerA('POST', `/api/owner/tenants/${t4}/assign`, { room_id: ids.r101, start_date: '2026-02-01' })).status, 409);
    assert.equal((await ownerA('GET', `/api/owner/tenants/${t4}`)).data.tenant.room_number, '103', 'still in the old room');
    assert.equal((await ownerA('POST', `/api/owner/tenants/${t4}/assign`, { room_id: ids.g1, start_date: '2026-02-01' })).status, 200);
  });

  test('capacity cannot be lowered below the number of tenants in the room', async () => {
    const r = await ownerA('PATCH', `/api/owner/rooms/${ids.r101}`, { capacity: 1 });
    assert.equal(r.status, 409);
    assert.equal((await ownerA('PATCH', `/api/owner/rooms/${ids.r101}`, { capacity: 3 })).status, 200);
    assert.equal((await addTenant(ownerA, 6, ids.r101)).status, 201, 'the extra bed can be used');
  });

  test('a room with tenants (or history) cannot be deleted; an empty one can', async () => {
    assert.equal((await ownerA('DELETE', `/api/owner/rooms/${ids.r101}`)).status, 409);
    assert.equal((await ownerA('DELETE', `/api/owner/rooms/${ids.r103}`)).status, 409, 'has tenant history');
    assert.equal((await ownerA('DELETE', `/api/owner/rooms/${ids.r201}`)).status, 200);
  });
});

describe('only owners manage the PG', () => {
  test('a tenant cannot read or change PG details or rooms', async () => {
    const tenant = client();
    const { registerTenant } = await import('./helpers.js');
    await registerTenant(tenant, 't1@x.com');
    assert.equal((await tenant('GET', '/api/owner/pg')).status, 403);
    assert.equal((await tenant('PUT', '/api/owner/pg', { name: 'Mine now' })).status, 403);
    assert.equal((await addRoom(tenant, room('Z9'))).status, 403);
    assert.equal((await tenant('PATCH', `/api/owner/rooms/${ids.g1}`, { monthly_rent: 1 })).status, 403);
  });
});

describe('upgrading an existing database', () => {
  // This builds an old SQLite database on its own, so it only makes sense when the SQLite driver is in use.
  // The PostgreSQL equivalent is in pg-migrations.test.js.
  test('data is kept; old rooms land on the ground floor; existing accounts count as registered', { skip: db.dialect !== 'sqlite' && 'SQLite only' }, async () => {
    const { default: Database } = await import('better-sqlite3');
    const old = new Database(':memory:');
    old.pragma('foreign_keys = ON');
    migrate(old, 2); // the schema as it was before floors and tenant registration
    old.prepare("INSERT INTO users (id, role, name, email, password_hash) VALUES (1, 'owner', 'O', 'o@x.com', 'scrypt$aa$bb')").run();
    old.prepare("INSERT INTO users (id, role, name, email, password_hash, owner_id) VALUES (2, 'tenant', 'T', 't@x.com', 'scrypt$aa$bb', 1)").run();
    old.prepare("INSERT INTO properties (id, owner_id, name, address, city) VALUES (1, 1, 'First', 'a', 'c')").run();
    old.prepare("INSERT INTO properties (id, owner_id, name, address, city) VALUES (2, 1, 'Second', 'a', 'c')").run();
    old.prepare("INSERT INTO rooms (id, property_id, room_number, capacity, monthly_rent) VALUES (1, 1, '101', 2, 5000)").run();
    old.prepare("INSERT INTO tenancies (tenant_id, room_id, start_date, monthly_rent) VALUES (2, 1, '2026-01-01', 5000)").run();

    migrate(old);

    assert.equal(old.pragma('user_version', { simple: true }) >= 3, true);
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM properties WHERE owner_id = 1').get().n, 2, 'existing properties are untouched');
    assert.deepEqual({ ...old.prepare('SELECT floor FROM rooms').get() }, { floor: 0 });
    assert.equal(old.prepare('SELECT total_floors FROM properties WHERE id = 1').get().total_floors, 1);
    assert.ok(old.prepare("SELECT registered_at FROM users WHERE email = 't@x.com'").get().registered_at, 'existing tenant stays registered');
    assert.equal(old.prepare("SELECT status FROM tenancies").get().status, 'active');
    assert.throws(
      () => old.prepare("INSERT INTO properties (owner_id, name, address, city) VALUES (1, 'Third', 'a', 'c')").run(),
      /only one PG/,
    );
    old.close();
  });

  test('an owner who already has several properties keeps working: the first one is their PG', async () => {
    await db.exec(db.dialect === 'sqlite' ? 'DROP TRIGGER one_pg_per_owner' : 'DROP TRIGGER one_pg_per_owner ON properties');
    const ownerId = (await db.get("SELECT id FROM users WHERE email = 'a@x.com'")).id;
    (await db.run("INSERT INTO properties (owner_id, name, address, city) VALUES (?, 'Legacy extra', 'x', 'y')", [ownerId]));
    const r = await ownerA('GET', '/api/owner/pg');
    assert.equal(r.data.pg.id, ids.pgA);
    assert.equal((await ownerA('PUT', '/api/owner/pg', { city: 'Mumbai' })).data.pg.id, ids.pgA);
  });
});
