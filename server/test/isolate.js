// Preloaded into every test process (`node --import ./test/isolate.js --test ...`, see package.json).
//
// The tests must never depend on, or be able to reach, whatever database the developer's shell is configured for.
// The app picks PostgreSQL as soon as DATABASE_URL exists (src/db/index.js), and a test file that only sets
// DB_PATH=:memory: isolates SQLite and nothing else. So a shell that still had DATABASE_URL exported (for example
// after following a deployment step) used to send the whole test suite, with its throw-away users, to that database.
//
// This file runs before any test code, so it removes every setting that could change which database or which
// configuration the tests see. Tests that need a specific setting set it themselves.
const scrubbed = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'DATABASE_SSL',
  'DATABASE_POOL_MAX',
  'DATABASE_CONNECT_TIMEOUT_MS',
  'DB_DRIVER',
  'DB_AUTO_MIGRATE',
  'NEON_BRANCH',
  'ALLOW_SQLITE_IN_PRODUCTION',
  'NODE_ENV',
  'CLIENT_ORIGINS',
  'COOKIE_SAMESITE',
  'COOKIE_SECURE',
  'TRUST_PROXY',
  'OWNER_EMAIL',
  'OWNER_PASSWORD',
  'OWNER_NAME',
  'BACKUP_DIR',
];
for (const name of scrubbed) delete process.env[name];

// The engine is chosen only by the npm script: SQLite by default, or PGlite through test/use-pglite.js.

// SQLite always lives in memory, never in the real data/pg-rental.db file.
process.env.DB_PATH = ':memory:';
