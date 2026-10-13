// End-to-end API tests against a throwaway in-memory database.
// Run from the project root:  npm test
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

process.env.DB_PATH = ':memory:';
const { default: app } = await import('../src/app.js');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

// A tiny client that remembers its session cookie, like a browser would.
function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

const owner = client();
const owner2 = client();
const tenant = client();
const anon = client();
const ids = {};
let tempPassword;

describe('authentication', () => {
  test('protected routes need a login', async () => {
    assert.equal((await anon('GET', '/api/auth/me')).status, 401);
    assert.equal((await anon('GET', '/api/owner/dashboard')).status, 401);
    assert.equal((await anon('GET', '/api/tenant/dashboard')).status, 401);
  });

  test('owner can register', async () => {
    const r = await owner('POST', '/api/auth/register-owner', {
      name: 'Owner One',
      email: 'One@Example.com',
      password: 'password123',
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'owner');
    assert.equal(r.data.user.email, 'one@example.com');
    assert.equal(r.data.user.password_hash, undefined);
  });

  test('registration validates input and rejects duplicates', async () => {
    const bad = await anon('POST', '/api/auth/register-owner', { name: 'x', email: 'nope', password: '123' });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.data.details).sort(), ['email', 'name', 'password']);
    const dup = await anon('POST', '/api/auth/register-owner', {
      name: 'Someone',
      email: 'one@example.com',
      password: 'password123',
    });
    assert.equal(dup.status, 409);
  });

  test('second owner registers', async () => {
    const r = await owner2('POST', '/api/auth/register-owner', {
      name: 'Owner Two',
      email: 'two@example.com',
      password: 'password123',
    });
    assert.equal(r.status, 201);
  });

  test('wrong password is rejected', async () => {
    const r = await anon('POST', '/api/auth/login', { email: 'one@example.com', password: 'wrongpass' });
    assert.equal(r.status, 401);
  });

  test('cross-site requests are blocked', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'one@example.com', password: 'password123' }),
    });
    assert.equal(res.status, 403);
  });

  test('invalid JSON gives 400', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    assert.equal(res.status, 400);
  });
});

describe('owner: properties and rooms', () => {
  test('create property and rooms', async () => {
    const p = await owner('POST', '/api/owner/properties', { name: 'Sunrise PG', address: '12 MG Road', city: 'Pune' });
    assert.equal(p.status, 201);
    ids.property = p.data.property.id;

    const r1 = await owner('POST', `/api/owner/properties/${ids.property}/rooms`, {
      room_number: '101',
      capacity: 1,
      monthly_rent: 8000,
    });
    assert.equal(r1.status, 201);
    ids.room1 = r1.data.room.id;
    const r2 = await owner('POST', `/api/owner/properties/${ids.property}/rooms`, {
      room_number: '102',
      capacity: '2',
      monthly_rent: '6000',
    });
    assert.equal(r2.status, 201);
    ids.room2 = r2.data.room.id;
  });

  test('duplicate room number is rejected', async () => {
    const r = await owner('POST', `/api/owner/properties/${ids.property}/rooms`, {
      room_number: '101',
      capacity: 1,
      monthly_rent: 1,
    });
    assert.equal(r.status, 409);
  });

  test('another owner cannot see or change this property', async () => {
    assert.equal((await owner2('GET', `/api/owner/properties/${ids.property}`)).status, 404);
    assert.equal((await owner2('PATCH', `/api/owner/properties/${ids.property}`, { name: 'Hacked' })).status, 404);
    assert.equal((await owner2('PATCH', `/api/owner/rooms/${ids.room1}`, { capacity: 5 })).status, 404);
    assert.equal((await owner2('GET', '/api/owner/properties')).data.properties.length, 0);
  });

  test('property with rooms cannot be deleted', async () => {
    assert.equal((await owner('DELETE', `/api/owner/properties/${ids.property}`)).status, 409);
  });
});

describe('owner: tenants', () => {
  test('create tenant and assign to room', async () => {
    const r = await owner('POST', '/api/owner/tenants', {
      name: 'Rahul',
      email: 'rahul@example.com',
      phone: '9876543210',
      room_id: ids.room1,
      start_date: '2026-01-01',
      deposit: 10000,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.tempPassword, /^pg-/);
    assert.equal(r.data.tenant.monthly_rent, 8000);
    ids.tenant = r.data.tenant.id;
    tempPassword = r.data.tempPassword;
  });

  test('full room rejects another tenant (and no account is left behind)', async () => {
    const r = await owner('POST', '/api/owner/tenants', {
      name: 'Second',
      email: 'second@example.com',
      room_id: ids.room1,
      start_date: '2026-01-01',
    });
    assert.equal(r.status, 409);
    const list = await owner('GET', '/api/owner/tenants');
    assert.equal(list.data.tenants.length, 1);
  });

  test('owner cannot assign tenant to another owner’s room', async () => {
    const r = await owner2('POST', '/api/owner/tenants', {
      name: 'Sneaky',
      email: 'sneaky@example.com',
      room_id: ids.room1,
      start_date: '2026-01-01',
    });
    assert.equal(r.status, 404);
  });

  test('other owner cannot see this tenant', async () => {
    assert.equal((await owner2('GET', `/api/owner/tenants/${ids.tenant}`)).status, 404);
    assert.equal((await owner2('POST', `/api/owner/tenants/${ids.tenant}/move-out`, {})).status, 404);
  });

  test('room capacity cannot drop below occupancy', async () => {
    await owner('POST', '/api/owner/tenants', { name: 'Room Mate', email: 'mate@example.com', room_id: ids.room2, start_date: '2026-01-01' });
    await owner('POST', '/api/owner/tenants', { name: 'Room Mate2', email: 'mate2@example.com', room_id: ids.room2, start_date: '2026-01-01' });
    const r = await owner('PATCH', `/api/owner/rooms/${ids.room2}`, { capacity: 1 });
    assert.equal(r.status, 409);
    // free the room again for the transfer test below
    for (const t of (await owner('GET', '/api/owner/tenants?status=active')).data.tenants.filter((x) => x.room_id === ids.room2)) {
      assert.equal((await owner('POST', `/api/owner/tenants/${t.id}/move-out`, { end_date: '2026-01-31' })).status, 200);
    }
  });
});

describe('tenant experience', () => {
  test('tenant logs in with temporary password and must change it', async () => {
    const r = await tenant('POST', '/api/auth/login', { email: 'rahul@example.com', password: tempPassword });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.mustChangePassword, true);
    const c = await tenant('POST', '/api/auth/change-password', {
      currentPassword: tempPassword,
      newPassword: 'newpassword1',
    });
    assert.equal(c.status, 200);
    const me = await tenant('GET', '/api/auth/me');
    assert.equal(me.data.user.mustChangePassword, false);
  });

  test('tenant cannot use owner API and owner cannot use tenant API', async () => {
    assert.equal((await tenant('GET', '/api/owner/dashboard')).status, 403);
    assert.equal((await tenant('GET', '/api/owner/tenants')).status, 403);
    assert.equal((await owner('GET', '/api/tenant/dashboard')).status, 403);
  });

  test('tenant dashboard shows their stay', async () => {
    const r = await tenant('GET', '/api/tenant/dashboard');
    assert.equal(r.status, 200);
    assert.equal(r.data.stay.room_number, '101');
    assert.equal(r.data.stay.property_name, 'Sunrise PG');
  });

  test('tenant raises a complaint, owner replies', async () => {
    const c = await tenant('POST', '/api/tenant/complaints', {
      title: 'Fan broken',
      description: 'Ceiling fan does not work',
      category: 'electrical',
    });
    assert.equal(c.status, 201);
    const list = await owner('GET', '/api/owner/complaints');
    assert.equal(list.data.complaints.length, 1);
    assert.equal((await owner2('PATCH', `/api/owner/complaints/${c.data.complaint.id}`, { status: 'resolved' })).status, 404);
    const u = await owner('PATCH', `/api/owner/complaints/${c.data.complaint.id}`, {
      status: 'resolved',
      owner_reply: 'Fixed today',
    });
    assert.equal(u.status, 200);
    const mine = await tenant('GET', '/api/tenant/complaints');
    assert.equal(mine.data.complaints[0].status, 'resolved');
    assert.equal(mine.data.complaints[0].owner_reply, 'Fixed today');
  });

  test('notices reach tenants of that property only', async () => {
    const n = await owner('POST', '/api/owner/notices', { property_id: ids.property, title: 'Water off', body: 'Sunday 10-1' });
    assert.equal(n.status, 201);
    assert.equal((await owner2('POST', '/api/owner/notices', { property_id: ids.property, title: 'x1', body: 'y' })).status, 404);
    const t = await tenant('GET', '/api/tenant/notices');
    assert.equal(t.data.notices.length, 1);
  });

  test('tenant can edit own phone but not role', async () => {
    const r = await tenant('PATCH', '/api/auth/profile', { phone: '+91 99999 11111', role: 'owner' });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.phone, '+91 99999 11111');
    assert.equal(r.data.user.role, 'tenant');
  });
});

describe('payments', () => {
  test('generate monthly charges (idempotent)', async () => {
    const g = await owner('POST', '/api/owner/payments/generate', { period: '2026-02' });
    assert.equal(g.data.created, 1);
    const again = await owner('POST', '/api/owner/payments/generate', { period: '2026-02' });
    assert.equal(again.data.created, 0);
    const other = await owner2('POST', '/api/owner/payments/generate', { period: '2026-02' });
    assert.equal(other.data.created, 0);
  });

  test('record part and full payments', async () => {
    const list = await owner('GET', '/api/owner/payments?period=2026-02');
    const pay = list.data.payments[0];
    assert.equal(pay.amount_due, 8000);
    assert.equal((await owner2('POST', `/api/owner/payments/${pay.id}/record`, { amount: 100 })).status, 404);

    let r = await owner('POST', `/api/owner/payments/${pay.id}/record`, { amount: 3000, method: 'cash' });
    assert.equal(r.data.payment.status, 'partial');
    r = await owner('POST', `/api/owner/payments/${pay.id}/record`, { amount: 6000 });
    assert.equal(r.status, 400, 'overpayment rejected');
    r = await owner('POST', `/api/owner/payments/${pay.id}/record`, { amount: 5000, method: 'upi' });
    assert.equal(r.data.payment.status, 'paid');

    const mine = await tenant('GET', '/api/tenant/payments');
    assert.equal(mine.data.payments.length, 1);
    assert.equal(mine.data.payments[0].status, 'paid');
  });

  test('owner dashboard numbers', async () => {
    const d = await owner('GET', '/api/owner/dashboard');
    assert.equal(d.status, 200);
    assert.equal(d.data.stats.properties, 1);
    assert.equal(d.data.stats.total_beds, 3);
    assert.equal(d.data.stats.occupied_beds, 1);
  });
});

describe('move out and transfers', () => {
  test('transfer to another room ends the old stay', async () => {
    const r = await owner('POST', `/api/owner/tenants/${ids.tenant}/assign`, { room_id: ids.room2, start_date: '2026-03-01' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.tenant.room_number, '102');
    const detail = await owner('GET', `/api/owner/tenants/${ids.tenant}`);
    assert.equal(detail.data.tenancies.length, 2);
    assert.equal(detail.data.tenancies[1].status, 'ended');
  });

  test('move out', async () => {
    const bad = await owner('POST', `/api/owner/tenants/${ids.tenant}/move-out`, { end_date: '2025-01-01' });
    assert.equal(bad.status, 400);
    const r = await owner('POST', `/api/owner/tenants/${ids.tenant}/move-out`, { end_date: '2026-04-30' });
    assert.equal(r.status, 200);
    assert.equal(r.data.tenant.room_id, null);
    const d = await tenant('GET', '/api/tenant/dashboard');
    assert.equal(d.data.stay, null);
    assert.equal((await tenant('POST', '/api/tenant/complaints', { title: 'abc', description: 'abcdef' })).status, 409);
    // History is still visible to the tenant.
    assert.equal((await tenant('GET', '/api/tenant/payments')).data.payments.length, 1);
  });

  test('room with history cannot be deleted', async () => {
    assert.equal((await owner('DELETE', `/api/owner/rooms/${ids.room1}`)).status, 409);
  });

  test('password reset logs the tenant out', async () => {
    const r = await owner('POST', `/api/owner/tenants/${ids.tenant}/reset-password`);
    assert.equal(r.status, 200);
    assert.equal((await tenant('GET', '/api/auth/me')).status, 401);
  });

  test('logout ends the session', async () => {
    await owner2('POST', '/api/auth/logout');
    assert.equal((await owner2('GET', '/api/auth/me')).status, 401);
  });

  test('unknown API route returns JSON 404', async () => {
    const r = await anon('GET', '/api/nope');
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'API route not found');
  });
});
