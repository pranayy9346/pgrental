import { toPg } from './sql.js';

// Builds the application's query API on top of a function that runs one parameterised statement:
//   run(text, values) -> { rows, rowCount }
// Used by both the `pg` driver (production) and the PGlite driver (tests / local Postgres without a server).
export function makeQueries(run, execMany) {
  return {
    async all(sql, params) {
      const q = toPg(sql, params);
      return (await run(q.text, q.values)).rows;
    },
    async get(sql, params) {
      const q = toPg(sql, params);
      return (await run(q.text, q.values)).rows[0];
    },
    async run(sql, params) {
      const q = toPg(sql, params);
      return { changes: (await run(q.text, q.values)).rowCount ?? 0 };
    },
    async insert(sql, params) {
      const q = toPg(`${sql} RETURNING id`, params);
      return (await run(q.text, q.values)).rows[0].id;
    },
    // Several statements at once, no parameters (used for migrations).
    async exec(sql) {
      await execMany(sql);
    },
  };
}
