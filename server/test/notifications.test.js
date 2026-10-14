// Unread notification badges: who is notified, independent read state, duplicates, deletions, persistence,
// authorization. Runs on whichever driver the suite uses (SQLite for `npm test`, real PostgreSQL for `npm run test:pg`).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { asOwner, registerTenant, signInOwner } from './helpers.js';

process.env.DB_PATH = ':memory:';
const { default: app } = await import('../src/app.js');
const { default: db } = await import('../src/db.js');
const { notify } = await import('../src/lib/notify.js');

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
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
  call.clone = () => {
    const c = client();
    c.setCookie(cookie);
    return c;
  };
  return Object.assign(call, { setCookie: (c) => (cookie = c) });
}

const anon = client();
const owner = asOwner(client(), 'o@x.com');
const owner2 = asOwner(client(), 'o2@x.com');
const alice = client();
const bob = client();
const carol = client(); // belongs to the OTHER owner
const ids = {};

const summary = async (c) => (await c('GET', '/api/notifications/summary')).data.summary;
const list = async (c, qs = '') => (await c('GET', `/api/notifications${qs}`)).data;
const unreadTypes = async (c) => (await list(c, '?status=unread&limit=50')).notifications.map((n) => n.type).sort();

describe('setup', () => {
  test('two owners, one PG each, three tenants (carol belongs to the other owner)', async () => {
    await signInOwner(owner, 'o@x.com');
    await signInOwner(owner2, 'o2@x.com', 'Other');
    ids.pg = (await owner('POST', '/api/owner/properties', { name: 'PG One', address: '1 Road', city: 'Pune' })).data.property.id;
    ids.pg2 = (await owner2('POST', '/api/owner/properties', { name: 'PG Two', address: '2 Road', city: 'Pune' })).data.property.id;
    ids.room = (await owner('POST', `/api/owner/properties/${ids.pg}/rooms`, { room_number: '1', capacity: 4, monthly_rent: 5000 })).data.room.id;
    ids.room2 = (await owner2('POST', `/api/owner/properties/${ids.pg2}/rooms`, { room_number: '9', capacity: 2, monthly_rent: 4000 })).data.room.id;
    for (const [key, name, mail, room, c, who] of [
      ['alice', 'Alice', 'alice@x.com', ids.room, alice, owner],
      ['bob', 'Bob', 'bob@x.com', ids.room, bob, owner],
      ['carol', 'Carol', 'carol@x.com', ids.room2, carol, owner2],
    ]) {
      const r = await who('POST', '/api/owner/tenants', { name, email: mail, room_id: room, start_date: '2026-01-01' });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      ids[key] = r.data.tenant.id;
      await registerTenant(c, mail);
    }
  });

  test('records that existed before the feature produce no notifications', async () => {
    // Simulates data that is already in the database when the feature is deployed.
    await db.run("INSERT INTO notices (property_id, title, body) VALUES (?, 'Old notice', 'from before')", [ids.pg]);
    for (const c of [owner, owner2, alice, bob, carol]) assert.deepEqual(await summary(c), { total: 0, notices: 0, complaints: 0, payments: 0, moveout: 0 });
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM notifications')).n, 0);
  });
});

describe('notices', () => {
  test('publishing notifies every active tenant of that PG and nobody else', async () => {
    const r = await owner('POST', '/api/owner/notices', { property_id: ids.pg, title: 'Water off Sunday', body: 'Tank cleaning 10-2.' });
    assert.equal(r.status, 201);
    ids.notice = r.data.notice.id;
    assert.equal((await summary(alice)).notices, 1);
    assert.equal((await summary(bob)).notices, 1);
    assert.equal((await summary(carol)).total, 0, 'a tenant of another owner is not notified');
    assert.equal((await summary(owner)).total, 0, 'the owner does not notify themselves');
    assert.equal((await summary(owner2)).total, 0);
  });

  test('the center shows it with the right text and link', async () => {
    const n = (await list(alice, '?status=unread')).notifications[0];
    assert.equal(n.type, 'notice.published');
    assert.equal(n.title, 'New notice: Water off Sunday');
    assert.equal(n.link, '/tenant/notices');
    assert.equal(n.read_at, null);
    assert.match(n.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('loading dashboards and list pages never marks anything as read', async () => {
    for (let i = 0; i < 2; i++) {
      for (const path of ['/api/tenant/notices', '/api/tenant/dashboard', '/api/tenant/complaints', '/api/tenant/payments', '/api/tenant/vacate-requests', '/api/notifications', '/api/notifications/summary', '/api/notifications/unread-entities', '/api/auth/me']) {
        assert.equal((await bob('GET', path)).status, 200, path);
      }
    }
    assert.equal((await summary(bob)).notices, 1);
    assert.deepEqual((await bob('GET', '/api/notifications/unread-entities?category=notices')).data.items, [{ entity_type: 'notice', entity_id: ids.notice, count: 1 }]);
  });

  test('each user has their own read state: alice reading it does not change bob', async () => {
    const nid = (await list(alice, '?status=unread')).notifications[0].id;
    const r = await alice('POST', `/api/notifications/${nid}/read`);
    assert.equal(r.status, 200);
    assert.equal(r.data.updated, 1);
    assert.equal(r.data.summary.notices, 0, 'the response already carries the new counts');
    assert.equal((await summary(alice)).notices, 0);
    assert.equal((await summary(bob)).notices, 1, 'bob is unaffected');
    assert.equal((await list(alice, '?status=unread')).notifications.length, 0);
    const all = (await list(alice, '?status=all')).notifications;
    assert.equal(all.length, 1);
    assert.ok(all[0].read_at, 'it stays in the All tab, now marked read');
  });

  test('marking the same notification again is harmless', async () => {
    const nid = (await list(alice)).notifications[0].id;
    const again = await alice('POST', `/api/notifications/${nid}/read`);
    assert.equal(again.status, 200);
    assert.equal(again.data.updated, 0);
  });

  test('bob cannot touch alice’s notification: it answers 404 exactly like a missing one', async () => {
    const aliceNid = (await list(alice)).notifications[0].id;
    assert.equal((await bob('POST', `/api/notifications/${aliceNid}/read`)).status, 404);
    assert.equal((await bob('POST', '/api/notifications/999999/read')).status, 404);
    assert.equal((await bob('POST', '/api/notifications/abc/read')).status, 404);
    assert.equal((await summary(bob)).notices, 1);
  });

  test('a notice that is deleted takes its notifications with it', async () => {
    const r = await owner('POST', '/api/owner/notices', { property_id: ids.pg, title: 'Temporary', body: 'x' });
    assert.equal((await summary(bob)).notices, 2);
    assert.equal((await owner('DELETE', `/api/owner/notices/${r.data.notice.id}`)).status, 200);
    assert.equal((await summary(bob)).notices, 1, 'no badge for a notice that no longer exists');
    assert.equal((await list(bob, '?status=all')).notifications.some((n) => n.title.includes('Temporary')), false);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM notifications WHERE entity_type = 'notice' AND entity_id = ?", [r.data.notice.id])).n, 0);
  });

  test('"Mark as read" for one record and the explicit "Mark all as read"', async () => {
    const r = await bob('POST', '/api/notifications/read', { entity_type: 'notice', entity_id: ids.notice });
    assert.equal(r.data.updated, 1);
    assert.equal(r.data.summary.total, 0);
    await owner('POST', '/api/owner/notices', { property_id: ids.pg, title: 'Notice A', body: 'a' });
    await owner('POST', '/api/owner/notices', { property_id: ids.pg, title: 'Notice B', body: 'b' });
    assert.equal((await summary(bob)).total, 2);
    const all = await bob('POST', '/api/notifications/read', { all: true });
    assert.equal(all.data.updated, 2);
    assert.equal(all.data.summary.total, 0);
  });
});

describe('complaints', () => {
  test('a new complaint notifies the owner only', async () => {
    const r = await alice('POST', '/api/tenant/complaints', { title: 'Wi-Fi slow', description: 'Drops every night', category: 'internet' });
    assert.equal(r.status, 201);
    ids.complaint = r.data.complaint.id;
    assert.equal((await summary(owner)).complaints, 1);
    assert.equal((await summary(owner2)).total, 0, 'another owner is not told');
    assert.equal((await summary(bob)).total, 0, 'other tenants are not told');
    const n = (await list(owner, '?status=unread')).notifications[0];
    assert.equal(n.link, '/owner/complaints');
    assert.match(n.body, /Alice \(Room 1\)/);
  });

  test('a status or reply change notifies that tenant once, and the owner acting acknowledges the new-complaint badge', async () => {
    const r = await owner('PATCH', `/api/owner/complaints/${ids.complaint}`, { status: 'in_progress', owner_reply: 'Router replaced' });
    assert.equal(r.status, 200);
    assert.equal((await summary(alice)).complaints, 1);
    assert.equal((await summary(bob)).complaints, 0);
    assert.equal((await summary(owner)).complaints, 0, 'updating the complaint acknowledges the owner’s own notification');
    const n = (await list(alice, '?status=unread')).notifications[0];
    assert.equal(n.type, 'complaint.updated');
    assert.match(n.body, /Status: In progress/);
    assert.match(n.body, /Reply: Router replaced/);
    assert.equal(n.link, '/tenant/complaints');
  });

  test('sending the identical update again changes nothing and notifies nobody', async () => {
    const r = await owner('PATCH', `/api/owner/complaints/${ids.complaint}`, { status: 'in_progress', owner_reply: 'Router replaced' });
    assert.equal(r.status, 200);
    assert.equal((await summary(alice)).complaints, 1);
  });

  test('two identical updates at the same moment produce exactly one notification', async () => {
    const before = (await summary(alice)).complaints;
    const [a, b] = await Promise.all([
      owner('PATCH', `/api/owner/complaints/${ids.complaint}`, { status: 'resolved' }),
      owner('PATCH', `/api/owner/complaints/${ids.complaint}`, { status: 'resolved' }),
    ]);
    assert.ok([a.status, b.status].every((s) => s === 200 || s === 409), `${a.status}/${b.status}`);
    assert.equal((await summary(alice)).complaints, before + 1);
  });

  test('after she reads it, a later update makes the badge come back', async () => {
    await alice('POST', '/api/notifications/read', { all: true });
    assert.equal((await summary(alice)).total, 0);
    await owner('PATCH', `/api/owner/complaints/${ids.complaint}`, { status: 'open', owner_reply: 'Reopened, still checking' });
    assert.equal((await summary(alice)).complaints, 1);
  });

  test('changing nothing the tenant cares about (same values) does not notify', async () => {
    await alice('POST', '/api/notifications/read', { all: true });
    await owner('PATCH', `/api/owner/complaints/${ids.complaint}`, { status: 'open' });
    assert.equal((await summary(alice)).total, 0);
  });
});

describe('rent and payments', () => {
  test('generating charges notifies each billed tenant, and generating again notifies nobody', async () => {
    await alice('POST', '/api/notifications/read', { all: true });
    const g = await owner('POST', '/api/owner/payments/generate', { period: '2026-03' });
    assert.equal(g.data.created, 2);
    assert.equal((await summary(alice)).payments, 1);
    assert.equal((await summary(bob)).payments, 1);
    assert.equal((await summary(carol)).total, 0, 'the other owner’s tenant is not billed or told');
    const n = (await list(alice, '?status=unread&category=payments')).notifications[0];
    assert.equal(n.type, 'payment.charged');
    assert.match(n.body, /₹5,000 is due on 5 Mar 2026/);
    assert.equal(n.link, '/tenant/payments');
    const again = await owner('POST', '/api/owner/payments/generate', { period: '2026-03' });
    assert.equal(again.data.created, 0);
    assert.equal((await summary(alice)).payments, 1, 'no duplicate for an already billed month');
    assert.equal((await summary(bob)).payments, 1);
    const charges = (await owner('GET', '/api/owner/payments?period=2026-03')).data.payments;
    ids.alicePay = charges.find((p) => p.tenant_name === 'Alice').id;
    ids.bobPay = charges.find((p) => p.tenant_name === 'Bob').id;
  });

  test('recording a payment notifies that tenant; each payment notifies once', async () => {
    const r = await owner('POST', `/api/owner/payments/${ids.alicePay}/record`, { amount: 2000, method: 'cash' });
    assert.equal(r.status, 200);
    assert.equal((await summary(alice)).payments, 2);
    const received = (await list(alice, '?status=unread&category=payments')).notifications.find((n) => n.type === 'payment.received');
    assert.match(received.title, /₹2,000 received/);
    assert.match(received.body, /₹3,000 still due/);
    assert.equal((await summary(bob)).payments, 1, 'bob is not told about alice’s payment');
    await owner('POST', `/api/owner/payments/${ids.alicePay}/record`, { amount: 3000 });
    assert.equal((await summary(alice)).payments, 3);
  });

  test('adjusting a charge notifies only when the amount or due date really changed', async () => {
    await alice('POST', '/api/notifications/read', { all: true });
    await owner('PATCH', `/api/owner/payments/${ids.bobPay}`, { note: 'just a note' });
    assert.equal((await summary(bob)).payments, 1, 'a note alone is not news (bob still has the unread charge only)');
    await bob('POST', '/api/notifications/read', { all: true });
    const r = await owner('PATCH', `/api/owner/payments/${ids.bobPay}`, { amount_due: 5450, note: 'incl. electricity' });
    assert.equal(r.status, 200);
    assert.equal((await summary(bob)).payments, 1);
    const n = (await list(bob, '?status=unread')).notifications[0];
    assert.equal(n.type, 'payment.adjusted');
    assert.match(n.body, /₹5,000 → ₹5,450/);
  });

  test('deleting an unpaid charge removes the notifications about it', async () => {
    assert.equal((await owner('DELETE', `/api/owner/payments/${ids.bobPay}`)).status, 200);
    assert.equal((await summary(bob)).payments, 0);
    assert.equal((await list(bob, '?status=all')).notifications.some((n) => n.entity_type === 'payment' && n.entity_id === ids.bobPay), false);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM notifications WHERE entity_type = 'payment' AND entity_id = ?", [ids.bobPay])).n, 0);
  });
});

describe('move-out requests', () => {
  const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  test('a request notifies the owner; withdrawing it notifies the owner again', async () => {
    await owner('POST', '/api/notifications/read', { all: true });
    assert.equal((await alice('POST', '/api/tenant/vacate-requests', { requested_date: future(10), reason: 'new job' })).status, 201);
    assert.equal((await summary(owner)).moveout, 1);
    assert.equal((await summary(owner2)).total, 0);
    const n = (await list(owner, '?status=unread')).notifications[0];
    assert.equal(n.link, '/owner/vacate-requests');
    const requestId = (await alice('GET', '/api/tenant/vacate-requests')).data.requests[0].id;
    assert.equal((await alice('POST', `/api/tenant/vacate-requests/${requestId}/cancel`)).status, 200);
    assert.equal((await summary(owner)).moveout, 2);
    assert.deepEqual(await unreadTypes(owner), ['vacate.requested', 'vacate.withdrawn']);
  });

  test('approving notifies the tenant once and acknowledges the owner’s request badge', async () => {
    await alice('POST', '/api/tenant/vacate-requests', { requested_date: future(12), reason: 'again' });
    const req = (await owner('GET', '/api/owner/vacate-requests')).data.requests.find((r) => r.status === 'pending');
    const r = await owner('POST', `/api/owner/vacate-requests/${req.id}/approve`, { owner_note: 'Safe travels' });
    assert.equal(r.status, 200);
    assert.deepEqual(await unreadTypes(alice), ['vacate.approved'], 'exactly one notification, no extra "cancelled" from ending the stay');
    const n = (await list(alice, '?status=unread')).notifications[0];
    assert.match(n.body, /Safe travels/);
    assert.equal(n.link, '/tenant/vacate');
    const ownerUnread = (await list(owner, '?status=unread&limit=50')).notifications.filter((x) => x.entity_id === req.id);
    assert.equal(ownerUnread.length, 0, 'deciding the request acknowledged its notification');
    assert.equal((await owner('POST', `/api/owner/vacate-requests/${req.id}/approve`, {})).status, 409, 'cannot be decided twice');
    assert.deepEqual(await unreadTypes(alice), ['vacate.approved'], 'and the second attempt notified nobody');
  });

  test('rejecting notifies the tenant', async () => {
    await bob('POST', '/api/tenant/vacate-requests', { requested_date: future(15) });
    const req = (await owner('GET', '/api/owner/vacate-requests')).data.requests.find((r) => r.status === 'pending');
    await owner('POST', `/api/owner/vacate-requests/${req.id}/reject`, { owner_note: 'Please stay until the 30th' });
    assert.deepEqual(await unreadTypes(bob), ['vacate.rejected']);
  });

  test('ending a stay by hand closes a waiting request and tells the tenant', async () => {
    await bob('POST', '/api/notifications/read', { all: true });
    await bob('POST', '/api/tenant/vacate-requests', { requested_date: future(20) });
    const pending = (await owner('GET', '/api/owner/vacate-requests')).data.requests.find((r) => r.status === 'pending');
    assert.equal((await owner('POST', `/api/owner/tenants/${ids.bob}/move-out`, {})).status, 200);
    assert.deepEqual(await unreadTypes(bob), ['vacate.cancelled']);
    const ownerSees = (await list(owner, '?status=unread&limit=50')).notifications.filter((x) => x.entity_id === pending.id);
    assert.equal(ownerSees.length, 0, 'the owner acted, so the request notification is closed');
  });
});

describe('duplicates', () => {
  test('the same event processed twice creates one notification (unique key)', async () => {
    const before = (await db.get('SELECT COUNT(*) AS n FROM notifications')).n;
    const event = { to: ids.carol, type: 'notice.published', entityId: 424242, title: 'Dup test' };
    assert.equal(await notify(db, event), true);
    assert.equal(await notify(db, event), false, 'second delivery is a no-op');
    assert.equal(await notify(db, event), false);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM notifications')).n, before + 1);
    assert.equal(await notify(db, { ...event, version: 'v2' }), true, 'a different occurrence of the same kind is a new notification');
  });

  test('the database itself refuses a duplicate even if the code did not', async () => {
    await assert.rejects(
      db.run(
        "INSERT INTO notifications (recipient_id, category, type, entity_type, entity_id, title, dedupe_key) VALUES (?, 'notices', 'notice.published', 'notice', 1, 't', 'notice.published:424242')",
        [ids.carol],
      ),
      (err) => ['SQLITE_CONSTRAINT_UNIQUE', '23505'].includes(err.code),
    );
  });
});

const dave = client();
const erin = client();

describe('two more active tenants for the remaining groups', () => {
  test('dave and erin join the first PG', async () => {
    for (const [key, name, mail, c] of [['dave', 'Dave', 'dave@x.com', dave], ['erin', 'Erin', 'erin@x.com', erin]]) {
      const r = await owner('POST', '/api/owner/tenants', { name, email: mail, room_id: ids.room, start_date: '2026-01-01' });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      ids[key] = r.data.tenant.id;
      await registerTenant(c, mail);
    }
  });

  test('a former tenant (stay ended) is not told about new notices, active ones are', async () => {
    const r = await owner('POST', '/api/owner/notices', { property_id: ids.pg, title: 'After move-out', body: 'x' });
    ids.afterMoveOut = r.data.notice.id;
    assert.equal((await summary(dave)).notices, 1);
    assert.equal((await summary(erin)).notices, 1);
    const aliceNotices = (await list(alice, '?status=all&limit=50')).notifications.filter((n) => n.entity_id === ids.afterMoveOut);
    assert.equal(aliceNotices.length, 0, 'alice’s stay has ended');
  });
});

describe('authorization and isolation', () => {
  test('every notification endpoint needs a login', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/notifications/summary'],
      ['GET', '/api/notifications'],
      ['GET', '/api/notifications/unread-entities'],
      ['POST', '/api/notifications/1/read'],
      ['POST', '/api/notifications/read', { all: true }],
    ]) {
      assert.equal((await anon(method, path, body)).status, 401, `${method} ${path}`);
    }
  });

  test('a tenant’s list contains only their own notifications; the owner sees only owner events', async () => {
    const carolAll = (await list(carol, '?status=all&limit=50')).notifications;
    assert.ok(carolAll.every((n) => n.type === 'notice.published' && n.entity_id === 424242 || n.title === 'Dup test'), 'carol only has her own');
    const aliceAll = (await list(alice, '?status=all&limit=50')).notifications;
    assert.ok(aliceAll.length > 0);
    assert.ok(aliceAll.every((n) => !/Bob/.test(`${n.title} ${n.body}`)), 'nothing about bob in alice’s list');
    const ownerTypes = new Set((await list(owner, '?status=all&limit=50')).notifications.map((n) => n.type));
    for (const t of ownerTypes) assert.ok(['complaint.new', 'vacate.requested', 'vacate.withdrawn'].includes(t), `owner got a tenant-only type ${t}`);
    assert.equal((await list(owner2, '?status=all')).notifications.length, 0);
  });

  test('a recipient id in the request body is ignored: only the caller’s own notifications change', async () => {
    const daveBefore = (await summary(dave)).total;
    assert.ok(daveBefore >= 1);
    const r = await erin('POST', '/api/notifications/read', { all: true, recipient_id: ids.dave, user_id: ids.dave });
    assert.equal(r.status, 200);
    assert.equal((await summary(erin)).total, 0, 'erin’s own were marked');
    assert.equal((await summary(dave)).total, daveBefore, 'dave’s unread notifications were not touched');
  });

  test('"Mark as read" for a record only affects the caller, never other recipients of the same notice', async () => {
    const r = await carol('POST', '/api/notifications/read', { entity_type: 'notice', entity_id: ids.afterMoveOut });
    assert.equal(r.status, 200);
    assert.equal(r.data.updated, 0, 'carol has no notification for that notice');
    assert.equal((await summary(dave)).notices, 1, 'dave’s notification for it is still unread');
  });

  test('bad input is rejected with 400', async () => {
    assert.equal((await alice('GET', '/api/notifications?category=hacking')).status, 400);
    assert.equal((await alice('GET', '/api/notifications?limit=500')).status, 400);
    assert.equal((await alice('GET', '/api/notifications?before=abc')).status, 400);
    assert.equal((await alice('GET', '/api/notifications?status=maybe')).status, 400);
    assert.equal((await alice('POST', '/api/notifications/read', { entity_type: 'user', entity_id: 1 })).status, 400);
    assert.equal((await alice('POST', '/api/notifications/read', {})).status, 400);
  });

  test('responses are never cached', async () => {
    const r = await alice('GET', '/api/notifications/summary');
    assert.match(r.headers.get('cache-control'), /no-store/);
  });
});

describe('persistence and paging', () => {
  test('unread counts survive logout, a new session and a second device', async () => {
    await owner('POST', '/api/owner/notices', { property_id: ids.pg, title: 'Persistent', body: 'p' });
    const before = await summary(dave);
    assert.ok(before.notices >= 1);
    await dave('POST', '/api/auth/logout');
    assert.equal((await dave('GET', '/api/notifications/summary')).status, 401);
    const secondDevice = client();
    assert.equal((await secondDevice('POST', '/api/auth/login', { email: 'dave@x.com', password: 'password123' })).status, 200);
    assert.deepEqual(await summary(secondDevice), before, 'a fresh login on another device sees the same counts');
    await secondDevice('POST', '/api/notifications/read', { entity_type: 'notice', entity_id: ids.afterMoveOut });
    const thirdDevice = client();
    await thirdDevice('POST', '/api/auth/login', { email: 'dave@x.com', password: 'password123' });
    assert.deepEqual(await summary(thirdDevice), await summary(secondDevice), 'read state is stored on the server');
    assert.equal((await dave('POST', '/api/auth/login', { email: 'dave@x.com', password: 'password123' })).status, 200); // dave signs in again for the tests below
  });

  test('the center pages newest-first without gaps or repeats', async () => {
    for (let i = 0; i < 25; i++) await owner('POST', '/api/owner/notices', { property_id: ids.pg, title: `Bulk ${i}`, body: 'b' });
    const seen = [];
    let before = '';
    for (let page = 0; page < 10; page++) {
      const r = await list(erin, `?status=all&limit=10${before}`);
      seen.push(...r.notifications.map((n) => n.id));
      if (!r.nextBefore) break;
      before = `&before=${r.nextBefore}`;
    }
    assert.equal(new Set(seen).size, seen.length, 'no repeats');
    assert.deepEqual(seen, [...seen].sort((a, b) => b - a), 'newest first');
    assert.ok(seen.length >= 25);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ?', [ids.erin])).n, seen.length, 'every row was reachable');
  });

  test('counts equal the number of unread rows (badge accuracy)', async () => {
    for (const [c, id] of [[alice, ids.alice], [bob, ids.bob], [carol, ids.carol], [dave, ids.dave], [erin, ids.erin]]) {
      const s = await summary(c);
      const n = (await db.get('SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND read_at IS NULL', [id])).n;
      assert.equal(s.total, Number(n));
      assert.equal(s.notices + s.complaints + s.payments + s.moveout, s.total);
    }
  });
});
