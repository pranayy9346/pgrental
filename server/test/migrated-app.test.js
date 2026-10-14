// After copying an old SQLite database into PostgreSQL, the application must work on it exactly as before.
// This only runs when the app itself is using PostgreSQL (npm run test:pg); it is skipped on the SQLite driver.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { migrate } from '../src/schema.js';

process.env.DB_PATH = ':memory:';
const { default: db } = await import('../src/db.js');
const { default: app } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');
const { ensureOwner } = await import('../src/lib/owner.js');
const { migrateSqliteToPostgres } = await import('../src/db/migrate-data.js');

const skip = db.dialect === 'sqlite' && 'runs on the PostgreSQL driver only (npm run test:pg)';
let server;
let base;
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

before(async () => {
  if (skip) return;
  // an "old installation": owner, two tenants (one registered), a PG with floors, rent charges, a complaint, a notice
  const lite = new Database(':memory:');
  lite.pragma('foreign_keys = ON');
  migrate(lite);
  const ownerHash = await hashPassword('Old-owner-pass-1');
  const tenantHash = await hashPassword('old-tenant-pass');
  const run = (sql, ...a) => lite.prepare(sql).run(...a);
  run("INSERT INTO users (id, role, name, email, password_hash, registered_at) VALUES (1, 'owner', 'Owner', 'boss@example.com', ?, '2026-01-01T00:00:00.000Z')", ownerHash);
  run("INSERT INTO users (id, role, name, email, password_hash, owner_id, registered_at) VALUES (2, 'tenant', 'Old Tenant', 'old@x.com', ?, 1, '2026-01-02T00:00:00.000Z')", tenantHash);
  run("INSERT INTO users (id, role, name, email, password_hash, owner_id) VALUES (3, 'tenant', 'Waiting Tenant', 'waiting@x.com', '!', 1)");
  run("INSERT INTO properties (id, owner_id, name, address, city, total_floors) VALUES (1, 1, 'Old PG', '1 Road', 'Pune', 2)");
  run("INSERT INTO rooms (id, property_id, room_number, floor, capacity, monthly_rent) VALUES (1, 1, '101', 1, 2, 7000)");
  run("INSERT INTO tenancies (id, tenant_id, room_id, start_date, monthly_rent, deposit, due_day) VALUES (1, 2, 1, '2026-01-01', 7000, 14000, 8)");
  run("INSERT INTO payments (id, tenancy_id, period, amount_due, amount_paid, status, due_date, paid_on, method) VALUES (1, 1, ?, 7000, 3000, 'partial', ?, ?, 'cash')", month, `${month}-08`, `${month}-09`);
  run("INSERT INTO complaints (id, tenancy_id, title, description) VALUES (1, 1, 'Tap', 'Tap is leaking badly')");
  run("INSERT INTO notices (id, property_id, title, body) VALUES (1, 1, 'Rules', 'Quiet after 10 pm')");
  await migrateSqliteToPostgres({ source: lite, target: db, commit: true });
  lite.close();

  process.env.OWNER_EMAIL = 'boss@example.com';
  process.env.OWNER_PASSWORD = 'Old-owner-pass-1';
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server?.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

describe('the app on migrated data', { skip }, () => {
  const owner = client();
  const tenant = client();

  test('the owner password hash that was copied still matches OWNER_PASSWORD (no change, nobody logged out)', async () => {
    assert.equal((await ensureOwner()).status, 'unchanged');
  });

  test('owner logs in with the old password and sees the copied PG, rooms and money', async () => {
    assert.equal((await owner('POST', '/api/auth/login', { email: 'boss@example.com', password: 'Old-owner-pass-1' })).status, 200);
    const pg = (await owner('GET', '/api/owner/pg')).data;
    assert.equal(pg.pg.name, 'Old PG');
    assert.equal(pg.pg.total_floors, 2);
    assert.deepEqual(pg.rooms.map((r) => [r.room_number, r.floor, r.occupied, r.status]), [['101', 1, 1, 'partial']]);
    const dash = (await owner('GET', '/api/owner/dashboard')).data;
    assert.equal(dash.stats.total_beds, 2);
    assert.equal(dash.stats.occupied_beds, 1);
    assert.equal(dash.stats.month_due, 7000);
    assert.equal(dash.stats.month_collected, 3000);
    assert.equal(dash.stats.total_outstanding, 4000);
    assert.equal(dash.stats.open_complaints, 1);
  });

  test('the tenants list shows who is registered and who is still waiting', async () => {
    const list = (await owner('GET', '/api/owner/tenants')).data.tenants;
    assert.deepEqual(list.map((t) => [t.email, Boolean(t.registered_at), t.balance_due]), [
      ['old@x.com', true, 4000],
      ['waiting@x.com', false, 0],
    ]);
  });

  test('a migrated tenant logs in with the old password and sees their own stay, balance and notice', async () => {
    assert.equal((await tenant('POST', '/api/auth/login', { email: 'old@x.com', password: 'old-tenant-pass' })).status, 200);
    const d = (await tenant('GET', '/api/tenant/dashboard')).data;
    assert.equal(d.stay.room_number, '101');
    assert.equal(d.stay.due_day, 8);
    assert.equal(d.balanceDue, 4000);
    assert.deepEqual(d.notices.map((n) => n.title), ['Rules']);
    assert.equal(d.openComplaints, 1);
    assert.equal((await tenant('GET', '/api/owner/pg')).status, 403);
  });

  test('a tenant who had not registered yet registers after the migration with a code from the owner', async () => {
    const waiting = client();
    const body = { email: 'waiting@x.com', password: 'new-tenant-pass', invite_code: 'ABCD-EFGH-JK23' };
    assert.equal((await waiting('POST', '/api/auth/tenant/register', body)).status, 400, 'older invitations have no code');
    const invite = await owner('POST', '/api/owner/tenants/3/invite');
    assert.equal(invite.status, 200, JSON.stringify(invite.data));
    const r = await waiting('POST', '/api/auth/tenant/register', { ...body, invite_code: invite.data.invite.code });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'tenant');
  });

  test('new records continue after the copied ids (no clashes)', async () => {
    const complaint = await tenant('POST', '/api/tenant/complaints', { title: 'Light', description: 'Bulb has fused', category: 'electrical' });
    assert.equal(complaint.status, 201);
    assert.equal(complaint.data.complaint.id, 2);
    const room = await owner('POST', '/api/owner/pg/rooms', { room_number: '201', floor: 1, capacity: 1, monthly_rent: 9000 });
    assert.equal(room.status, 201);
    assert.equal(room.data.room.id, 2);
    const added = await owner('POST', '/api/owner/tenants', { name: 'Fresh Tenant', email: 'fresh@x.com', room_id: 2, start_date: today });
    assert.equal(added.status, 201);
    assert.equal(added.data.tenant.id, 4);
  });

  test('rent can be generated and paid on the migrated stay, and the due day (8) is respected', async () => {
    const next = month === '2026-12' ? '2027-01' : `${month.slice(0, 4)}-${String(Number(month.slice(5)) + 1).padStart(2, '0')}`;
    const g = await owner('POST', '/api/owner/payments/generate', { period: next });
    assert.equal(g.status, 200);
    assert.ok(g.data.created >= 1);
    const charges = (await owner('GET', `/api/owner/payments?period=${next}`)).data.payments;
    assert.equal(charges.find((c) => c.tenant_name === 'Old Tenant').due_date, `${next}-08`);
    const pay = await owner('POST', `/api/owner/payments/${charges.find((c) => c.tenant_name === 'Old Tenant').id}/record`, { amount: 7000 });
    assert.equal(pay.data.payment.status, 'paid');
  });
});
