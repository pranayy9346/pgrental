// CORS and cross-origin (CSRF) behaviour for the Vite dev origin and for unknown origins.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

process.env.DB_PATH = ':memory:';
delete process.env.CLIENT_ORIGINS;
delete process.env.NODE_ENV;
const { default: app } = await import('../src/app.js');

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const DEV = 'http://localhost:5173';
const login = (origin, extra = {}) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }), ...extra },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'wrongpass1' }),
  });

describe('CORS', () => {
  test('preflight from the Vite dev origin is approved with credentials', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: DEV,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), DEV);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.match(res.headers.get('access-control-allow-methods'), /PATCH/);
    assert.match(res.headers.get('access-control-allow-headers'), /content-type/i);
  });

  test('a real request from the dev origin reaches the route (401, not 403)', async () => {
    const res = await login(DEV);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('access-control-allow-origin'), DEV);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  });

  test('other origins get no CORS headers and cannot change data', async () => {
    const pre = await fetch(`${base}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
    const res = await login('https://evil.example');
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('origin is never "*"', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { Origin: DEV } });
    assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
  });

  test('same-origin requests (production build, no Origin header) still work', async () => {
    assert.equal((await login(null)).status, 401);
    assert.equal((await login(base)).status, 401);
  });
});
