# PG Rental Management System

Monorepo using npm workspaces:

- `client/` — React + Vite + Tailwind CSS (v4)
- `server/` — Node.js + Express + SQLite (better-sqlite3)

## Requirements

- Node.js 22 or newer (developed on Node.js 24, Windows)
- npm 10 or newer

## Setup

From the project root:

```sh
npm install
```

This installs dependencies for the root, `client` and `server` in one step.

Optional: copy the server environment file to change the defaults.

```sh
copy server\.env.example server\.env
```

| Variable  | Default             | Description                                  |
| --------- | ------------------- | -------------------------------------------- |
| `PORT`    | `3001`              | Backend port                                 |
| `DB_PATH` | `data/pg-rental.db` | SQLite file path, relative to `server/`      |

The SQLite database file is created automatically on first start.

## Try it with demo data

```sh
npm run seed
```

| Role   | Email            | Password      |
| ------ | ---------------- | ------------- |
| Owner  | owner@demo.com   | owner12345    |
| Tenant | rahul@demo.com   | tenant12345   |

Or click "Create an owner account" on the login page to start empty. Owners create tenant logins
(Tenants > Add tenant) and share the one-time temporary password; tenants must change it on first login.

## Test

```sh
npm test
```

## Run (development)

```sh
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- Health check: http://localhost:3001/api/health

The frontend dev server proxies `/api/*` to the backend, so the client can call `/api/...` directly.

Press `Ctrl+C` once in the terminal to stop both servers.

Run one side only:

```sh
npm run dev:server
npm run dev:client
```

## Build / production

```sh
npm run build   # builds the client into client/dist
npm start       # starts the backend and also serves client/dist on http://localhost:3001
```

## Notes

- `npm install` prints an `install-scripts` warning for `better-sqlite3`. This is expected: the package ships a
  prebuilt Windows binary, so its compile-from-source script does not need to run. Do not approve it unless you
  have the Visual C++ build tools installed and want to compile it yourself.
- On server start Node prints `.env not found. Continuing without it.` when `server/.env` does not exist.
  The defaults above are used in that case.
