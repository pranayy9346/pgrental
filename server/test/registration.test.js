// Tenant self-registration: the owner-added email plus the one-time invite code the owner received, and a password.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { asOwner, signInOwner } from './helpers.js';

process.env.DB_PATH = ':memory:';
// Each test client below poses as its own IP address (X-Forwarded-For from a trusted local proxy), so the per-IP
// registration limit only fires in the test that is about it.
process.env.TRUST_PROXY = 'loopback';
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

let nextIp = 1;
function client() {
  const ip = `10.0.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(cookie && { Cookie: cookie }) },
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
const register = (c, email, code, password = 'goodpassword1') => c('POST', '/api/auth/tenant/register', { email, invite_code: code, password });
const ids = {};
const codes = {};
const NOT_A_REAL_CODE = 'ABCD-EFGH-JK23';
const REFUSED = /do not match, or the code has expired/;

describe('setup', () => {
  test('an owner with a PG and room adds tenants and gets an invite code for each', async () => {
    await signInOwner(owner, 'owner@x.com');
    await signInOwner(otherOwner, 'other@x.com', 'Other');
    await owner('PUT', '/api/owner/pg', { name: 'PG', address: '1 Road', city: 'Pune', total_floors: 2 });
    ids.room = (await owner('POST', '/api/owner/pg/rooms', { room_number: '101', floor: 1, capacity: 20, monthly_rent: 5000 })).data.room.id;
    for (const n of ['dana', 'eve', 'finn', 'gus', 'hana', 'ivy', 'jo', 'kim', 'lee', 'mo', 'nia', 'oz', 'pat']) {
      const r = await owner('POST', '/api/owner/tenants', { name: n, email: `${n}@x.com`, room_id: ids.room, start_date: '2026-01-01' });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      ids[n] = r.data.tenant.id;
      codes[n] = r.data.invite.code;
    }
  });

  test('the code is 12 random letters and digits, valid for 7 days, and only its hash is stored', async () => {
    assert.match(codes.dana, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(new Set(Object.values(codes)).size, Object.keys(codes).length, 'every tenant gets a different code');
    const row = await db.get('SELECT invite_hash, invite_expires_at FROM users WHERE id = ?', [ids.dana]);
    assert.match(row.invite_hash, /^[0-9a-f]{64}$/);
    assert.ok(!row.invite_hash.includes(codes.dana.replace(/-/g, '')));
    const days = (new Date(row.invite_expires_at) - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7, `expires in ${days} days`);
  });

  test('the owner sees when a code expires, but never the code or its hash again', async () => {
    const t = (await owner('GET', `/api/owner/tenants/${ids.dana}`)).data.tenant;
    assert.ok(t.invite_expires_at);
    const all = JSON.stringify((await owner('GET', '/api/owner/tenants')).data);
    assert.ok(!all.includes('invite_hash') && !all.includes(codes.dana));
  });

  test('the old verification-code endpoints no longer exist', async () => {
    assert.equal((await anon('POST', '/api/auth/tenant/request-code', { email: 'dana@x.com' })).status, 404);
    const tableQuery = db.dialect === 'sqlite'
      ? "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'registration_codes'"
      : "SELECT table_name AS name FROM information_schema.tables WHERE table_name = 'registration_codes'";
    assert.equal(await db.get(tableQuery), undefined, 'table is gone');
  });
});

describe('an invited tenant registers with their email and invite code', () => {
  const dana = client();

  test('email + code + password creates the account', async () => {
    const r = await register(dana, 'dana@x.com', codes.dana, 'danaPassword1');
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

  test('the password is stored hashed, the account is marked registered and the code is used up', async () => {
    const row = await db.get('SELECT role, password_hash, registered_at, invite_hash, invite_expires_at FROM users WHERE email = ?', ['dana@x.com']);
    assert.equal(row.role, 'tenant');
    assert.ok(row.password_hash.startsWith('scrypt$') && !row.password_hash.includes('danaPassword1'));
    assert.ok(row.registered_at);
    assert.equal(row.invite_hash, null);
    assert.equal(row.invite_expires_at, null);
  });

  test('the same code cannot be used a second time', async () => {
    const r = await register(client(), 'dana@x.com', codes.dana, 'attackerPass1');
    assert.equal(r.status, 400);
    assert.match(r.data.error, REFUSED);
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

describe('email and code matching', () => {
  test('letter case and surrounding spaces in the email do not matter', async () => {
    const r = await register(client(), '  EVE@X.Com  ', codes.eve);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.user.email, 'eve@x.com');
  });

  test('the code may be typed in lower case, without dashes, with spaces, and with O for 0 or I/L for 1', async () => {
    const typed = codes.pat.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    const r = await register(client(), 'pat@x.com', typed);
    assert.equal(r.status, 201, JSON.stringify(r.data));
  });

  test('the exact email is required: similar addresses do not match', async () => {
    for (const email of ['finn@x.co', 'finn+1@x.com', 'inn@x.com', 'finn@y.com', 'finn.@x.com']) {
      assert.equal((await register(client(), email, codes.finn)).status, 400, email);
    }
    assert.equal((await db.get('SELECT registered_at FROM users WHERE email = ?', ['finn@x.com'])).registered_at, null);
  });

  test('a malformed or missing email is a validation error', async () => {
    for (const email of ['nope', 'a b@x.com', '', undefined, 42, null]) {
      const r = await register(client(), email, codes.finn);
      assert.equal(r.status, 400, String(email));
      assert.ok(r.data.details.email, `message for ${email}`);
    }
  });

  test('a missing or malformed code is a validation error', async () => {
    for (const code of [undefined, '', '   ', 'ABCD-EFGH', 'ABCD-EFGH-JK23X', 'ABCD-EFGH-JK2U', 42]) {
      const r = await register(client(), 'finn@x.com', code);
      assert.equal(r.status, 400, String(code));
      assert.ok(r.data.details.invite_code, `message for ${code}`);
    }
  });
});

describe('who is refused', () => {
  test('knowing a tenant’s email is not enough: a wrong code is refused and the invitation stays usable', async () => {
    const r = await register(client(), 'mo@x.com', NOT_A_REAL_CODE, 'attackerPass1');
    assert.equal(r.status, 400);
    assert.match(r.data.error, REFUSED);
    assert.ok(r.data.details.invite_code);
    assert.equal((await db.get('SELECT registered_at FROM users WHERE id = ?', [ids.mo])).registered_at, null);
    assert.equal((await register(client(), 'mo@x.com', codes.mo)).status, 201, 'the real tenant can still register');
  });

  test('a code belongs to one tenant: another tenant’s code does not work', async () => {
    assert.equal((await register(client(), 'nia@x.com', codes.oz)).status, 400);
    assert.equal((await register(client(), 'oz@x.com', codes.nia)).status, 400);
  });

  test('an expired code is refused; a new code from the owner replaces it', async () => {
    await db.run('UPDATE users SET invite_expires_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', ids.nia]);
    assert.equal((await register(client(), 'nia@x.com', codes.nia)).status, 400, 'expired');

    const fresh = await owner('POST', `/api/owner/tenants/${ids.nia}/invite`);
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.data.invite.code, codes.nia);
    assert.ok(fresh.data.tenant.invite_expires_at > new Date().toISOString());

    await db.run('UPDATE users SET invite_expires_at = ? WHERE id = ?', [fresh.data.tenant.invite_expires_at, ids.nia]);
    assert.equal((await register(client(), 'nia@x.com', codes.nia)).status, 400, 'the old code stays dead');
    assert.equal((await register(client(), 'nia@x.com', fresh.data.invite.code)).status, 201);
  });

  test('an email the owner never added is refused and no account is created', async () => {
    const r = await register(client(), 'stranger@x.com', codes.oz);
    assert.equal(r.status, 400);
    assert.equal(await db.get("SELECT 1 FROM users WHERE email = 'stranger@x.com'"), undefined);
  });

  test('registering the same email twice is refused and the first password stays in force', async () => {
    assert.equal((await register(client(), 'finn@x.com', codes.finn, 'finnPassword1')).status, 201);
    const second = await register(client(), 'finn@x.com', codes.finn, 'attackerPass1');
    assert.equal(second.status, 400);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'finn@x.com', password: 'attackerPass1' })).status, 401);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'finn@x.com', password: 'finnPassword1' })).status, 200);
  });

  test('every refusal gets the same answer, so the form does not reveal which emails were added', async () => {
    const answers = await Promise.all([
      register(client(), 'nobody@x.com', NOT_A_REAL_CODE), // never added
      register(client(), 'oz@x.com', NOT_A_REAL_CODE), // added, wrong code
      register(client(), 'finn@x.com', NOT_A_REAL_CODE), // already registered
      register(client(), 'owner@x.com', NOT_A_REAL_CODE), // the owner
    ]);
    for (const a of answers) assert.deepEqual(a, answers[0]);
    assert.equal(answers[0].status, 400);
  });

  test('an owner’s email cannot be used to register (and no owner can be created this way)', async () => {
    const r = await register(client(), 'owner@x.com', codes.oz, 'ownerHijack1');
    assert.equal(r.status, 400);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'")).n, 2);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'owner@x.com', password: 'ownerHijack1' })).status, 401);
  });

  test('extra fields such as a role are ignored: the account is still a tenant', async () => {
    const t = client();
    const r = await t('POST', '/api/auth/tenant/register', { email: 'gus@x.com', invite_code: codes.gus, password: 'gusPassword1', role: 'owner', owner_id: null });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'tenant');
    assert.equal((await t('GET', '/api/owner/dashboard')).status, 403);
  });
});

describe('passwords', () => {
  test('a password shorter than 8 characters is refused and the invitation stays usable', async () => {
    for (const password of ['short', '1234567', '']) {
      const r = await register(client(), 'hana@x.com', codes.hana, password);
      assert.equal(r.status, 400, `"${password}"`);
      assert.ok(r.data.details.password);
    }
    assert.equal((await client()('POST', '/api/auth/tenant/register', { email: 'hana@x.com', invite_code: codes.hana })).status, 400, 'no password at all');
    assert.equal((await db.get('SELECT registered_at FROM users WHERE email = ?', ['hana@x.com'])).registered_at, null);
    assert.equal((await register(client(), 'hana@x.com', codes.hana, '12345678')).status, 201, 'exactly 8 characters is fine');
  });

  test('an over-long password is refused', async () => {
    assert.equal((await register(client(), 'ivy@x.com', codes.ivy, 'x'.repeat(129))).status, 400);
  });

  test('the same password may be used by different tenants, each stored with its own salt', async () => {
    assert.equal((await register(client(), 'ivy@x.com', codes.ivy, 'sharedPassword1')).status, 201);
    assert.equal((await register(client(), 'jo@x.com', codes.jo, 'sharedPassword1')).status, 201);
    const hashes = (await db.all("SELECT password_hash FROM users WHERE email IN ('ivy@x.com','jo@x.com')")).map((r) => r.password_hash);
    assert.notEqual(hashes[0], hashes[1]);
  });

  test('a password with spaces at either end works exactly as typed', async () => {
    const t = client();
    const added = await owner('POST', '/api/owner/tenants', { name: 'Space', email: 'space@x.com' });
    assert.equal((await register(t, 'space@x.com', added.data.invite.code, '  spaced pass  ')).status, 201);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'space@x.com', password: '  spaced pass  ' })).status, 200);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'space@x.com', password: 'spaced pass' })).status, 401);
    const c = await t('POST', '/api/auth/change-password', { currentPassword: '  spaced pass  ', newPassword: 'no-spaces-now' });
    assert.equal(c.status, 200, JSON.stringify(c.data));
  });
});

describe('concurrent requests', () => {
  test('two simultaneous registrations for one email: exactly one wins, the other is refused', async () => {
    const [a, b] = [client(), client()];
    const results = await Promise.all([register(a, 'kim@x.com', codes.kim, 'firstPassword1'), register(b, 'kim@x.com', codes.kim, 'secondPassword1')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM users WHERE email = 'kim@x.com'")).n, 1, 'no duplicate account');

    // only the winner's password works, and the refused request got no session
    const firstWon = results[0].status === 201;
    const [winner, loser] = firstWon ? ['firstPassword1', 'secondPassword1'] : ['secondPassword1', 'firstPassword1'];
    assert.equal((await anon('POST', '/api/auth/login', { email: 'kim@x.com', password: winner })).status, 200);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'kim@x.com', password: loser })).status, 401);
    assert.equal(((await (firstWon ? b : a)('GET', '/api/auth/me'))).status, 401);
  });

  test('many simultaneous registrations still create one account', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => register(client(), 'lee@x.com', codes.lee, `racePassword${i}`)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 400).length, 7);
  });
});

describe('owner controls', () => {
  test('another owner or a tenant cannot reset someone’s access or issue them a code', async () => {
    assert.equal((await otherOwner('POST', `/api/owner/tenants/${ids.dana}/reset-access`)).status, 404);
    assert.equal((await otherOwner('POST', `/api/owner/tenants/${ids.oz}/invite`)).status, 404);
    const tenant = client();
    assert.equal((await tenant('POST', '/api/auth/login', { email: 'hana@x.com', password: '12345678' })).status, 200);
    assert.equal((await tenant('POST', `/api/owner/tenants/${ids.dana}/reset-access`)).status, 403);
    assert.equal((await tenant('POST', `/api/owner/tenants/${ids.oz}/invite`)).status, 403);
  });

  test('a new code is only for tenants who have not registered yet', async () => {
    const r = await owner('POST', `/api/owner/tenants/${ids.dana}/invite`);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /Reset access/);
  });

  test('the email of a registered tenant cannot be changed; an unregistered one can be corrected', async () => {
    assert.equal((await owner('PATCH', `/api/owner/tenants/${ids.dana}`, { email: 'new@x.com' })).status, 409);
    const added = await owner('POST', '/api/owner/tenants', { name: 'Typo', email: 'typo@x.com' });
    assert.equal((await owner('PATCH', `/api/owner/tenants/${added.data.tenant.id}`, { email: 'fixed@x.com' })).status, 200);
    assert.equal((await register(client(), 'typo@x.com', added.data.invite.code)).status, 400, 'the mistyped address no longer works');
    assert.equal((await register(client(), 'fixed@x.com', added.data.invite.code)).status, 201, 'the code stays with the tenant');
  });

  test('resetting access logs the tenant out everywhere and they register again with a new code and password', async () => {
    const t = client();
    const added = await owner('POST', '/api/owner/tenants', { name: 'Reset Me', email: 'reset@x.com', room_id: ids.room, start_date: '2026-01-01' });
    assert.equal((await register(t, 'reset@x.com', added.data.invite.code, 'oldPassword1')).status, 201);
    assert.equal((await t('GET', '/api/tenant/dashboard')).status, 200);

    const r = await owner('POST', `/api/owner/tenants/${added.data.tenant.id}/reset-access`);
    assert.equal(r.status, 200);
    assert.equal(r.data.tenant.registered_at, null);
    assert.ok(r.data.invite.code);
    assert.equal((await t('GET', '/api/auth/me')).status, 401, 'existing session ended');
    assert.equal((await anon('POST', '/api/auth/login', { email: 'reset@x.com', password: 'oldPassword1' })).status, 401, 'old password is dead');

    const again = client();
    assert.equal((await register(again, 'reset@x.com', added.data.invite.code, 'newPassword1')).status, 400, 'the first code is used up');
    assert.equal((await register(again, 'reset@x.com', r.data.invite.code, 'newPassword1')).status, 201);
    assert.equal((await again('GET', '/api/tenant/dashboard')).data.stay.room_number, '101', 'still in their room');
  });
});

describe('abuse protection', () => {
  test('repeated wrong attempts are rate limited per IP; other addresses are not affected', async () => {
    const attacker = client();
    let last;
    for (let i = 0; i < 25; i++) last = await register(attacker, 'oz@x.com', NOT_A_REAL_CODE);
    assert.equal(last.status, 429);
    assert.equal((await register(attacker, 'oz@x.com', codes.oz)).status, 429, 'even the right code, from that address');
    assert.equal((await register(client(), 'oz@x.com', codes.oz)).status, 201, 'the real tenant elsewhere is fine');
  });

  test('a burst of parallel guesses cannot slip past the limit', async () => {
    const attacker = client();
    const results = await Promise.all(Array.from({ length: 40 }, () => register(attacker, 'nobody@x.com', NOT_A_REAL_CODE)));
    assert.equal(results.filter((r) => r.status === 400).length, 20);
    assert.equal(results.filter((r) => r.status === 429).length, 20);
  });
});
