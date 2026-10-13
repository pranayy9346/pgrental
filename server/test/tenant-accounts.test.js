// Owner adds tenants: validation, duplicates, authorization, and that no login exists until the tenant registers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { asOwner, registerTenant, signInOwner } from './helpers.js';

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
const tenantA = client();
const tenantNoRoom = client();
const ids = {};
const pw = {};
const create = (c, body) => c('POST', '/api/owner/tenants', body);
const roomBody = (extra = {}) => ({ start_date: '2026-01-01', room_id: ids.roomA, ...extra });

describe('setup', () => {
  test('two owners, each with a property and room', async () => {
    for (const [c, name, em] of [[ownerA, 'Owner A', 'a@x.com'], [ownerB, 'Owner B', 'b@x.com']]) {
      await signInOwner(c, em, name);
    }
    const pA = (await ownerA('POST', '/api/owner/properties', { name: 'A PG', address: '1 Road', city: 'Pune' })).data.property.id;
    const pB = (await ownerB('POST', '/api/owner/properties', { name: 'B PG', address: '2 Road', city: 'Pune' })).data.property.id;
    ids.roomA = (await ownerA('POST', `/api/owner/properties/${pA}/rooms`, { room_number: '1', capacity: 2, monthly_rent: 5000 })).data.room.id;
    ids.roomB = (await ownerB('POST', `/api/owner/properties/${pB}/rooms`, { room_number: '1', capacity: 2, monthly_rent: 9000 })).data.room.id;
  });
});

describe('who may create tenants', () => {
  test('not logged in -> 401', async () => {
    assert.equal((await create(anon, { name: 'Zed', email: 'zed@x.com' })).status, 401);
  });

  test('a tenant cannot create tenants -> 403', async () => {
    const t = await create(ownerA, { name: 'Tina', email: 'tina@x.com', ...roomBody() });
    assert.equal(t.status, 201);
    await registerTenant(tenantA, 'tina@x.com');
    assert.equal((await create(tenantA, { name: 'Sneaky', email: 'sneaky@x.com' })).status, 403);
    assert.equal((await tenantA('GET', '/api/owner/tenants')).status, 403);
    assert.equal((await db.get("SELECT 1 FROM users WHERE email = 'sneaky@x.com'")), undefined);
  });

  test('an owner cannot place a tenant in another owner’s room, and no account is created', async () => {
    const r = await create(ownerA, { name: 'Wrong Room', email: 'wrong@x.com', ...roomBody({ room_id: ids.roomB }) });
    assert.equal(r.status, 404);
    assert.equal((await db.get("SELECT 1 FROM users WHERE email = 'wrong@x.com'")), undefined);
  });

  test('each owner only lists their own tenants', async () => {
    const a = (await ownerA('GET', '/api/owner/tenants')).data.tenants;
    assert.deepEqual(a.map((t) => t.email), ['tina@x.com']);
    assert.equal((await ownerB('GET', '/api/owner/tenants')).data.tenants.length, 0);
  });

  test('the new tenant is linked to the creating owner and the right property', async () => {
    const row = await db.get(
      `SELECT u.role, u.owner_id, p.owner_id AS property_owner, u.must_change_password
       FROM users u JOIN tenancies t ON t.tenant_id = u.id JOIN rooms r ON r.id = t.room_id
       JOIN properties p ON p.id = r.property_id WHERE u.email = 'tina@x.com'`,
    );
    assert.equal(row.role, 'tenant');
    assert.equal(row.owner_id, row.property_owner);
    assert.equal(row.must_change_password, 0);
  });
});

describe('invalid input', () => {
  const bad = async (body, fields) => {
    const r = await create(ownerA, body);
    assert.equal(r.status, 400, JSON.stringify(r.data));
    for (const f of fields) assert.ok(r.data.details?.[f], `expected an error for "${f}": ${JSON.stringify(r.data)}`);
  };

  test('missing name and email', async () => bad({}, ['name', 'email']));
  test('name too short', async () => bad({ name: 'A', email: 'ok@x.com' }, ['name']));
  test('malformed email', async () => {
    await bad({ name: 'Ann', email: 'not-an-email' }, ['email']);
    await bad({ name: 'Ann', email: 'a b@x.com' }, ['email']);
    await bad({ name: 'Ann', email: 42 }, ['email']);
  });
  test('malformed phone', async () => bad({ name: 'Ann', email: 'ann@x.com', phone: 'call me' }, ['phone']));
  test('a room needs a move-in date', async () => bad({ name: 'Ann', email: 'ann@x.com', room_id: ids.roomA }, ['start_date']));
  test('bad move-in date, rent, deposit and due day', async () => {
    await bad({ name: 'Ann', email: 'ann@x.com', ...roomBody({ start_date: '2026-02-30' }) }, ['start_date']);
    await bad({ name: 'Ann', email: 'ann@x.com', ...roomBody({ monthly_rent: -5 }) }, ['monthly_rent']);
    await bad({ name: 'Ann', email: 'ann@x.com', ...roomBody({ deposit: 'lots' }) }, ['deposit']);
    await bad({ name: 'Ann', email: 'ann@x.com', ...roomBody({ due_day: 31 }) }, ['due_day']);
  });
  test('non-existent room -> 404', async () => {
    assert.equal((await create(ownerA, { name: 'Ann', email: 'ann@x.com', ...roomBody({ room_id: 99999 }) })).status, 404);
  });
  test('a body that is not an object is rejected, not a crash', async () => {
    const r = await fetch(`${base}/api/owner/tenants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' });
    assert.equal(r.status, 401);
    assert.equal((await create(ownerA, [])).status, 400);
  });
  test('nothing was created by any of the invalid requests', async () => {
    const users = (await db.all("SELECT email FROM users WHERE role = 'tenant'")).map((u) => u.email);
    assert.deepEqual(users, ['tina@x.com']);
  });
});

describe('duplicate emails', () => {
  test('same email (any letter case) as an existing tenant -> 409', async () => {
    assert.equal((await create(ownerA, { name: 'Tina Two', email: 'TINA@x.com' })).status, 409);
    assert.equal((await create(ownerB, { name: 'Tina Three', email: 'tina@x.com' })).status, 409, 'even for a different owner');
  });
  test('same email as an owner account -> 409', async () => {
    assert.equal((await create(ownerA, { name: 'Imposter', email: 'b@x.com' })).status, 409);
  });
  test('nobody can sign up as an owner with a tenant’s email (there is no owner sign-up)', async () => {
    const r = await anon('POST', '/api/auth/register-owner', { name: 'Tina', email: 'tina@x.com', password: 'password123' });
    assert.equal(r.status, 404);
  });
  test('the tenant’s login still works afterwards', async () => {
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM users WHERE email = 'tina@x.com'")).n, 1);
  });
});

describe('a tenant added without a room', () => {
  test('phone and room are optional; the tenant starts as invited with no usable password', async () => {
    const r = await create(ownerA, { name: 'No Room', email: 'noroom@x.com' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.tenant.room_id, null);
    assert.equal(r.data.tenant.phone, null);
    assert.equal(r.data.tenant.registered_at, null);
    assert.equal(r.data.tempPassword, undefined);
    assert.equal((await db.get("SELECT password_hash FROM users WHERE email = 'noroom@x.com'")).password_hash, '!');
  });

  test('they cannot log in before registering, whatever password is tried', async () => {
    for (const pass of ['!', '', 'password123', 'noroom@x.com']) {
      assert.equal((await anon('POST', '/api/auth/login', { email: 'noroom@x.com', password: pass })).status, pass ? 401 : 400);
    }
  });

  test('after registering they log in as a tenant (not an owner) and see an empty stay', async () => {
    await registerTenant(tenantNoRoom, 'noroom@x.com', 'mypassword1');
    const r = await anon('POST', '/api/auth/login', { email: 'NoRoom@X.com', password: 'mypassword1' });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'tenant');
    assert.equal((await tenantNoRoom('GET', '/api/tenant/dashboard')).data.stay, null);
    assert.equal((await tenantNoRoom('GET', '/api/owner/dashboard')).status, 403);
  });

  test('owners still log in as owners', async () => {
    const r = await anon('POST', '/api/auth/login', { email: 'a@x.com', password: 'password123' });
    assert.equal(r.data.user.role, 'owner');
  });
});

describe('secrets are never exposed', () => {
  test('read responses contain no password data; stored passwords are scrypt hashes', async () => {
    const tenants = await ownerA('GET', '/api/owner/tenants');
    const detail = await ownerA('GET', `/api/owner/tenants/${tenants.data.tenants[0].id}`);
    for (const body of [tenants.data, detail.data]) {
      const text = JSON.stringify(body).toLowerCase();
      assert.ok(!text.includes('password') && !text.includes('scrypt$') && !text.includes('code'), 'no secrets in read responses');
    }
    const registered = (await db.all("SELECT password_hash FROM users WHERE role = 'tenant' AND registered_at IS NOT NULL"));
    assert.ok(registered.length >= 2 && registered.every((h) => h.password_hash.startsWith('scrypt$')));
  });

  test('a tenant’s own profile response has no password fields', async () => {
    const me = await tenantNoRoom('GET', '/api/auth/me');
    assert.ok(!JSON.stringify(me.data).toLowerCase().includes('hash'));
  });
});
