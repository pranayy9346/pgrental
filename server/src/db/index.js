// Chooses the database driver once, at start-up.
//   DATABASE_URL set          -> PostgreSQL (production; hosted Neon, Supabase, ...)
//   nothing set               -> SQLite file (local development, as before)
//   DB_DRIVER=pglite          -> PostgreSQL engine inside Node, no server needed (tests / trying PostgreSQL locally)
// DB_DRIVER can force a choice explicitly: sqlite | postgres | pglite.
const driver = process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');

// SQLite keeps its data in a file on the server's disk. Most free hosts wipe that disk on every deploy or restart,
// which would silently lose all records, so a production server refuses to start on SQLite unless this is explicit.
if (driver === 'sqlite' && process.env.NODE_ENV === 'production' && process.env.ALLOW_SQLITE_IN_PRODUCTION !== 'true') {
  throw new Error(
    'Refusing to start in production on SQLite: its file would be lost whenever the host restarts or redeploys. ' +
      'Set DATABASE_URL to a PostgreSQL database (see DEPLOYMENT.md). Set ALLOW_SQLITE_IN_PRODUCTION=true only if ' +
      'the database file is on a persistent disk.',
  );
}

const drivers = {
  sqlite: () => import('./sqlite.js'),
  postgres: () => import('./postgres.js'),
  pglite: () => import('./pglite.js'),
};
if (!drivers[driver]) throw new Error(`Unknown DB_DRIVER "${driver}". Use sqlite, postgres or pglite.`);

const db = await (await drivers[driver]()).open();

export const dbPath = db.description;
export default db;
