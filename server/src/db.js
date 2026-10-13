// The rest of the server imports the database from here. The actual driver (SQLite or PostgreSQL) is chosen in db/index.js.
export { default, dbPath } from './db/index.js';
