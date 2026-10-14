// Authentication hardening: rate limits, the proxy setting they depend on, password hash upgrades, session handling
// and security headers.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { asOwner, registerTenant, signInOwner } from './helpers.js';

process.env.DB_PATH = ':memory:';
// As configured on Render: one proxy in front of the app. Each client below sends its own X-Forwarded-For address.
process.env.TRUST_PROXY = '1';
const { default: app, trustProxySetting } = await import('../src/app.js');
const { default: db } = await import('../src/db.js');
const { ensureOwner } = await import('../src/lib/owner.js');
const { sessionCookieName } = await import('../src/lib/auth.js');

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

let nextIp = 1;
function client(ip = `192.0.2.${nextIp++}`) {
  const c = { cookie: '' };
  c.call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(c.cookie && { Cookie: c.cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) c.cookie = setCookie.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
  return c;
}
const call = (c) => c.call;
const login = (c, email, password) => c.call('POST', '/api/auth/login', { email, password });

const OWNER = 'owner@sec.com';
const owner = asOwner(call(client()), OWNER);

// Node's scrypt with its default cost, as every password hash was written before the cost was stored with it.
const legacyHash = (password) => {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
};

describe('setup', () => {
  test('an owner with a PG adds tenants who register', async () => {
    await signInOwner(owner, OWNER);
    await owner('PUT', '/api/owner/pg', { name: 'PG', address: '1 Road', city: 'Pune' });
    for (const n of ['ana', 'ben', 'cal', 'dev']) {
      assert.equal((await owner('POST', '/api/owner/tenants', { name: n, email: `${n}@sec.com` })).status, 201);
      await registerTenant(call(client()), `${n}@sec.com`, 'right-password');
    }
  });
});

describe('TRUST_PROXY', () => {
  test('a number of proxies is passed to Express as a number, not as an IP address list', () => {
    assert.equal(trustProxySetting('1'), 1);
    assert.equal(trustProxySetting(' 2 '), 2);
    assert.equal(trustProxySetting(undefined), false);
    assert.equal(trustProxySetting(''), false);
    assert.equal(trustProxySetting('false'), false);
    assert.equal(trustProxySetting('loopback'), 'loopback');
  });

  test('"true" is refused: it would let any visitor choose their own IP address', () => {
    assert.throws(() => trustProxySetting('true'), /fake their IP address/);
  });
});

describe('login rate limit', () => {
  test('10 wrong passwords for one account from one address, then even the right password waits', async () => {
    const attacker = client();
    for (let i = 0; i < 10; i++) assert.equal((await login(attacker, 'ana@sec.com', `wrong-${i}`)).status, 401);
    const blocked = await login(attacker, 'ana@sec.com', 'right-password');
    assert.equal(blocked.status, 429);
    assert.match(blocked.data.error, /Too many login attempts/);
  });

  test('the limit is per visitor address: the real tenant elsewhere still logs in (TRUST_PROXY=1 works)', async () => {
    assert.equal((await login(client(), 'ana@sec.com', 'right-password')).status, 200);
  });

  test('a burst of parallel guesses cannot slip past the limit', async () => {
    const attacker = client();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => login(attacker, 'ben@sec.com', `wrong-${i}`)));
    assert.equal(results.filter((r) => r.status === 401).length, 10);
    assert.equal(results.filter((r) => r.status === 429).length, 20);
  });

  test('a successful login resets the count for that account', async () => {
    const c = client();
    for (let i = 0; i < 9; i++) await login(c, 'cal@sec.com', `wrong-${i}`);
    assert.equal((await login(c, 'cal@sec.com', 'right-password')).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await login(c, 'cal@sec.com', `wrong-again-${i}`)).status, 401);
  });

  test('trying many different accounts from one address is limited too (password spraying)', async () => {
    const sprayer = client();
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => login(sprayer, `user${i}@sec.com`, 'Summer2026!')));
    assert.ok(results.every((r) => r.status === 401));
    assert.equal((await login(sprayer, 'dev@sec.com', 'Summer2026!')).status, 429);
    assert.equal((await login(client(), 'dev@sec.com', 'right-password')).status, 200, 'other addresses are unaffected');
  });

  test('a tenant who has not registered yet cannot log in, whatever is typed', async () => {
    await owner('POST', '/api/owner/tenants', { name: 'New', email: 'new@sec.com' });
    for (const password of ['!', '', 'x']) assert.notEqual((await login(client(), 'new@sec.com', password)).status, 200);
  });
});

describe('changing the password', () => {
  test('wrong current passwords are limited, so a stolen session cannot be used to guess it', async () => {
    const c = client();
    await login(c, 'cal@sec.com', 'right-password');
    for (let i = 0; i < 5; i++) {
      assert.equal((await c.call('POST', '/api/auth/change-password', { currentPassword: `wrong-${i}`, newPassword: 'new-password-1' })).status, 400);
    }
    const r = await c.call('POST', '/api/auth/change-password', { currentPassword: 'right-password', newPassword: 'new-password-1' });
    assert.equal(r.status, 429);
  });
});

describe('password hashes', () => {
  test('new hashes record their cost (scrypt N=2^16, r=8, p=1)', async () => {
    const { password_hash } = await db.get("SELECT password_hash FROM users WHERE email = 'ana@sec.com'");
    assert.match(password_hash, /^scrypt\$ln=16,r=8,p=1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  test('an older, cheaper hash still logs in and is upgraded on the spot', async () => {
    await db.run("UPDATE users SET password_hash = ? WHERE email = 'dev@sec.com'", [legacyHash('legacy-password')]);
    assert.equal((await login(client(), 'dev@sec.com', 'legacy-password')).status, 200);
    const { password_hash } = await db.get("SELECT password_hash FROM users WHERE email = 'dev@sec.com'");
    assert.match(password_hash, /^scrypt\$ln=16,/);
    assert.equal((await login(client(), 'dev@sec.com', 'legacy-password')).status, 200, 'and still works afterwards');
    assert.equal((await login(client(), 'dev@sec.com', 'other-password')).status, 401);
  });

  test('a tampered hash with an absurd cost is treated as unusable instead of exhausting memory', async () => {
    const salt = '00'.repeat(16);
    await db.run("UPDATE users SET password_hash = ? WHERE email = 'dev@sec.com'", [`scrypt$ln=30,r=8,p=1$${salt}$${'ab'.repeat(64)}`]);
    assert.equal((await login(client(), 'dev@sec.com', 'legacy-password')).status, 401);
  });

  test('the owner’s older hash is upgraded at start-up without logging anyone out', async () => {
    const session = client();
    await login(session, OWNER, 'password123');
    await db.run('UPDATE users SET password_hash = ? WHERE lower(email) = ?', [legacyHash('password123'), OWNER]);
    process.env.OWNER_EMAIL = OWNER;
    assert.equal((await ensureOwner()).status, 'unchanged');
    assert.match((await db.get('SELECT password_hash FROM users WHERE lower(email) = ?', [OWNER])).password_hash, /^scrypt\$ln=16,/);
    assert.equal((await asOwner(call(session), OWNER)('GET', '/api/auth/me')).status, 200);
  });
});

describe('sessions', () => {
  test('the cookie is HttpOnly and SameSite=Lax; with Secure it gets the __Host- prefix', async () => {
    const r = await login(client(), 'ana@sec.com', 'right-password');
    const cookie = r.headers.get('set-cookie');
    assert.ok(cookie.startsWith('pg_session='), cookie);
    for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(part), `${part}: ${cookie}`);
    assert.equal(sessionCookieName(true), '__Host-pg_session');
    assert.equal(sessionCookieName(false), 'pg_session');
  });

  test('logging in replaces a session the browser already had (no session fixation)', async () => {
    const c = client();
    await login(c, 'ana@sec.com', 'right-password');
    const planted = c.cookie;
    await login(c, 'ana@sec.com', 'right-password');
    assert.notEqual(c.cookie, planted);
    const old = await fetch(`${base}/api/auth/me`, { headers: { Cookie: planted } });
    assert.equal(old.status, 401, 'the earlier token no longer works');
    assert.equal((await c.call('GET', '/api/auth/me')).status, 200);
  });

  test('an expired session is refused', async () => {
    const c = client();
    await login(c, 'ana@sec.com', 'right-password');
    const token = decodeURIComponent(c.cookie.split('=')[1]);
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', ['2020-01-01T00:00:00.000Z', hash]);
    assert.equal((await c.call('GET', '/api/auth/me')).status, 401);
  });

  test('only a hash of the session token is stored', async () => {
    const c = client();
    await login(c, 'ana@sec.com', 'right-password');
    const token = decodeURIComponent(c.cookie.split('=')[1]);
    assert.equal(await db.get('SELECT 1 AS ok FROM sessions WHERE token_hash = ?', [token]), undefined);
  });

  test('changing the password logs out other devices but keeps this one', async () => {
    const [phone, laptop] = [client(), client()];
    await login(phone, 'ben@sec.com', 'right-password');
    await login(laptop, 'ben@sec.com', 'right-password');
    assert.equal((await laptop.call('POST', '/api/auth/change-password', { currentPassword: 'right-password', newPassword: 'brand-new-pass' })).status, 200);
    assert.equal((await phone.call('GET', '/api/auth/me')).status, 401);
    assert.equal((await laptop.call('GET', '/api/auth/me')).status, 200);
  });
});

describe('security headers', () => {
  test('every API answer is marked not cacheable and carries the protective headers', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
    const csp = res.headers.get('content-security-policy');
    for (const part of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"]) assert.ok(csp.includes(part), part);
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  test('HSTS is sent in production only (browsers ignore it over plain http anyway)', async () => {
    assert.equal((await fetch(`${base}/api/health`)).headers.get('strict-transport-security'), null);
    process.env.NODE_ENV = 'production';
    try {
      assert.match((await fetch(`${base}/api/health`)).headers.get('strict-transport-security'), /max-age=31536000/);
    } finally {
      delete process.env.NODE_ENV;
    }
  });
});
