import { makeQueries } from './pg-common.js';
import { runPgMigrations } from './pg-schema.js';

// PGlite is the real PostgreSQL engine compiled to WebAssembly and run inside Node. It needs no server, so the
// whole test suite can run against genuine PostgreSQL behaviour. Not meant for production use.
// PGLITE_DIR keeps the data in a folder; without it the database lives in memory.
export async function open() {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR;
  const lite = new PGlite(dir || undefined, {
    // same number handling as the `pg` driver: 64-bit integers and numerics as plain numbers
    parsers: { 20: (v) => Number(v), 1700: (v) => Number(v) },
  });
  await lite.waitReady;

  const make = (target) =>
    makeQueries(
      async (text, values) => {
        const r = await target.query(text, values);
        return { rows: r.rows, rowCount: r.affectedRows };
      },
      (sql) => target.exec(sql),
    );

  const db = {
    dialect: 'postgres',
    description: dir ? `PGlite (${dir})` : 'PGlite (in memory)',
    ...make(lite),
    transaction: (fn) => lite.transaction((tx) => fn(make(tx))),
    async ping() {
      await lite.query('SELECT 1');
    },
    async close() {
      await lite.close();
    },
    lite,
  };

  await runPgMigrations(db);
  return db;
}
