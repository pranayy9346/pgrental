// Settings that matter when the frontend (Vercel) and the API (Render) live on different sites.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const FRONTEND = 'https://pg-rental.vercel.app';
process.env.DB_PATH = ':memory:';
process.env.CLIENT_ORIGINS = FRONTEND;
process.env.COOKIE_SAMESITE = 'none';
const { default: app } = await import('../src/app.js');
const { cookieSettings } = await import('../src/lib/auth.js');
const { createOwner } = await import('./helpers.js');

const serverDir = path.resolve(import.meta.dirname, '..');
let server;
let base;
before(async () => {
  await createOwner('boss@example.com', 'Boss', 'Str0ng-owner-pass');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const call = (method, p, { origin, body, cookie } = {}) =>
  fetch(base + p, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(origin && { Origin: origin }), ...(cookie && { Cookie: cookie }) },
    body: body && JSON.stringify(body),
  });
const owner = { email: 'boss@example.com', password: 'Str0ng-owner-pass' };

describe('cross-site cookies (SameSite=None)', () => {
  test('login from the allowed frontend sets an HttpOnly, Secure, SameSite=None cookie', async () => {
    const res = await call('POST', '/api/auth/login', { origin: FRONTEND, body: owner });
    assert.equal(res.status, 200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('pg_session='));
    assert.ok(cookie, 'a session cookie is set');
    for (const part of ['HttpOnly', 'Secure', 'SameSite=None', 'Path=/']) assert.ok(cookie.includes(part), `cookie has ${part}: ${cookie}`);
    assert.ok(/Expires=/i.test(cookie), 'cookie has an expiry');
    assert.equal(res.headers.get('access-control-allow-origin'), FRONTEND);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  });

  test('the session cookie really authenticates later requests from that origin', async () => {
    const login = await call('POST', '/api/auth/login', { origin: FRONTEND, body: owner });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const me = await call('GET', '/api/auth/me', { origin: FRONTEND, cookie });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.role, 'owner');
  });

  test('writes without an Origin header, or from another site, are refused', async () => {
    assert.equal((await call('POST', '/api/auth/login', { body: owner })).status, 403);
    assert.equal((await call('POST', '/api/auth/login', { origin: 'https://evil.example', body: owner })).status, 403);
    assert.equal((await call('POST', '/api/auth/login', { origin: `${FRONTEND}.evil.example`, body: owner })).status, 403);
    assert.equal((await call('POST', '/api/auth/login', { origin: 'http://pg-rental.vercel.app', body: owner })).status, 403, 'http is not https');
  });

  test('reading without an Origin header still works (health checks, curl)', async () => {
    const live = await call('GET', '/api/health');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' }, 'the liveness check does not involve the database');
    const res = await call('GET', '/api/health/db');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.database.connected, true);
    assert.deepEqual(Object.keys(body.database).sort(), ['connected', 'engine'], 'no internal details are exposed');
  });

  test('preflight: approved for the frontend, ignored for others', async () => {
    const ok = await fetch(`${base}/api/owner/pg`, {
      method: 'OPTIONS',
      headers: { Origin: FRONTEND, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), FRONTEND);
    assert.match(ok.headers.get('access-control-allow-methods'), /PUT|PATCH|POST/);
    const no = await fetch(`${base}/api/owner/pg`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' } });
    assert.equal(no.headers.get('access-control-allow-origin'), null);
  });

  test('logout clears the cookie with the same attributes (otherwise browsers keep it)', async () => {
    const res = await call('POST', '/api/auth/logout', { origin: FRONTEND });
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith('pg_session='));
    assert.ok(cleared.startsWith('pg_session=;'), cleared);
    for (const part of ['SameSite=None', 'Secure', 'HttpOnly']) assert.ok(cleared.includes(part), `${part}: ${cleared}`);
    assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
  });
});

describe('cookie settings from the environment', () => {
  const withEnv = (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.entries(vars).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
    try {
      return fn();
    } finally {
      Object.entries(saved).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
    }
  };

  test('defaults: Lax; Secure only in production', () => {
    assert.deepEqual(withEnv({ COOKIE_SAMESITE: undefined, COOKIE_SECURE: undefined, NODE_ENV: undefined }, cookieSettings), { sameSite: 'lax', secure: false });
    assert.deepEqual(withEnv({ COOKIE_SAMESITE: undefined, COOKIE_SECURE: undefined, NODE_ENV: 'production' }, cookieSettings), { sameSite: 'lax', secure: true });
  });
  test('None always forces Secure, because browsers reject SameSite=None without it', () => {
    assert.deepEqual(withEnv({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false', NODE_ENV: undefined }, cookieSettings), { sameSite: 'none', secure: true });
  });
  test('COOKIE_SECURE can switch Secure off for a plain-http local test', () => {
    assert.equal(withEnv({ COOKIE_SAMESITE: 'lax', COOKIE_SECURE: 'false', NODE_ENV: 'production' }, cookieSettings).secure, false);
  });
  test('an invalid value stops the server instead of weakening the cookie', () => {
    assert.throws(() => withEnv({ COOKIE_SAMESITE: 'whatever' }, cookieSettings), /COOKIE_SAMESITE must be lax, strict or none/);
  });
});

describe('starting the real server the way a host does', () => {
  const run = (env) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/db/index.js'); console.log('db-ready')"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: '', DB_DRIVER: '', DB_PATH: ':memory:', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });

  test('production refuses to run on SQLite (its file would vanish on the next restart)', () => {
    const r = run({ NODE_ENV: 'production' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Refusing to start in production on SQLite/);
    assert.match(r.stderr, /DATABASE_URL/);
  });
  test('...unless that is explicitly allowed (e.g. a persistent disk)', () => {
    const r = run({ NODE_ENV: 'production', ALLOW_SQLITE_IN_PRODUCTION: 'true' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /db-ready/);
  });
  test('an unknown DB_DRIVER is rejected', () => {
    const r = run({ DB_DRIVER: 'mysql' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unknown DB_DRIVER/);
  });

  test('an unreachable PostgreSQL gives one clear message and never prints the connection string or password', async () => {
    const child = spawnSync(process.execPath, ['src/index.js'], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DB_DRIVER: '',
        DATABASE_URL: 'postgres://pguser:Sup3rS3cretPw@127.0.0.1:1/pgdb',
        DATABASE_CONNECT_TIMEOUT_MS: '2000',
        OWNER_EMAIL: 'boss@example.com',
        OWNER_PASSWORD: 'Str0ng-owner-pass',
        PORT: '0',
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Cannot start/);
    const output = child.stdout + child.stderr;
    assert.ok(!output.includes('Sup3rS3cretPw'), 'the database password is not printed');
    assert.ok(!output.includes('Str0ng-owner-pass'), 'the owner password is not printed');
  });

  test('server on PORT, listening on 0.0.0.0, production cookies, health check, no demo data', async () => {
    const port = await new Promise((resolve) => {
      const s = net.createServer().listen(0, () => {
        const { port: p } = s.address();
        s.close(() => resolve(p));
      });
    });
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DB_DRIVER: 'pglite', // PostgreSQL engine without a server
        PORT: String(port),
        OWNER_EMAIL: 'boss@example.com',
        OWNER_PASSWORD: 'Str0ng-owner-pass',
        CLIENT_ORIGINS: FRONTEND,
        COOKIE_SAMESITE: 'none',
        TRUST_PROXY: '1',
      },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    try {
      const deadline = Date.now() + 90_000;
      while (!out.includes('Cookies:') && Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`server exited early:\n${out}`);
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.match(out, new RegExp(`Server listening on 0\\.0\\.0\\.0:${port} \\(NODE_ENV=production\\)`));
      assert.match(out, /Cookies: SameSite=none, Secure=true/);
      assert.ok(!out.includes('Str0ng-owner-pass'), 'no secret in the logs');

      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).status, 'ok');

      const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: FRONTEND },
        body: JSON.stringify(owner),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.getSetCookie()[0];
      assert.ok(cookie.includes('Secure') && cookie.includes('SameSite=None') && cookie.includes('HttpOnly'));

      // nothing is seeded automatically: only the configured owner exists
      const session = cookie.split(';')[0];
      const tenants = await fetch(`http://127.0.0.1:${port}/api/owner/tenants`, { headers: { Cookie: session, Origin: FRONTEND } });
      assert.deepEqual((await tenants.json()).tenants, []);
      const pg = await fetch(`http://127.0.0.1:${port}/api/owner/pg`, { headers: { Cookie: session, Origin: FRONTEND } });
      assert.equal((await pg.json()).pg, null);
    } finally {
      child.kill();
    }
  });
});
