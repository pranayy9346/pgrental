// Shared test helpers. Import this file only after the test has set process.env.DB_PATH.
import assert from 'node:assert/strict';

// Registers an owner-added tenant the way a real tenant would: email + a password of their choice.
// `call` is a cookie-keeping test client, so afterwards it is logged in as the tenant.
export async function registerTenant(call, email, password = 'password123') {
  const done = await call('POST', '/api/auth/tenant/register', { email, password });
  assert.equal(done.status, 201, JSON.stringify(done.data));
  return done;
}

// ---- Owners ----
// The app has no owner sign-up: the owner comes from server configuration (OWNER_EMAIL / OWNER_PASSWORD).
// Tests create owners the same way the server does (ensureOwner). Several owners are used only to prove that
// data is isolated between owner rows; the server lets just the *currently configured* owner log in, so a client
// made with asOwner() points OWNER_EMAIL at its own owner before each request (tests run one request at a time).
export async function createOwner(email, name = 'Owner', password = 'password123') {
  const { ensureOwner } = await import('../src/lib/owner.js');
  Object.assign(process.env, { OWNER_EMAIL: email, OWNER_PASSWORD: password, OWNER_NAME: name });
  return ensureOwner();
}

export const asOwner = (call, email) => (...args) => {
  process.env.OWNER_EMAIL = email;
  return call(...args);
};

export async function signInOwner(call, email, name = 'Owner', password = 'password123') {
  await createOwner(email, name, password);
  const r = await call('POST', '/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r;
}
