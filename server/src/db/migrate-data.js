import crypto from 'node:crypto';
import { runPgMigrations } from './pg-schema.js';

// Copies the data of an existing SQLite database into an EMPTY PostgreSQL database.
//
// Safety rules (each one is covered by a test in server/test/sqlite-to-postgres.test.js):
//   * the SQLite source is only read (open it with { readonly: true });
//   * the target must be completely empty - nothing is merged, overwritten or truncated;
//   * everything happens in ONE target transaction: any error or any mismatch in the verification rolls it all back;
//   * after copying, every table's row count and a checksum of its content are compared with the source;
//   * login sessions are NOT copied (they are short-lived; everyone simply logs in again);
//   * with { commit: false } (the default in the command-line tool) it does the whole job and then rolls back,
//     which proves the data would load without changing the target.
//
// Order matters because of foreign keys: parents before children, and owners before the tenants that point at them.
export const COPY_ORDER = ['users', 'properties', 'rooms', 'tenancies', 'payments', 'complaints', 'notices', 'vacate_requests'];
const EXPECTED_SQLITE_VERSION = 4;

class DryRunRollback extends Error {}

const sortKeys = (row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : 1)));
const digest = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows.map(sortKeys))).digest('hex');

export async function migrateSqliteToPostgres({ source, target, commit = false, log = () => {} }) {
  const version = source.pragma('user_version', { simple: true });
  if (version !== EXPECTED_SQLITE_VERSION) {
    throw new Error(
      `The SQLite database is at schema version ${version}, but this tool expects version ${EXPECTED_SQLITE_VERSION}. ` +
        'Start the current app once against that database so it upgrades, then run this again.',
    );
  }
  const integrity = source.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`The SQLite database failed its integrity check (${integrity}). Nothing was copied.`);

  await runPgMigrations(target); // creates the tables if needed; never touches existing rows

  const summary = { committed: false, tables: {}, sessionsSkipped: source.prepare('SELECT COUNT(*) AS n FROM sessions').get().n };

  try {
    await target.transaction(async (tx) => {
      // 1. the target must be empty
      for (const table of COPY_ORDER) {
        const { n } = await tx.get(`SELECT COUNT(*) AS n FROM ${table}`);
        if (n > 0) {
          throw new Error(
            `The target database is not empty (table "${table}" already has ${n} rows). ` +
              'Refusing to merge or overwrite. Nothing was changed. Use a new, empty database.',
          );
        }
      }

      // 2. copy
      for (const table of COPY_ORDER) {
        let rows = source.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
        if (table === 'users') rows = [...rows.filter((r) => r.owner_id === null), ...rows.filter((r) => r.owner_id !== null)];
        for (const row of rows) {
          const columns = Object.keys(row);
          await tx.run(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            columns.map((c) => row[c]),
          );
        }
        // identity columns do not move when ids are inserted explicitly: point them past the highest copied id
        await tx.get(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1),
                         (SELECT MAX(id) IS NOT NULL FROM ${table}))`,
        );
        log(`copied ${rows.length} row(s) into ${table}`);
      }

      // 3. verify: same counts and same content, table by table
      for (const table of COPY_ORDER) {
        const sourceRows = source.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
        const targetRows = await tx.all(`SELECT * FROM ${table} ORDER BY id`);
        const same = sourceRows.length === targetRows.length && digest(sourceRows) === digest(targetRows);
        summary.tables[table] = { source: sourceRows.length, target: targetRows.length, identical: same };
        if (!same) {
          throw new Error(
            `Verification failed for "${table}" (source ${sourceRows.length} rows, target ${targetRows.length} rows, ` +
              'or the contents differ). Everything was rolled back.',
          );
        }
      }

      if (!commit) throw new DryRunRollback();
    });
    summary.committed = true;
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return summary;
}
