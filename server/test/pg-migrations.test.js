// PostgreSQL schema: parity with the SQLite schema, migration safety, and constraints that must hold natively.
// Uses its own throw-away PGlite (real PostgreSQL) instances, whichever driver the rest of the suite is using.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { open } from '../src/db/pglite.js';
import { migrations, runPgMigrations } from '../src/db/pg-schema.js';
import { migrate } from '../src/schema.js';

const freshPg = () => open();

describe('migration runner', () => {
  test('first start applies every migration in order and records them', async () => {
    const pg = await freshPg();
    const rows = await pg.all('SELECT version, name FROM schema_migrations ORDER BY version');
    assert.deepEqual(rows, [
      { version: 1, name: 'initial_schema' },
      { version: 2, name: 'notifications' },
    ]);
    await pg.close();
  });

  test('upgrading a version-1 database adds the notifications table without touching or copying any data', async () => {
    const later = migrations.splice(1); // build a database that only knows version 1, as production does today
    const pg = await freshPg();
    migrations.push(...later);
    await pg.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'O', 'o@x.com', 'h')");
    const ownerId = (await pg.get("SELECT id FROM users WHERE email = 'o@x.com'")).id;
    await pg.run("INSERT INTO properties (owner_id, name, address, city) VALUES (?, 'PG', 'A', 'C')", [ownerId]);
    const pid = (await pg.get('SELECT id FROM properties')).id;
    await pg.run("INSERT INTO notices (property_id, title, body) VALUES (?, 'Existing notice', 'body')", [pid]);
    assert.equal(await pg.get("SELECT 1 AS ok FROM information_schema.tables WHERE table_name = 'notifications'"), undefined);

    assert.deepEqual(await runPgMigrations(pg), [2]);

    assert.equal((await pg.get('SELECT COUNT(*) AS n FROM users')).n, 1, 'users kept');
    assert.equal((await pg.get('SELECT title FROM notices')).title, 'Existing notice', 'existing notice kept');
    assert.equal((await pg.get('SELECT COUNT(*) AS n FROM notifications')).n, 0, 'no notification is created for existing data');
    assert.deepEqual(await runPgMigrations(pg), [], 'running it again changes nothing');
    await pg.close();
  });

  test('running again changes nothing and keeps existing rows', async () => {
    const pg = await freshPg();
    await pg.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'O', 'o@x.com', 'h')");
    assert.deepEqual(await runPgMigrations(pg), []);
    assert.deepEqual(await runPgMigrations(pg), []);
    assert.equal((await pg.get('SELECT COUNT(*) AS n FROM users')).n, 1);
    await pg.close();
  });

  test('a failing migration is rolled back completely and not recorded', async () => {
    const pg = await freshPg();
    migrations.push({ version: 99, name: 'broken', sql: 'CREATE TABLE half_done (id INTEGER); SELECT * FROM table_that_does_not_exist;' });
    try {
      await assert.rejects(runPgMigrations(pg), /table_that_does_not_exist/);
    } finally {
      migrations.pop();
    }
    assert.equal(await pg.get("SELECT 1 AS ok FROM information_schema.tables WHERE table_name = 'half_done'"), undefined);
    assert.equal(await pg.get('SELECT 1 AS ok FROM schema_migrations WHERE version = 99'), undefined);
    assert.equal((await pg.get('SELECT COUNT(*) AS n FROM schema_migrations')).n, 2, 'versions 1 and 2 are still recorded');
    await pg.close();
  });

  test('a later migration is applied on top of existing data without losing it', async () => {
    const pg = await freshPg();
    await pg.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'O', 'o@x.com', 'h')");
    migrations.push({ version: 3, name: 'test_add_column', sql: 'ALTER TABLE users ADD COLUMN nickname TEXT' });
    try {
      assert.deepEqual(await runPgMigrations(pg), [3]);
    } finally {
      migrations.pop();
    }
    assert.equal((await pg.get("SELECT email, nickname FROM users")).email, 'o@x.com');
    await pg.close();
  });
});

describe('schema parity with SQLite', () => {
  test('same tables, same columns, same nullability, same named indexes, same trigger', async () => {
    const { default: Database } = await import('better-sqlite3');
    const lite = new Database(':memory:');
    migrate(lite);
    const pg = await freshPg();

    const sqliteTables = lite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((t) => t.name);
    const pgTables = (
      await pg.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != 'schema_migrations' ORDER BY table_name")
    ).map((t) => t.name);
    assert.deepEqual(pgTables, sqliteTables);

    for (const table of sqliteTables) {
      const a = Object.fromEntries(lite.pragma(`table_info(${table})`).map((c) => [c.name, c.notnull === 1 || c.pk === 1 ? 'NO' : 'YES']));
      const b = Object.fromEntries(
        (await pg.all("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?", [table])).map((c) => [c.column_name, c.is_nullable]),
      );
      assert.deepEqual(b, a, `columns of ${table}`);
    }

    const sqliteIdx = lite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' OR name LIKE 'uq_%'").all().map((i) => i.name);
    const pgIdx = (await pg.all("SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'")).map((i) => i.name).filter((n) => /^(idx_|uq_)/.test(n));
    // SQLite makes e-mail unique case-insensitively with a column rule; PostgreSQL needs an explicit index for that.
    assert.deepEqual(pgIdx.filter((n) => n !== 'uq_users_email').sort(), sqliteIdx.sort());
    assert.ok(pgIdx.includes('uq_users_email'));

    const triggers = await pg.all("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = 'public'");
    assert.deepEqual(triggers.map((t) => t.name), ['one_pg_per_owner']);
    lite.close();
    await pg.close();
  });
});

describe('constraints hold in PostgreSQL itself (not just in the API)', () => {
  let pg;
  const owner = () => pg.insert("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'O', ?, 'h')", [`o${Math.random()}@x.com`]);
  const code = async (promise) => {
    try {
      await promise;
      return null;
    } catch (err) {
      return err.code;
    }
  };

  test('setup', async () => {
    pg = await freshPg();
  });

  test('e-mail is unique ignoring letter case', async () => {
    await pg.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'A', 'dup@x.com', 'h')");
    assert.equal(await code(pg.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'B', 'DUP@x.com', 'h')")), '23505');
  });

  test('an owner has no owner_id and a tenant must have one', async () => {
    const id = await owner();
    assert.equal(await code(pg.run("INSERT INTO users (role, name, email, password_hash, owner_id) VALUES ('owner', 'X', 'x1@x.com', 'h', ?)", [id])), '23514');
    assert.equal(await code(pg.run("INSERT INTO users (role, name, email, password_hash) VALUES ('tenant', 'X', 'x2@x.com', 'h')")), '23514');
  });

  test('one PG per owner: the trigger refuses a second property with code PG001', async () => {
    const id = await owner();
    await pg.run("INSERT INTO properties (owner_id, name, address, city) VALUES (?, 'P1', 'a', 'c')", [id]);
    await assert.rejects(pg.run("INSERT INTO properties (owner_id, name, address, city) VALUES (?, 'P2', 'a', 'c')", [id]), (err) => {
      assert.equal(err.code, 'PG001');
      assert.match(err.message, /only one PG/);
      return true;
    });
  });

  test('rooms, stays, charges and requests keep their rules', async () => {
    const ownerId = await owner();
    const pgId = await pg.insert("INSERT INTO properties (owner_id, name, address, city, total_floors) VALUES (?, 'P', 'a', 'c', 2)", [ownerId]);
    const roomId = await pg.insert("INSERT INTO rooms (property_id, room_number, capacity, monthly_rent) VALUES (?, '1', 2, 5000)", [pgId]);
    assert.equal(await code(pg.run("INSERT INTO rooms (property_id, room_number, capacity, monthly_rent) VALUES (?, '1', 2, 5000)", [pgId])), '23505', 'duplicate room number');
    assert.equal(await code(pg.run("INSERT INTO rooms (property_id, room_number, capacity, monthly_rent) VALUES (?, '2', 21, 5000)", [pgId])), '23514', 'capacity above 20');

    const tenantId = await pg.insert("INSERT INTO users (role, name, email, password_hash, owner_id) VALUES ('tenant', 'T', 't@x.com', '!', ?)", [ownerId]);
    const stay = await pg.insert("INSERT INTO tenancies (tenant_id, room_id, start_date, monthly_rent) VALUES (?, ?, '2026-01-01', 5000)", [tenantId, roomId]);
    assert.equal(await code(pg.run("INSERT INTO tenancies (tenant_id, room_id, start_date, monthly_rent) VALUES (?, ?, '2026-02-01', 5000)", [tenantId, roomId])), '23505', 'second active stay');
    assert.equal(await code(pg.run("INSERT INTO tenancies (tenant_id, room_id, start_date, end_date, monthly_rent, status) VALUES (?, ?, '2026-03-01', '2026-02-01', 1, 'ended')", [tenantId, roomId])), '23514', 'end before start');

    await pg.run("INSERT INTO payments (tenancy_id, period, amount_due, due_date) VALUES (?, '2026-03', 5000, '2026-03-05')", [stay]);
    assert.equal(await code(pg.run("INSERT INTO payments (tenancy_id, period, amount_due, due_date) VALUES (?, '2026-03', 5000, '2026-03-05')", [stay])), '23505', 'two charges for one month');
    assert.equal(await code(pg.run("INSERT INTO payments (tenancy_id, period, amount_due, due_date) VALUES (?, '2026-13', 5000, '2026-03-05')", [stay])), '23514', 'month 13');

    await pg.run("INSERT INTO vacate_requests (tenancy_id, requested_date) VALUES (?, '2026-06-01')", [stay]);
    assert.equal(await code(pg.run("INSERT INTO vacate_requests (tenancy_id, requested_date) VALUES (?, '2026-07-01')", [stay])), '23505', 'two pending requests');
  });

  test('history cannot be deleted by accident (RESTRICT) while dependants are removed with their parent (CASCADE)', async () => {
    const ownerId = await owner();
    const pgId = await pg.insert("INSERT INTO properties (owner_id, name, address, city) VALUES (?, 'P', 'a', 'c')", [ownerId]);
    const roomId = await pg.insert("INSERT INTO rooms (property_id, room_number, capacity, monthly_rent) VALUES (?, '1', 1, 1)", [pgId]);
    const tenantId = await pg.insert("INSERT INTO users (role, name, email, password_hash, owner_id) VALUES ('tenant', 'T', 'cascade@x.com', '!', ?)", [ownerId]);
    const stay = await pg.insert("INSERT INTO tenancies (tenant_id, room_id, start_date, monthly_rent) VALUES (?, ?, '2026-01-01', 1)", [tenantId, roomId]);
    await pg.run("INSERT INTO payments (tenancy_id, period, amount_due, due_date) VALUES (?, '2026-01', 1, '2026-01-05')", [stay]);
    assert.equal(await code(pg.run('DELETE FROM rooms WHERE id = ?', [roomId])), '23001', 'room with a stay (RESTRICT)');
    assert.equal(await code(pg.run('DELETE FROM users WHERE id = ?', [tenantId])), '23001', 'tenant with a stay (RESTRICT)');
    await pg.run('DELETE FROM tenancies WHERE id = ?', [stay]);
    assert.equal((await pg.get('SELECT COUNT(*) AS n FROM payments WHERE tenancy_id = ?', [stay])).n, 0, 'charges removed with their stay');
  });

  test('counts and sums come back as plain numbers (not strings)', async () => {
    const r = await pg.get('SELECT COUNT(*) AS n, COALESCE(SUM(capacity), 0) AS beds FROM rooms');
    assert.equal(typeof r.n, 'number');
    assert.equal(typeof r.beds, 'number');
  });

  test('teardown', async () => {
    await pg.close();
  });
});
