import pg from 'pg';
import { makeQueries } from './pg-common.js';
import { runPgMigrations } from './pg-schema.js';

// PostgreSQL driver for production. `node-postgres` (pg) is the right driver for this app: it is a long-running Node
// server that keeps one connection pool for its whole life (Neon's own guidance for that kind of runtime).
//
// Two connection strings can be configured (Neon provides both):
//   DATABASE_URL            pooled (host contains "-pooler"): used for the application's normal traffic.
//   DATABASE_URL_UNPOOLED   direct: used for schema migrations, data copies and exports, which should not go through
//                           a pooler. Optional: when it is missing, DATABASE_URL is used for everything (this works,
//                           because the migrations only use transaction-level features).
//
// COUNT()/SUM() come back from PostgreSQL as 64-bit / numeric values, which node-postgres returns as strings;
// the application expects plain numbers (all values are small).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

// The connection string for one-off tools (migrate, copy, export): the direct one when there is one.
export const directDatabaseUrl = () => process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

// `sslmode=require` (what Neon and most providers hand out) is, in node-postgres today, an alias for the strict
// `verify-full` (encrypted AND the certificate and host name are checked). The library has announced that these aliases
// will change to the weaker libpq meaning in its next major version. Saying `verify-full` explicitly keeps the strict
// behaviour for ever and silences the warning. A string that already says something else is left untouched.
export function normalizeSslMode(url) {
  if (/[?&]uselibpqcompat=/.test(url)) return url;
  return url.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, '$1verify-full');
}

// Safety net for the test suite: when the code runs under `node --test`, the only PostgreSQL it may open is one on
// this computer (the tests start their own disposable server). A remote address there means a leftover shell
// variable or a mistake, and the tests create and delete data, so refuse instead of connecting. An address that
// cannot be read is refused too.
export function refuseRemoteDatabaseInTests(connectionString, env = process.env) {
  if (!env.NODE_TEST_CONTEXT) return;
  let host = '';
  try {
    host = new URL(connectionString).hostname;
  } catch {
    /* unreadable: treated as not local */
  }
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new Error('Refusing to connect: the test runner may only use a PostgreSQL server on this computer, never a remote database.');
  }
}

function makePool(connectionString, max) {
  refuseRemoteDatabaseInTests(connectionString);
  const pool = new pg.Pool({
    connectionString: normalizeSslMode(connectionString),
    // Free tiers allow few connections; one small web service rarely needs more than a handful.
    max,
    idleTimeoutMillis: 30_000,
    // A sleeping free database (e.g. Neon after 5 idle minutes) can take a moment to wake up.
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 20_000,
    // TLS is requested through the connection string (`?sslmode=require`). DATABASE_SSL=disable is only for a
    // local PostgreSQL server without TLS.
    ...(process.env.DATABASE_SSL === 'disable' && { ssl: false }),
  });
  // An idle connection can be dropped by the provider; without this handler that would crash the process.
  pool.on('error', (err) => console.error('PostgreSQL pool error (connection will be replaced):', err.message));
  return pool;
}

// The application's query API on top of a pool.
function adapt(pool) {
  const queries = makeQueries(
    (text, values) => pool.query(text, values),
    (sql) => pool.query(sql),
  );

  async function transaction(fn) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const tx = makeQueries(
        (text, values) => client.query(text, values),
        (sql) => client.query(sql),
      );
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // the connection itself failed: throw it away instead of reusing it
      }
      throw err;
    } finally {
      client.release(broken || undefined);
    }
  }

  return {
    ...queries,
    transaction,
    async ping() {
      await pool.query('SELECT 1');
    },
    async close() {
      await pool.end();
    },
  };
}

// `connectionString` lets a tool choose which address to use; the server uses DATABASE_URL.
export async function open({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const pool = makePool(connectionString, Number(process.env.DATABASE_POOL_MAX) || 5);
  const db = {
    dialect: 'postgres',
    description: 'PostgreSQL (DATABASE_URL)',
    ...adapt(pool),
  };

  await db.ping(); // fail fast with a clear message if the database cannot be reached

  if (process.env.DB_AUTO_MIGRATE !== 'false') {
    // Migrate over the direct connection when one is configured and the app itself runs on the pooled one.
    const direct = process.env.DATABASE_URL_UNPOOLED;
    const separate = direct && direct !== connectionString;
    const migrator = separate ? makePool(direct, 1) : null;
    try {
      const applied = await runPgMigrations(migrator ? adapt(migrator) : db);
      if (applied.length) console.log(`Database migrations applied: ${applied.join(', ')}${separate ? ' (over the direct connection)' : ''}`);
    } finally {
      if (migrator) await migrator.end();
    }
  }
  return db;
}
