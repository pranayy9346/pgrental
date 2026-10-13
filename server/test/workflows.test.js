// Tests for rent due dates and the vacate-request workflow. Separate in-memory database from api.test.js.
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

const owner = client();
const owner2 = client();
const alice = client();
const bob = client();
const ids = {};
const pw = {};
const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function login(c, email, password) {
  const r = await c('POST', '/api/auth/login', { email, password });
  assert.equal(r.status, 200);
}

describe('setup', () => {
  test('owner, property, room, two tenants', async () => {
    assert.equal((await owner('POST', '/api/auth/register-owner', { name: 'Owner', email: 'o@x.com', password: 'password123' })).status, 201);
    assert.equal((await owner2('POST', '/api/auth/register-owner', { name: 'Other', email: 'o2@x.com', password: 'password123' })).status, 201);
    ids.property = (await owner('POST', '/api/owner/properties', { name: 'PG', address: '1 Road', city: 'Pune' })).data.property.id;
    ids.room = (await owner('POST', `/api/owner/properties/${ids.property}/rooms`, { room_number: '1', capacity: 3, monthly_rent: 5000 })).data.room.id;

    const a = await owner('POST', '/api/owner/tenants', { name: 'Alice', email: 'alice@x.com', room_id: ids.room, start_date: '2026-01-01', due_day: 10 });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    assert.equal(a.data.tenant.due_day, 10);
    ids.alice = a.data.tenant.id;
    pw.alice = a.data.tempPassword;
    const b = await owner('POST', '/api/owner/tenants', { name: 'Bob', email: 'bob@x.com', room_id: ids.room, start_date: '2026-01-01' });
    assert.equal(b.data.tenant.due_day, 5, 'due day defaults to the 5th');
    ids.bob = b.data.tenant.id;
    pw.bob = b.data.tempPassword;
    await login(alice, 'alice@x.com', pw.alice);
    await login(bob, 'bob@x.com', pw.bob);
  });
});

describe('rent amounts and due dates', () => {
  test('charges use each stay’s rent and due day', async () => {
    assert.equal((await owner('PATCH', `/api/owner/tenants/${ids.bob}/tenancy`, { monthly_rent: 6000 })).data.tenant.monthly_rent, 6000);
    const g = await owner('POST', '/api/owner/payments/generate', { period: '2026-03' });
    assert.equal(g.data.created, 2);
    const list = (await owner('GET', '/api/owner/payments?period=2026-03')).data.payments;
    const byName = Object.fromEntries(list.map((p) => [p.tenant_name, p]));
    assert.equal(byName.Alice.due_date, '2026-03-10');
    assert.equal(byName.Alice.amount_due, 5000);
    assert.equal(byName.Bob.due_date, '2026-03-05');
    assert.equal(byName.Bob.amount_due, 6000);
    ids.alicePayment = byName.Alice.id;
  });

  test('changing a stay’s rent does not rewrite existing charges', async () => {
    await owner('PATCH', `/api/owner/tenants/${ids.alice}/tenancy`, { monthly_rent: 5500, due_day: 1 });
    const p = (await owner('GET', '/api/owner/payments?period=2026-03&tenant_id=' + ids.alice)).data.payments[0];
    assert.equal(p.amount_due, 5000);
    assert.equal(p.due_date, '2026-03-10');
    await owner('POST', '/api/owner/payments/generate', { period: '2026-04' });
    const next = (await owner('GET', '/api/owner/payments?period=2026-04&tenant_id=' + ids.alice)).data.payments[0];
    assert.equal(next.amount_due, 5500);
    assert.equal(next.due_date, '2026-04-01');
  });

  test('a single charge’s due date can be changed; bad values are rejected', async () => {
    const ok = await owner('PATCH', `/api/owner/payments/${ids.alicePayment}`, { due_date: '2026-03-20' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.payment.due_date, '2026-03-20');
    assert.equal((await owner('PATCH', `/api/owner/payments/${ids.alicePayment}`, { due_date: 'soon' })).status, 400);
    assert.equal((await owner('PATCH', `/api/owner/tenants/${ids.alice}/tenancy`, { due_day: 31 })).status, 400);
    assert.equal((await owner('PATCH', `/api/owner/tenants/${ids.alice}/tenancy`, { monthly_rent: -1 })).status, 400);
    assert.equal((await owner2('PATCH', `/api/owner/tenants/${ids.alice}/tenancy`, { monthly_rent: 1 })).status, 404);
    assert.equal((await owner2('PATCH', `/api/owner/payments/${ids.alicePayment}`, { due_date: '2026-03-21' })).status, 404);
  });

  test('tenant sees their own balance, history and due date, and nobody else’s', async () => {
    const mine = (await alice('GET', '/api/tenant/payments')).data.payments;
    assert.equal(mine.length, 2);
    assert.equal(mine.find((p) => p.period === '2026-03').due_date, '2026-03-20');
    const dash = (await alice('GET', '/api/tenant/dashboard')).data;
    assert.equal(dash.balanceDue, 5000 + 5500);
    const bobs = (await bob('GET', '/api/tenant/payments')).data.payments;
    assert.equal(bobs.length, 2);
    assert.ok(bobs.every((p) => p.amount_due >= 6000 || p.period === '2026-04'));
  });

  test('partial payments update the balance', async () => {
    const r = await owner('POST', `/api/owner/payments/${ids.alicePayment}/record`, { amount: 2000, method: 'cash' });
    assert.equal(r.data.payment.status, 'partial');
    assert.equal((await alice('GET', '/api/tenant/dashboard')).data.balanceDue, 3000 + 5500);
  });
});

describe('vacate requests', () => {
  test('validation: past date, missing date, not logged in as tenant', async () => {
    assert.equal((await alice('POST', '/api/tenant/vacate-requests', { requested_date: iso(-3) })).status, 400);
    assert.equal((await alice('POST', '/api/tenant/vacate-requests', {})).status, 400);
    assert.equal((await owner('POST', '/api/tenant/vacate-requests', { requested_date: iso(10) })).status, 403);
    assert.equal((await owner('GET', '/api/tenant/vacate-requests')).status, 403);
  });

  test('tenant submits one request; a second pending one is refused', async () => {
    const r = await alice('POST', '/api/tenant/vacate-requests', { requested_date: iso(14), reason: 'Moving cities' });
    assert.equal(r.status, 201);
    assert.equal(r.data.requests[0].status, 'pending');
    ids.aliceRequest = r.data.requests[0].id;
    assert.equal((await alice('POST', '/api/tenant/vacate-requests', { requested_date: iso(20) })).status, 409);
    assert.equal((await alice('GET', '/api/tenant/dashboard')).data.vacateRequest.id, ids.aliceRequest);
    assert.equal((await owner('GET', '/api/owner/dashboard')).data.stats.pending_vacates, 1);
  });

  test('owner sees it with the tenant’s outstanding balance; other roles/owners cannot', async () => {
    const list = (await owner('GET', '/api/owner/vacate-requests')).data.requests;
    assert.equal(list.length, 1);
    assert.equal(list[0].tenant_name, 'Alice');
    assert.equal(list[0].balance_due, 3000 + 5500);
    assert.equal((await owner2('GET', '/api/owner/vacate-requests')).data.requests.length, 0);
    assert.equal((await owner2('POST', `/api/owner/vacate-requests/${ids.aliceRequest}/approve`, {})).status, 404);
    assert.equal((await bob('GET', '/api/owner/vacate-requests')).status, 403);
    assert.equal((await bob('POST', `/api/tenant/vacate-requests/${ids.aliceRequest}/cancel`)).status, 404, 'Bob cannot cancel Alice’s request');
  });

  test('owner rejects: stay continues, tenant sees the note, can re-apply', async () => {
    const r = await owner('POST', `/api/owner/vacate-requests/${ids.aliceRequest}/reject`, { owner_note: 'Please give 30 days notice' });
    assert.equal(r.status, 200);
    assert.equal(r.data.request.status, 'rejected');
    const mine = (await alice('GET', '/api/tenant/vacate-requests')).data.requests;
    assert.equal(mine[0].status, 'rejected');
    assert.equal(mine[0].owner_note, 'Please give 30 days notice');
    assert.ok((await alice('GET', '/api/tenant/dashboard')).data.stay, 'still has a stay');
    assert.equal((await owner('POST', `/api/owner/vacate-requests/${ids.aliceRequest}/approve`, {})).status, 409, 'cannot decide twice');
  });

  test('tenant can cancel a pending request', async () => {
    const r = await alice('POST', '/api/tenant/vacate-requests', { requested_date: iso(40) });
    assert.equal(r.status, 201);
    const c = await alice('POST', `/api/tenant/vacate-requests/${r.data.requests[0].id}/cancel`);
    assert.equal(c.status, 200);
    assert.equal(c.data.requests[0].status, 'cancelled');
    assert.equal((await alice('POST', `/api/tenant/vacate-requests/${r.data.requests[0].id}/cancel`)).status, 404);
    assert.equal((await owner('GET', '/api/owner/dashboard')).data.stats.pending_vacates, 0);
  });

  test('owner approves: stay ends on the requested date, bed freed, history kept', async () => {
    const date = iso(7);
    const r = await alice('POST', '/api/tenant/vacate-requests', { requested_date: date });
    const id = r.data.requests[0].id;
    const a = await owner('POST', `/api/owner/vacate-requests/${id}/approve`, { owner_note: 'Approved. Deposit refunded after balance is cleared.' });
    assert.equal(a.status, 200);
    assert.equal(a.data.request.status, 'approved');

    const t = (await owner('GET', `/api/owner/tenants/${ids.alice}`)).data;
    assert.equal(t.tenant.room_id, null);
    assert.equal(t.tenancies[0].status, 'ended');
    assert.equal(t.tenancies[0].end_date, date);
    assert.equal(t.payments.length, 2, 'rent history kept');

    const dash = (await alice('GET', '/api/tenant/dashboard')).data;
    assert.equal(dash.stay, null);
    assert.equal(dash.balanceDue, 3000 + 5500, 'unpaid rent stays on record');
    assert.equal((await alice('GET', '/api/tenant/vacate-requests')).data.requests[0].status, 'approved');
    assert.equal((await alice('POST', '/api/tenant/vacate-requests', { requested_date: iso(30) })).status, 409, 'no stay left');
    const rooms = (await owner('GET', '/api/owner/rooms')).data.rooms;
    assert.equal(rooms[0].occupied, 1);
  });

  test('a manual move-out cancels the tenant’s pending request', async () => {
    await bob('POST', '/api/tenant/vacate-requests', { requested_date: iso(5) });
    assert.equal((await owner('POST', `/api/owner/tenants/${ids.bob}/move-out`, {})).status, 200);
    assert.equal((await bob('GET', '/api/tenant/vacate-requests')).data.requests[0].status, 'cancelled');
    assert.equal((await owner('GET', '/api/owner/dashboard')).data.stats.pending_vacates, 0);
  });
});
