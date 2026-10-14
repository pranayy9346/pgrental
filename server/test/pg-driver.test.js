// The production PostgreSQL path: the real `pg` driver (server/src/db/postgres.js), the command-line tools and a
// production-mode server start, all talking over the PostgreSQL network protocol.
// No PostgreSQL install is needed: PGlite (the real PostgreSQL engine) is served on a local port for the test.
// (The shim runs in its multiplexing mode; the pool is kept at 1 connection to keep the test simple.)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import Database from 'better-sqlite3';
import { migrate } from '../src/schema.js';

const serverDir = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-rental-driver-'));
const stops = [];
after(async () => {
  for (const stop of stops) await stop().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startPostgres() {
  const lite = await PGlite.create();
  const port = await freePort();
  const socket = new PGLiteSocketServer({ db: lite, port, host: '127.0.0.1', maxConnections: 10 });
  await socket.start();
  stops.push(async () => {
    await socket.stop();
    await lite.close();
  });
  return `postgresql://pguser:Sup3rS3cretPw@127.0.0.1:${port}/postgres`;
}

const childEnv = (url, extra = {}) => ({
  ...process.env,
  DB_DRIVER: '',
  DB_PATH: ':memory:',
  DATABASE_URL: url,
  DATABASE_SSL: 'disable',
  DATABASE_POOL_MAX: '1',
  ...extra,
});
// Asynchronous on purpose: the PostgreSQL server for these tests runs inside THIS process, and a blocking
// spawnSync would freeze it so the child could never connect.
const runScript = (script, args, env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${script}`, ...args], { cwd: serverDir, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });

describe('the pg driver', () => {
  test('connects, migrates, and behaves like the other drivers', async () => {
    const url = await startPostgres();
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SSL = 'disable';
    process.env.DATABASE_POOL_MAX = '1';
    const { open } = await import('../src/db/postgres.js');
    const db = await open();
    try {
      assert.equal(db.dialect, 'postgres');
      await db.ping();
      assert.deepEqual(await db.all('SELECT version FROM schema_migrations ORDER BY version'), [{ version: 1 }, { version: 2 }, { version: 3 }]);

      // statements, ids and number types
      const id = await db.insert("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'O', ?, 'h')", ['o@x.com']);
      assert.equal(id, 1);
      assert.equal((await db.run('UPDATE users SET name = @name WHERE id = @id', { name: 'New', id })).changes, 1);
      assert.equal((await db.get('SELECT name FROM users WHERE id = ?', [id])).name, 'New');
      assert.equal(await db.get('SELECT * FROM users WHERE id = ?', [999]), undefined);
      const agg = await db.get('SELECT COUNT(*) AS n, COALESCE(SUM(id), 0) AS total FROM users');
      assert.deepEqual([typeof agg.n, typeof agg.total], ['number', 'number']);

      // transactions: commit, then roll back on an error, and the connection keeps working afterwards
      await db.transaction(async (tx) => {
        await tx.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'A', 'a@x.com', 'h')");
      });
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'B', 'b@x.com', 'h')");
          throw new Error('stop');
        }),
        /stop/,
      );
      assert.deepEqual((await db.all('SELECT email FROM users ORDER BY id')).map((u) => u.email), ['o@x.com', 'a@x.com']);
      await assert.rejects(db.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'D', 'A@X.COM', 'h')"), (e) => e.code === '23505');
      assert.equal((await db.get('SELECT COUNT(*) AS n FROM users')).n, 2, 'still usable after an error inside and outside a transaction');

      // re-running migrations is harmless
      const { runPgMigrations } = await import('../src/db/pg-schema.js');
      assert.deepEqual(await runPgMigrations(db), []);
    } finally {
      await db.close();
    }
  });

  test('an unreachable database is reported once, quickly, and without leaking the password', async () => {
    const closed = `postgresql://pguser:Sup3rS3cretPw@127.0.0.1:${await freePort()}/postgres`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const { open } = await import('./src/db/postgres.js'); try { await open(); } catch (e) { console.log('FAILED: ' + e.message); }"], {
      cwd: serverDir,
      env: childEnv(closed, { DATABASE_CONNECT_TIMEOUT_MS: '3000' }),
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.match(r.stdout, /FAILED: .*ECONNREFUSED/);
    assert.ok(!(r.stdout + r.stderr).includes('Sup3rS3cretPw'));
  });
});

describe('the command-line tools, against a PostgreSQL server', () => {
  const sqliteFile = path.join(tmp, 'old.db');
  let url;

  test('setup: an old SQLite database and an empty PostgreSQL server', async () => {
    const lite = new Database(sqliteFile);
    lite.pragma('foreign_keys = ON');
    migrate(lite);
    const run = (sql, ...a) => lite.prepare(sql).run(...a);
    run("INSERT INTO users (id, role, name, email, password_hash, registered_at) VALUES (1, 'owner', 'Owner', 'boss@example.com', 'scrypt$aa$bb', '2026-01-01T00:00:00.000Z')");
    run("INSERT INTO users (id, role, name, email, password_hash, owner_id) VALUES (2, 'tenant', 'Invited', 'inv@x.com', '!', 1)");
    run("INSERT INTO properties (id, owner_id, name, address, city, total_floors) VALUES (1, 1, 'Real PG', 'a', 'c', 2)");
    run("INSERT INTO rooms (id, property_id, room_number, floor, capacity, monthly_rent) VALUES (1, 1, '101', 1, 2, 5000)");
    run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('t', 1, '2030-01-01T00:00:00.000Z')");
    lite.close();
    url = await startPostgres();
    process.env.DATABASE_URL = url; // the in-process checks below must look at this server, not the first test's
  });

  test('migrate: applies the schema and lists it', async () => {
    const r = await runScript('migrate.js', [], childEnv(url));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1\s+initial_schema/);
  });

  test('migrate:from-sqlite without --commit is a rehearsal: everything is verified, nothing is kept', async () => {
    const r = await runScript('migrate-sqlite-to-postgres.js', ['--sqlite', sqliteFile], childEnv(url));
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /users\s+2 ->\s+2\s+identical/);
    assert.match(r.stdout, /properties\s+1 ->\s+1\s+identical/);
    assert.match(r.stdout, /Dry run finished/);
    assert.ok(!r.stdout.includes('Sup3rS3cretPw') && !r.stderr.includes('Sup3rS3cretPw'), 'the password is not printed');
    const { open } = await import('../src/db/postgres.js');
    const db = await open();
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM users')).n, 0, 'nothing was written');
    await db.close();
  });

  test('migrate:from-sqlite --commit writes the data; a second commit is refused', async () => {
    const real = await runScript('migrate-sqlite-to-postgres.js', ['--sqlite', sqliteFile, '--commit'], childEnv(url));
    assert.equal(real.status, 0, real.stderr + real.stdout);
    assert.match(real.stdout, /COMMIT/);
    assert.match(real.stdout, /Done: the data is now in PostgreSQL/);
    assert.match(real.stdout, /1 login session\(s\) were not copied/);

    const again = await runScript('migrate-sqlite-to-postgres.js', ['--sqlite', sqliteFile, '--commit'], childEnv(url));
    assert.equal(again.status, 1);
    assert.match(again.stderr, /not empty/);
  });

  test('the SQLite file was only read', () => {
    const lite = new Database(sqliteFile, { readonly: true });
    assert.equal(lite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
    assert.equal(lite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    lite.close();
  });

  test('backup:postgres exports every table (and never the sessions) to a private file', async () => {
    const dir = path.join(tmp, 'backups');
    const r = await runScript('backup-postgres.js', [], childEnv(url, { BACKUP_DIR: dir }));
    assert.equal(r.status, 0, r.stderr);
    const file = fs.readdirSync(dir).find((f) => f.startsWith('pg-export-'));
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.equal(data.tables.users.length, 2);
    assert.equal(data.tables.properties[0].name, 'Real PG');
    assert.deepEqual(data.tables.sessions, []);
  });

  test('backup:sqlite makes a verified copy of an SQLite file', () => {
    const dir = path.join(tmp, 'sqlite-backups');
    const r = spawnSync(process.execPath, ['scripts/backup-sqlite.js'], {
      cwd: serverDir,
      env: { ...process.env, DB_PATH: sqliteFile, BACKUP_DIR: dir },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Integrity check: ok/);
    assert.match(r.stdout, /users\s+2 rows/);
    assert.equal(fs.readdirSync(dir).length, 1);
  });

  test('a production-mode server starts on the migrated PostgreSQL data and serves it', async () => {
    const port = await freePort();
    const origin = 'https://pg-rental.vercel.app';
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: serverDir,
      env: childEnv(url, {
        NODE_ENV: 'production',
        PORT: String(port),
        OWNER_EMAIL: 'boss@example.com',
        OWNER_PASSWORD: 'Str0ng-owner-pass',
        CLIENT_ORIGINS: origin,
        COOKIE_SAMESITE: 'none',
        TRUST_PROXY: '1',
      }),
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
      assert.match(out, /Owner account updated: boss@example\.com/, 'the migrated owner is adopted and given the configured password');
      assert.match(out, /Database: PostgreSQL \(DATABASE_URL\)/);
      assert.ok(!out.includes('Sup3rS3cretPw') && !out.includes('Str0ng-owner-pass'), 'no secret in the logs');
      assert.match(out, new RegExp(`listening on 0\\.0\\.0\\.0:${port}`));

      const get = (p, cookie) => fetch(`http://127.0.0.1:${port}${p}`, { headers: { Origin: origin, ...(cookie && { Cookie: cookie }) } });
      assert.deepEqual(await (await get('/api/health')).json(), { status: 'ok' });
      assert.equal((await (await get('/api/health/db')).json()).database.engine, 'postgres');

      const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ email: 'boss@example.com', password: 'Str0ng-owner-pass' }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.getSetCookie()[0];
      assert.ok(cookie.includes('SameSite=None') && cookie.includes('Secure') && cookie.includes('HttpOnly'));
      const pg = await (await get('/api/owner/pg', cookie.split(';')[0])).json();
      assert.equal(pg.pg.name, 'Real PG');
      assert.deepEqual(pg.rooms.map((r) => r.room_number), ['101']);

      // an invited tenant from the old database gets an invite code from the owner and registers on PostgreSQL
      const post = (p, body, cookie) =>
        fetch(`http://127.0.0.1:${port}${p}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie && { Cookie: cookie }) },
          body: JSON.stringify(body),
        });
      const { tenants } = await (await get('/api/owner/tenants', cookie.split(';')[0])).json();
      const invited = tenants.find((t) => t.email === 'inv@x.com');
      const invite = await post(`/api/owner/tenants/${invited.id}/invite`, {}, cookie.split(';')[0]);
      assert.equal(invite.status, 200);
      const { code } = (await invite.json()).invite;
      const reg = await post('/api/auth/tenant/register', { email: 'inv@x.com', invite_code: code, password: 'tenant-pass-1' });
      assert.equal(reg.status, 201);
    } finally {
      child.kill();
    }
  });
});
