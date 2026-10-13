// The single, predefined owner account: configuration, login, no sign-up, and tenant registration still working.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { registerTenant } from './helpers.js';

process.env.DB_PATH = ':memory:';
process.env.OWNER_EMAIL = 'Boss@Example.com';
process.env.OWNER_PASSWORD = 'Str0ng-owner-pass';
process.env.OWNER_NAME = 'The Boss';
const { default: app } = await import('../src/app.js');
const { default: db } = await import('../src/db.js');
const { ensureOwner } = await import('../src/lib/owner.js');
const { hashPassword } = await import('../src/lib/auth.js');

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
const owner = client();
const owners = () => db.all("SELECT * FROM users WHERE role = 'owner'");
const login = (c, email, password) => c('POST', '/api/auth/login', { email, password });
const setConfig = (email, password) => {
  process.env.OWNER_EMAIL = email;
  process.env.OWNER_PASSWORD = password;
};
const restoreConfig = () => setConfig('Boss@Example.com', 'Str0ng-owner-pass');

describe('configuring the owner', () => {
  test('before the server has set anything up there is no owner', async () => {
    assert.equal((await owners()).length, 0);
  });

  test('startup creates exactly one owner, with a hashed password', async () => {
    const r = await ensureOwner();
    assert.equal(r.status, 'created');
    assert.equal(r.email, 'boss@example.com');
    const rows = (await owners());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'The Boss');
    assert.equal(rows[0].email, 'boss@example.com');
    assert.ok(rows[0].password_hash.startsWith('scrypt$'));
    assert.ok(!rows[0].password_hash.includes('Str0ng-owner-pass'));
  });

  test('running startup again changes nothing', async () => {
    const before = (await owners())[0];
    assert.equal((await ensureOwner()).status, 'unchanged');
    assert.equal((await owners()).length, 1);
    assert.equal((await owners())[0].password_hash, before.password_hash);
  });
});

describe('owner login', () => {
  test('the predefined credentials work and give the owner dashboard', async () => {
    const r = await login(owner, 'boss@example.com', 'Str0ng-owner-pass');
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'owner');
    assert.equal(r.data.user.email, 'boss@example.com');
    assert.ok(!JSON.stringify(r.data).toLowerCase().includes('hash'));
    assert.equal((await owner('GET', '/api/owner/dashboard')).status, 200);
  });

  test('the email is not case sensitive', async () => {
    assert.equal((await login(client(), 'BOSS@example.COM', 'Str0ng-owner-pass')).status, 200);
  });

  test('a wrong password or an unknown email is refused the same way', async () => {
    const wrong = await login(client(), 'boss@example.com', 'Str0ng-owner-pasS');
    const unknown = await login(client(), 'nobody@example.com', 'Str0ng-owner-pass');
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.data, unknown.data);
  });

  test('the owner password is never sent to the browser', async () => {
    const me = await owner('GET', '/api/auth/me');
    assert.ok(!JSON.stringify(me.data).includes('Str0ng'));
    assert.ok(!JSON.stringify((await owner('GET', '/api/owner/pg')).data).includes('Str0ng'));
  });

  test('the owner cannot change the password inside the app, but can edit their name and phone', async () => {
    const r = await owner('POST', '/api/auth/change-password', { currentPassword: 'Str0ng-owner-pass', newPassword: 'another-pass-1' });
    assert.equal(r.status, 403);
    assert.equal((await login(client(), 'boss@example.com', 'Str0ng-owner-pass')).status, 200, 'password unchanged');
    const p = await owner('PATCH', '/api/auth/profile', { name: 'Boss Man', phone: '9876543210' });
    assert.equal(p.status, 200);
    assert.equal(p.data.user.role, 'owner');
  });
});

describe('no way to become an owner', () => {
  const body = { name: 'Intruder', email: 'intruder@example.com', password: 'password123' };

  test('sign-up endpoints do not exist, with or without a login', async () => {
    for (const c of [anon, owner]) {
      for (const path of ['/api/auth/register-owner', '/api/auth/register', '/api/auth/owner', '/api/owner/register', '/api/owners']) {
        for (const method of ['POST', 'PUT']) {
          const { status } = await c(method, path, body);
          // Everything under /api/owner asks for a login first (401); otherwise the route simply does not exist (404).
          const allowed = c === anon && path.startsWith('/api/owner/') ? [401, 404] : [404];
          assert.ok(allowed.includes(status), `${method} ${path} -> ${status}`);
        }
      }
    }
  });

  test('no other request can create an owner row', async () => {
    await owner('POST', '/api/owner/tenants', { ...body, role: 'owner' });
    await owner('PATCH', '/api/auth/profile', { role: 'owner', name: 'Boss Man' });
    await client()('POST', '/api/auth/tenant/register', { ...body, role: 'owner' }); // the owner added this email as a tenant above
    await client()('POST', '/api/auth/login', { ...body, role: 'owner' });
    assert.equal((await owners()).length, 1);
    assert.equal((await db.get("SELECT role FROM users WHERE email = 'intruder@example.com'"))?.role, 'tenant', 'only a tenant could be created');
  });

  test('the owner-only API refuses everyone who is not logged in as the owner', async () => {
    assert.equal((await anon('GET', '/api/owner/pg')).status, 401);
    assert.equal((await anon('PUT', '/api/owner/pg', { name: 'Mine' })).status, 401);
  });
});

describe('tenants still register with an owner-added email', () => {
  test('the owner sets up the PG and adds a tenant', async () => {
    assert.equal((await owner('PUT', '/api/owner/pg', { name: 'PG', address: '1 Road', city: 'Pune', total_floors: 1 })).status, 201);
    const room = await owner('POST', '/api/owner/pg/rooms', { room_number: '1', capacity: 2, monthly_rent: 5000 });
    assert.equal(room.status, 201);
    const t = await owner('POST', '/api/owner/tenants', { name: 'Tia', email: 'tia@x.com', room_id: room.data.room.id, start_date: '2026-01-01' });
    assert.equal(t.status, 201);
  });

  test('the invited tenant registers, lands on the tenant side and cannot reach owner data', async () => {
    const tenant = client();
    const r = await registerTenant(tenant, 'tia@x.com', 'tiaPassword1');
    assert.equal(r.data.user.role, 'tenant');
    assert.equal((await tenant('GET', '/api/tenant/dashboard')).data.stay.room_number, '1');
    assert.equal((await tenant('GET', '/api/owner/pg')).status, 403);
    assert.equal((await login(client(), 'tia@x.com', 'tiaPassword1')).data.user.role, 'tenant');
  });

  test('an email the owner did not add cannot register and gets no account', async () => {
    const stranger = client();
    assert.equal((await stranger('POST', '/api/auth/tenant/register', { email: 'stranger@x.com', password: 'password123' })).status, 404);
    assert.equal((await db.get("SELECT 1 FROM users WHERE email = 'stranger@x.com'")), undefined);
  });

  test('the owner’s own email cannot be used to register as a tenant', async () => {
    assert.equal((await anon('POST', '/api/auth/tenant/register', { email: 'boss@example.com', password: 'password123' })).status, 404);
    assert.equal((await owners()).length, 1);
  });

  test('resetting access still sends the tenant back through registration', async () => {
    const tid = (await db.get("SELECT id FROM users WHERE email = 'tia@x.com'")).id;
    assert.equal((await owner('POST', `/api/owner/tenants/${tid}/reset-access`)).status, 200);
    assert.equal((await login(client(), 'tia@x.com', 'tiaPassword1')).status, 401);
    const again = client();
    await registerTenant(again, 'tia@x.com', 'tiaNewPass1');
    assert.equal((await again('GET', '/api/tenant/dashboard')).status, 200);
  });
});

describe('changing the configured password', () => {
  test('a new OWNER_PASSWORD replaces the old one and ends old sessions', async () => {
    const session = client();
    await login(session, 'boss@example.com', 'Str0ng-owner-pass');
    assert.equal((await session('GET', '/api/auth/me')).status, 200);

    setConfig('boss@example.com', 'Brand-new-pass-9');
    assert.equal((await ensureOwner()).status, 'updated');
    assert.equal((await session('GET', '/api/auth/me')).status, 401, 'old session ended');
    assert.equal((await login(client(), 'boss@example.com', 'Str0ng-owner-pass')).status, 401, 'old password is dead');
    assert.equal((await login(client(), 'boss@example.com', 'Brand-new-pass-9')).status, 200);
    assert.equal((await owners()).length, 1);
    restoreConfig();
    await ensureOwner();
  });
});

describe('existing databases', () => {
  test('an owner row with the configured email is adopted and keeps its data', async () => {
    const hash = await hashPassword('old-password-1');
    const id = await db.insert("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'Old Owner', 'legacy@x.com', ?)", [hash]);
    (await db.run("INSERT INTO properties (owner_id, name, address, city) VALUES (?, 'Legacy PG', 'a', 'c')", [id]));

    setConfig('legacy@x.com', 'Legacy-new-pass-1');
    const r = await ensureOwner();
    assert.equal(r.status, 'updated');
    assert.equal((await db.get("SELECT id FROM users WHERE email = 'legacy@x.com'")).id, id, 'same account');
    const session = client();
    assert.equal((await login(session, 'legacy@x.com', 'Legacy-new-pass-1')).status, 200);
    assert.equal((await session('GET', '/api/owner/pg')).data.pg.name, 'Legacy PG');
    assert.equal((await login(client(), 'legacy@x.com', 'old-password-1')).status, 401);
  });

  test('other owner rows are kept but disabled: they cannot log in and their sessions stop working', async () => {
    const r = await ensureOwner();
    assert.equal(r.disabledOwners, 1, 'boss@example.com is now the disabled one');
    assert.equal((await owners()).length, 2, 'nothing is deleted');
    assert.equal((await login(client(), 'boss@example.com', 'Brand-new-pass-9')).status, 401);
    assert.equal((await login(client(), 'boss@example.com', 'Str0ng-owner-pass')).status, 401);
    // a session that was opened while boss was the configured owner no longer works
    assert.equal((await owner('GET', '/api/owner/dashboard')).status, 401);
    restoreConfig();
  });
});

describe('bad configuration', () => {
  const rejects = async (email, password, pattern) => {
    setConfig(email, password);
    try {
      await assert.rejects(ensureOwner(), pattern);
    } finally {
      restoreConfig();
    }
  };

  test('a weak password or malformed email stops startup with a clear message', async () => {
    await rejects('boss@example.com', 'short', /OWNER_PASSWORD/);
    await rejects('not-an-email', 'Str0ng-owner-pass', /OWNER_EMAIL/);
    await rejects('boss@example.com', '', /OWNER_PASSWORD/);
    await rejects('', 'Str0ng-owner-pass', /OWNER_EMAIL/);
  });

  test('the owner email cannot be a tenant’s email', async () => {
    await rejects('tia@x.com', 'Str0ng-owner-pass', /belongs to a tenant/);
    assert.equal((await db.get("SELECT role FROM users WHERE email = 'tia@x.com'")).role, 'tenant');
  });

  test('with no owner configured at all, nobody can log in as an owner', async () => {
    delete process.env.OWNER_EMAIL;
    delete process.env.OWNER_PASSWORD;
    try {
      assert.equal((await ensureOwner()).status, 'unconfigured');
      assert.equal((await login(client(), 'boss@example.com', 'Brand-new-pass-9')).status, 401);
      assert.equal((await login(client(), 'legacy@x.com', 'Legacy-new-pass-1')).status, 401);
    } finally {
      restoreConfig();
    }
  });
});
