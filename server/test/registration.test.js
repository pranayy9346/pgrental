// Tenant self-registration with just an owner-added email and a password (no email verification step).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { asOwner, signInOwner } from './helpers.js';

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

const owner = asOwner(client(), 'owner@x.com');
const otherOwner = asOwner(client(), 'other@x.com');
const anon = client();
const register = (c, email, password = 'goodpassword1') => c('POST', '/api/auth/tenant/register', { email, password });
const ids = {};

describe('setup', () => {
  test('an owner with a PG and room adds tenants', async () => {
    await signInOwner(owner, 'owner@x.com');
    await signInOwner(otherOwner, 'other@x.com', 'Other');
    await owner('PUT', '/api/owner/pg', { name: 'PG', address: '1 Road', city: 'Pune', total_floors: 2 });
    ids.room = (await owner('POST', '/api/owner/pg/rooms', { room_number: '101', floor: 1, capacity: 10, monthly_rent: 5000 })).data.room.id;
    for (const n of ['dana', 'eve', 'finn', 'gus', 'hana', 'ivy', 'jo', 'kim', 'lee']) {
      const r = await owner('POST', '/api/owner/tenants', { name: n, email: `${n}@x.com`, room_id: ids.room, start_date: '2026-01-01' });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      ids[n] = r.data.tenant.id;
    }
  });

  test('the verification-code endpoints no longer exist', async () => {
    assert.equal((await anon('POST', '/api/auth/tenant/request-code', { email: 'dana@x.com' })).status, 404);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'registration_codes'").get(), undefined, 'table is gone');
  });
});

describe('an invited tenant registers directly', () => {
  const dana = client();

  test('email + password is enough: no code, no email', async () => {
    const r = await register(dana, 'dana@x.com', 'danaPassword1');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.user.role, 'tenant');
    assert.equal(r.data.user.email, 'dana@x.com');
    assert.equal(r.data.user.mustChangePassword, false);
    assert.ok(!JSON.stringify(r.data).toLowerCase().includes('hash'));
  });

  test('they are signed in and see their own rental dashboard, linked to the owner’s room', async () => {
    const d = await dana('GET', '/api/tenant/dashboard');
    assert.equal(d.status, 200);
    assert.equal(d.data.stay.room_number, '101');
    assert.equal(d.data.stay.property_name, 'PG');
  });

  test('they cannot reach the owner dashboard or any owner data', async () => {
    assert.equal((await dana('GET', '/api/owner/dashboard')).status, 403);
    assert.equal((await dana('GET', '/api/owner/pg')).status, 403);
    assert.equal((await dana('GET', '/api/owner/tenants')).status, 403);
    assert.equal((await dana('POST', '/api/owner/tenants', { name: 'X Y', email: 'xy@x.com' })).status, 403);
  });

  test('the password is stored hashed and the account is marked registered', () => {
    const row = db.prepare('SELECT role, password_hash, registered_at FROM users WHERE email = ?').get('dana@x.com');
    assert.equal(row.role, 'tenant');
    assert.ok(row.password_hash.startsWith('scrypt$') && !row.password_hash.includes('danaPassword1'));
    assert.ok(row.registered_at);
  });

  test('they can log out and log in again with the chosen password', async () => {
    await dana('POST', '/api/auth/logout');
    assert.equal((await dana('GET', '/api/auth/me')).status, 401);
    const r = await anon('POST', '/api/auth/login', { email: 'Dana@X.com', password: 'danaPassword1' });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'tenant');
    assert.equal((await anon('POST', '/api/auth/login', { email: 'dana@x.com', password: 'danaPassword2' })).status, 401);
  });

  test('the owner sees them as registered; others stay invited', async () => {
    const list = (await owner('GET', '/api/owner/tenants')).data.tenants;
    assert.ok(list.find((t) => t.email === 'dana@x.com').registered_at);
    assert.equal(list.find((t) => t.email === 'eve@x.com').registered_at, null);
  });
});

describe('email matching', () => {
  test('letter case and surrounding spaces do not matter', async () => {
    const r = await register(client(), '  EVE@X.Com  ');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.user.email, 'eve@x.com');
  });

  test('the exact email is required: similar addresses do not match', async () => {
    for (const email of ['finn@x.co', 'finn+1@x.com', 'inn@x.com', 'finn@y.com', 'finn.@x.com']) {
      assert.equal((await register(client(), email)).status, 404, email);
    }
    assert.equal(db.prepare('SELECT registered_at FROM users WHERE email = ?').get('finn@x.com').registered_at, null);
  });

  test('a malformed or missing email is a validation error', async () => {
    for (const email of ['nope', 'a b@x.com', '', undefined, 42, null]) {
      const r = await register(client(), email);
      assert.equal(r.status, 400, String(email));
      assert.ok(r.data.details.email, `message for ${email}`);
    }
  });
});

describe('who is refused', () => {
  test('an email the owner never added is refused with a clear message and no account is created', async () => {
    const r = await register(client(), 'stranger@x.com');
    assert.equal(r.status, 404);
    assert.match(r.data.error, /not been added by a PG owner/);
    assert.equal(db.prepare("SELECT 1 FROM users WHERE email = 'stranger@x.com'").get(), undefined);
  });

  test('registering the same email twice is refused and the first password stays in force', async () => {
    const first = client();
    assert.equal((await register(first, 'finn@x.com', 'finnPassword1')).status, 201);
    const second = await register(client(), 'finn@x.com', 'attackerPass1');
    assert.equal(second.status, 409);
    assert.match(second.data.error, /already exists/);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'finn@x.com', password: 'attackerPass1' })).status, 401);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'finn@x.com', password: 'finnPassword1' })).status, 200);
  });

  test('an owner’s email cannot be used to register (and no owner can be created this way)', async () => {
    const r = await register(client(), 'owner@x.com', 'ownerHijack1');
    assert.equal(r.status, 404);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get().n, 2);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'owner@x.com', password: 'ownerHijack1' })).status, 401);
  });

  test('extra fields such as a role are ignored: the account is still a tenant', async () => {
    const t = client();
    const r = await t('POST', '/api/auth/tenant/register', { email: 'gus@x.com', password: 'gusPassword1', role: 'owner', owner_id: null });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'tenant');
    assert.equal((await t('GET', '/api/owner/dashboard')).status, 403);
  });
});

describe('passwords', () => {
  test('a password shorter than 8 characters is refused and the invitation stays usable', async () => {
    for (const password of ['short', '1234567', '']) {
      const r = await register(client(), 'hana@x.com', password);
      assert.equal(r.status, 400, `"${password}"`);
      assert.ok(r.data.details.password);
    }
    assert.equal((await client()('POST', '/api/auth/tenant/register', { email: 'hana@x.com' })).status, 400, 'no password at all');
    assert.equal(db.prepare('SELECT registered_at FROM users WHERE email = ?').get('hana@x.com').registered_at, null);
    assert.equal((await register(client(), 'hana@x.com', '12345678')).status, 201, 'exactly 8 characters is fine');
  });

  test('an over-long password is refused', async () => {
    assert.equal((await register(client(), 'ivy@x.com', 'x'.repeat(129))).status, 400);
  });

  test('the same password may be used by different tenants, each stored with its own salt', async () => {
    assert.equal((await register(client(), 'ivy@x.com', 'sharedPassword1')).status, 201);
    assert.equal((await register(client(), 'jo@x.com', 'sharedPassword1')).status, 201);
    const hashes = db.prepare("SELECT password_hash FROM users WHERE email IN ('ivy@x.com','jo@x.com')").all().map((r) => r.password_hash);
    assert.notEqual(hashes[0], hashes[1]);
  });
});

describe('concurrent requests', () => {
  test('two simultaneous registrations for one email: exactly one wins, the other is refused', async () => {
    const [a, b] = [client(), client()];
    const results = await Promise.all([register(a, 'kim@x.com', 'firstPassword1'), register(b, 'kim@x.com', 'secondPassword1')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'kim@x.com'").get().n, 1, 'no duplicate account');

    // only the winner's password works, and the refused request got no session
    const firstWon = results[0].status === 201;
    const [winner, loser] = firstWon ? ['firstPassword1', 'secondPassword1'] : ['secondPassword1', 'firstPassword1'];
    assert.equal((await anon('POST', '/api/auth/login', { email: 'kim@x.com', password: winner })).status, 200);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'kim@x.com', password: loser })).status, 401);
    assert.equal(((await (firstWon ? b : a)('GET', '/api/auth/me'))).status, 401);
  });

  test('many simultaneous registrations still create one account', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => register(client(), 'lee@x.com', `racePassword${i}`)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 7);
  });
});

describe('owner controls', () => {
  test('another owner or a tenant cannot reset someone’s access', async () => {
    assert.equal((await otherOwner('POST', `/api/owner/tenants/${ids.dana}/reset-access`)).status, 404);
    const tenant = client();
    assert.equal((await tenant('POST', '/api/auth/login', { email: 'hana@x.com', password: '12345678' })).status, 200);
    assert.equal((await tenant('POST', `/api/owner/tenants/${ids.dana}/reset-access`)).status, 403);
  });

  test('the email of a registered tenant cannot be changed; an unregistered one can be corrected', async () => {
    assert.equal((await owner('PATCH', `/api/owner/tenants/${ids.dana}`, { email: 'new@x.com' })).status, 409);
    const added = await owner('POST', '/api/owner/tenants', { name: 'Typo', email: 'typo@x.com' });
    assert.equal((await owner('PATCH', `/api/owner/tenants/${added.data.tenant.id}`, { email: 'fixed@x.com' })).status, 200);
    assert.equal((await register(client(), 'typo@x.com')).status, 404, 'the mistyped address no longer works');
    assert.equal((await register(client(), 'fixed@x.com')).status, 201);
  });

  test('resetting access logs the tenant out everywhere and they register again with a new password', async () => {
    const t = client();
    const added = await owner('POST', '/api/owner/tenants', { name: 'Reset Me', email: 'reset@x.com', room_id: ids.room, start_date: '2026-01-01' });
    await register(t, 'reset@x.com', 'oldPassword1');
    assert.equal((await t('GET', '/api/tenant/dashboard')).status, 200);

    const r = await owner('POST', `/api/owner/tenants/${added.data.tenant.id}/reset-access`);
    assert.equal(r.status, 200);
    assert.equal(r.data.tenant.registered_at, null);
    assert.equal((await t('GET', '/api/auth/me')).status, 401, 'existing session ended');
    assert.equal((await anon('POST', '/api/auth/login', { email: 'reset@x.com', password: 'oldPassword1' })).status, 401, 'old password is dead');

    const again = client();
    assert.equal((await register(again, 'reset@x.com', 'newPassword1')).status, 201);
    assert.equal((await again('GET', '/api/tenant/dashboard')).data.stay.room_number, '101', 'still in their room');
  });
});

describe('abuse protection', () => {
  test('repeated attempts with emails that are not invited are rate limited, per IP', async () => {
    let last;
    for (let i = 0; i < 30; i++) last = await register(client(), `nobody${i}@x.com`);
    assert.equal(last.status, 429);
  });
});
