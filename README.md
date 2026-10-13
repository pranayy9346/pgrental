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

Create the server settings file and set the owner account (required):

```sh
copy server\.env.example server\.env
```

Then edit `server/.env` and fill in `OWNER_EMAIL` and `OWNER_PASSWORD`. There is **no owner sign-up page**: this is the
one and only owner account. The password is stored hashed, `server/.env` is ignored by git, and nothing shows the
password in the app. To change it, edit `server/.env` and restart the server. If your database already has an owner, use
that owner's email to keep its data (any other owner rows are kept but cannot log in).

| Variable         | Default             | Description                                          |
| ---------------- | ------------------- | ---------------------------------------------------- |
| `OWNER_EMAIL`    | (required)          | Login email of the one owner account                 |
| `OWNER_PASSWORD` | (required)          | Password of the owner account (at least 8 characters) |
| `OWNER_NAME`     | `PG Owner`          | Display name when the owner account is first created |
| `PORT`           | `3001`              | Backend port (hosting platforms set it themselves)   |
| `DB_PATH`        | `data/pg-rental.db` | SQLite file path, relative to `server/` (local development) |
| `DATABASE_URL`   | (not set)           | PostgreSQL connection string. When set, the app uses PostgreSQL instead of the SQLite file (production) |

More settings (cookies, allowed websites, pooling) are explained in `server/.env.example` and `DEPLOYMENT.md`.

Neon: `neon deploy` writes `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) into the git-ignored `.env.local` in the
project root. `npm run dev:neon` then runs the app on that database instead of the SQLite file. Check which Neon branch
`.env.local` points at first (`neon status`): prefer a development branch (`neon checkout dev --create`) over `production`.

The SQLite database file is created automatically on first start.

## How it works

Each owner manages **one PG**. Set it up in three steps (also the order of the sidebar):

1. **PG Details**: name, address, city and the number of floors.
2. **Floors & Rooms**: add rooms to each floor (room number, floor, beds, rent). Room numbers are unique within the PG, and a room never takes more tenants than its beds.
3. **Tenants**: the owner adds a tenant's name and email (and optionally a room). The tenant then registers themselves:
   login page, **Tenant? Register here**, enter the email the owner added, choose a password, and click **Create my account**.

Only emails the owner added can register (compared case-insensitively). An unknown email, or an email that already
has an account, is refused. **There is no email verification**: whoever knows an owner-added email can register it first,
so the owner should add a tenant only when the tenant is ready to register, and can use **Reset access** on the tenant's
page if an account was claimed by mistake.

## Try it with demo data

```sh
npm run seed
```

| Role   | Email                     | Password                      |
| ------ | ------------------------- | ----------------------------- |
| Owner  | your `OWNER_EMAIL`        | your `OWNER_PASSWORD`         |
| Tenant | rahul@demo.com            | tenant12345 (demo tenants)    |

`neha@demo.com` is added but **not registered yet**: use it to try tenant registration .
The demo data is attached to the owner from `server/.env` and is for development only (the script refuses to run in production).
To start with no demo data, simply skip `npm run seed`.

## Test

```sh
npm test            # all tests on the SQLite driver
npm run test:pg     # the same tests on a real PostgreSQL engine (no PostgreSQL install needed)
npm run test:all    # both
```

The tests always use a throw-away database (SQLite in memory, or the built-in PostgreSQL engine) and ignore `DATABASE_URL`, `DB_PATH` and the other settings in your shell or `.env` files, so they can never touch your real or hosted data.

## Run (development)

```sh
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- Health check: http://localhost:3001/api/health

The frontend dev server proxies `/api/*` to the backend, so the client calls `/api/...` on its own origin.

CORS: the backend also accepts cross-origin requests (with the login cookie) from the origins in `CLIENT_ORIGINS`
(default in development: `http://localhost:5173` and `http://127.0.0.1:5173`; default in production: none).
To call the backend directly instead of through the proxy, set `VITE_API_URL=http://localhost:3001` in `client/.env`.

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

## Hosting it online (Vercel + Render + PostgreSQL)

The app can run on free hosting: the React frontend on Vercel, the API on Render and the data in a free PostgreSQL
database. **`DEPLOYMENT.md` is the complete guide**: which free database to choose (and which not to), every setting for
each dashboard, how to copy your existing SQLite data safely, backups, and a troubleshooting table. Locally nothing
changes: without `DATABASE_URL` the app keeps using your SQLite file.
