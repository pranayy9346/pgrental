// Second preload for `npm run test:pg` (after isolate.js): run the whole suite on the real PostgreSQL engine
// that lives inside Node (PGlite). Set here, not through an env file, because an env file never overrides a variable
// that is already set in the developer's shell.
process.env.DB_DRIVER = 'pglite';
