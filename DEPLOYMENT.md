# Deploying the PG Rental Management System (free hosting)

**Target:** frontend on **Vercel** (free), backend on **Render** (free web service), database on a free **PostgreSQL** provider.
**Status:** everything below is *prepared and tested locally*. **Nothing has been deployed**, no cloud resource was created, and nothing was pushed. The hosted steps are written from the platforms' documentation and could not be rehearsed for real (see [Remaining blockers](#8-remaining-blockers-and-things-only-you-can-do)).

```
Browser ──► Vercel (static React app, client/dist)
   │
   └─ fetch https://<api>.onrender.com/api/...  (cookie + CORS)
            │
            ▼
        Render web service (Node + Express, server/)  ──►  PostgreSQL (Neon)
```

---

## 1. Which free PostgreSQL? (researched 2026-10-13)

Limits were read from each provider's official pages on the date above. **Free plans change; re-check before relying on them.**

| Provider | Free plan, as published | Lasts? | Verdict |
|---|---|---|---|
| **Neon** ([pricing](https://neon.com/pricing)) | 1 GB storage per project; 100 compute-hours per project per month; compute auto-suspends after 5 minutes idle (cannot be turned off); no credit card; **6-hour** history window; 1 manual snapshot, no scheduled snapshots | **Permanent plan** (described as not a trial, does not expire) | **Recommended** |
| **Supabase** ([pricing](https://supabase.com/pricing)) | 500 MB database; 2 active projects; **paused after 1 week of inactivity**; no automatic backups | No expiry, but pauses | Workable alternative; a quiet PG would be paused weekly |
| **Render PostgreSQL** ([docs](https://render.com/docs/free)) | 1 GB; no backups; **expires 30 days after creation** (+14 days grace, then deleted) | **No: a 30-day trial** | **Do not use for real data** |

Why Neon: it is the only one of the three that is both permanent and does not pause the project for inactivity. Two things to plan for:

* **Backups are your job.** Neon's free history is only 6 hours and Supabase's free plan has no automatic backups. Use the tools in [section 6](#6-backups-and-restoring).
* **Compute budget.** 100 compute-hours/month is enough for one small PG when the database can sleep. That is why the Render health check (`/api/health`) does **not** query the database. Do not point an uptime monitor at `/api/health/db` every minute: it would keep the database awake all month.

## 2. Free hosting facts that affect this app (researched 2026-10-13)

| Platform | Fact | What it means here |
|---|---|---|
| Render free web service ([docs](https://render.com/docs/free)) | Spins down after **15 min** without traffic; ~**1 minute** to wake on the next request; 750 free instance-hours/month | The first visit after idle is slow. Normal for the free tier. |
| Render free web service | **No persistent disk**: the filesystem is wiped on redeploy, restart and spin-down | **SQLite cannot be used in production.** The server refuses to start on SQLite when `NODE_ENV=production`. |
| Render free web service | Outbound ports 25/465/587 blocked | Not relevant: the app sends no e-mail. |
| Render free web service | No shell access, no one-off jobs | Run migrations/data copy from **your own computer** (section 4), not on Render. |
| Vercel Hobby ([plan](https://vercel.com/docs/plans/hobby), [fair use](https://vercel.com/docs/limits/fair-use-guidelines)) | Hobby is **non-commercial, personal use only**. "Commercial" is defined broadly (any deployment used for the financial gain of anyone involved) | **Check this before relying on it.** If the PG business is run for profit this may need the Pro plan. Vercel support can clarify; I cannot decide it for you. |

## 3. Environment variables

**Rule:** secrets live **only** on the backend (Render). The frontend (Vercel) gets **one public value**. Anything named `VITE_*` is copied into the public JavaScript; the frontend build **fails on purpose** if a `VITE_` variable looks like a secret.

### 3.1 Render (backend): Environment tab

| Variable | Required | Secret? | Value / example | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | **yes** | **yes** | `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require` | From the Neon dashboard. Keep `sslmode=require`. |
| `DATABASE_URL_UNPOOLED` | recommended with Neon | **yes** | `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require` | Neon's **direct** string (no `-pooler`). When present, start-up schema migrations use it; the app's normal traffic keeps using the pooled `DATABASE_URL`. The command-line tools (`migrate`, `migrate:from-sqlite`, `backup:postgres`) also prefer it. |
| `OWNER_EMAIL` | **yes** | no | `owner@example.com` | The one owner login. To keep an existing owner's data, use that owner's e-mail. |
| `OWNER_PASSWORD` | **yes** | **yes** | 8+ characters | Stored hashed. Changing it and redeploying changes the owner's password. |
| `CLIENT_ORIGINS` | **yes** | no | `https://pg-rental.vercel.app` | Your Vercel address: https, no trailing slash, comma-separate several. Required for the browser to be allowed to call the API. |
| `COOKIE_SAMESITE` | yes (set by `render.yaml`) | no | `none` | Needed because Vercel and Render are different sites. See [section 5](#5-cookies-and-cors-between-vercel-and-render). |
| `NODE_ENV` | yes (set by `render.yaml`) | no | `production` | Makes cookies Secure and disables the SQLite fallback. |
| `TRUST_PROXY` | yes (set by `render.yaml`) | no | `1` | So the login rate limit sees each visitor's real IP, not Render's proxy. |
| `NODE_VERSION` | yes (set by `render.yaml`) | no | `22` | Node 22 or newer is required. |
| `PORT` | **do not set** | no | | Render provides it; the server listens on `0.0.0.0:$PORT`. |
| `OWNER_NAME` | no | no | `PG Owner` | Display name when the owner account is first created. |
| `DATABASE_POOL_MAX`, `DATABASE_CONNECT_TIMEOUT_MS` | no | no | `5`, `20000` | Defaults suit free tiers; the timeout allows a sleeping database to wake up. |
| `DB_AUTO_MIGRATE` | no | no | `false` | Only to switch off the automatic schema migration at start-up. |
| `SESSION_SECRET` | **not used** | | | Sessions are random 256-bit tokens stored hashed in the database, not signed cookies or JWTs, so there is no signing secret to configure. (Adding one would protect nothing extra.) |

### 3.2 Vercel (frontend): Settings, Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_URL` | `https://your-service.onrender.com` | https, **no trailing slash**, the address of the Render service. This is the only frontend variable. It is public by design. Set it for **Production** (and Preview if you use previews). |

### 3.3 Local development (`server/.env`, never committed)

`OWNER_EMAIL`, `OWNER_PASSWORD`, optionally `DB_PATH`, `PORT`. With no `DATABASE_URL` the app keeps using your local SQLite file exactly as before. See `server/.env.example`.

## 4. Step by step

Do these **in order**. Steps 1 to 3 happen on your computer and change nothing online.

### Step 1. Back up the SQLite database (local)

```sh
npm run backup:sqlite
```
Writes a verified copy to `server/data/backups/pg-rental-<time>.db` (Git ignores that folder) and prints the integrity check and row counts. The original is opened read-only. A backup taken on 2026-10-13 while preparing this work exists in that folder. Make **a fresh one right before the real copy** (Step 4), and copy it somewhere outside this folder too (it contains password hashes and personal data).

### Step 2. Create the PostgreSQL database (Neon)

1. Create a free Neon account and a project. Choose a region **close to your Render region** (this project's Neon database is in Singapore, `aws-ap-southeast-1`, and `render.yaml` pins the Render service to `singapore`).
2. Open **Connect** and copy two connection strings: the **pooled** one (host contains `-pooler`) and the **direct** one. Both include `sslmode=require`.
3. Treat them like passwords. Do not paste them into chats, issues or files in this repository.

### Step 3. Rehearse the data copy (local, writes nothing)

```sh
# Windows PowerShell
$env:DATABASE_URL = "<direct connection string from Neon>"
npm run migrate:from-sqlite -w server -- --sqlite data/backups/<your-backup-file>.db
Remove-Item Env:DATABASE_URL   # IMPORTANT: do not leave the production address in your shell
```
(macOS/Linux: `DATABASE_URL="..." npm run migrate:from-sqlite -w server -- --sqlite data/backups/<file>.db`. Putting it in front of one command keeps it out of the rest of the shell session.)

> **Do not leave `DATABASE_URL` set in your shell.** Any command run afterwards (`npm run dev`, `npm run seed`, scripts) would use the production database. The test suite is protected against this: `npm test` and `npm run test:pg` clear every database and server setting before they start (`server/test/isolate.js`), and the code refuses to open a non-local PostgreSQL while running under the test runner. Still, close the terminal or clear the variable when you are done.
Without `--commit` this is a **dry run**: it creates the empty tables, copies every row, verifies every table (row counts **and** a content checksum), then **rolls everything back**. Read the table it prints: each line must say `identical`. The tool refuses a target that already contains data and never overwrites or truncates anything. Login sessions are not copied (everyone logs in again).

### Step 4. Do the real copy

Take a fresh backup (Step 1), then repeat Step 3 with `--commit` added:
```sh
npm run migrate:from-sqlite -w server -- --sqlite data/backups/<fresh-backup>.db --commit
```
Then immediately take a PostgreSQL export as your first off-site copy: `npm run backup:postgres` (needs `DATABASE_URL` set).

### Step 5. Create the Render web service

1. Push the repository to GitHub **yourself when you are ready** (this work did not push anything). Check first that no secrets are tracked: `git ls-files | findstr /i ".env .db"` should show only `*.env.example`.
2. In Render: **New, Blueprint**, pick the repository. Render reads `render.yaml`. It will ask for the four values marked "type these in": `DATABASE_URL` (use the **pooled** string), `OWNER_EMAIL`, `OWNER_PASSWORD`, `CLIENT_ORIGINS`.
   * You do not know the Vercel address yet: put a placeholder such as `https://example.vercel.app` and fix it in Step 7.
3. Deploy. In **Logs** look for: `Owner account unchanged: <your owner e-mail>` (or `updated` / `created`), `Database: PostgreSQL (DATABASE_URL)`, `Server listening on 0.0.0.0:<port>` and `Cookies: SameSite=none, Secure=true`. (A `Database migrations applied` line appears only if something was still pending.)
4. Open `https://<your-service>.onrender.com/api/health` (expect `{"status":"ok"}`) and `/api/health/db` (expect `"connected":true`).

### Step 6. Create the Vercel project

1. **Add New, Project**, import the same repository and set **Root Directory** to `client`. Vercel reads `vercel.json` only from the project's Root Directory, so the settings live in [`client/vercel.json`](client/vercel.json) (framework Vite, install, build `npm run build`, output `dist`, the security headers and the single-page-app fallback). Leave the dashboard's Framework/Build/Output/Install overrides **off** so the file is the only place these are defined. A `vercel.json` at the repository root is ignored when the Root Directory is `client`, which silently drops the headers and the fallback.
2. Add the environment variable `VITE_API_URL` = your Render address (section 3.2). Deploy.
3. Note the Vercel address (for example `https://pg-rental.vercel.app`). If you add a custom domain later, add it to `CLIENT_ORIGINS` too.

### Step 7. Connect the two

On Render set `CLIENT_ORIGINS` to the exact Vercel address and let it redeploy. Then open the Vercel site and run the [checklist](#7-after-deploying-checklist).

## 5. Cookies and CORS between Vercel and Render

`*.vercel.app` and `*.onrender.com` are different **sites**, so the login cookie has to travel cross-site. The server is configured for that:

* Cookie: `HttpOnly; Secure; SameSite=None` (set by `COOKIE_SAMESITE=none`; `None` always forces `Secure`).
* CORS: credentials allowed, only for the origins in `CLIENT_ORIGINS`, never `*`.
* Because `SameSite=None` no longer blocks cross-site writes by itself, the server then **requires** every write request to carry an allowed `Origin` header (browsers always send it) and rejects the rest with 403. Covered by `server/test/production-config.test.js`.

**Known risk (cannot be tested from here):** browsers increasingly **block third-party cookies** (Safari blocks them by default; others are moving that way). A cross-site login cookie can be dropped, which shows up as "login works, then you are logged out on the next click", most often on iPhones. If you see this, switch to the **same-site proxy mode** below. It is the more robust setup.

### Optional: same-site proxy mode (robust against cookie blocking)

Let Vercel forward `/api` to Render so the browser only ever talks to the Vercel address and the cookie is first-party.

1. In `client/vercel.json` add this as the **first** entry of `rewrites` (replace the host with your Render address):
   ```json
   { "source": "/api/:path*", "destination": "https://YOUR-SERVICE.onrender.com/api/:path*" }
   ```
2. Do **not** set `VITE_API_URL` on Vercel (the app then calls `/api` on its own address).
3. On Render set `COOKIE_SAMESITE=lax`. Keep `CLIENT_ORIGINS` set to the Vercel address (the forwarded `Origin` must still be allowed).
4. Trade-off: the login rate limiter then sees Vercel's address instead of each visitor's, so the limit is shared by everyone. Acceptable for one small PG.

## 6. Backups and restoring

| What | Command | Notes |
|---|---|---|
| Verified copy of the local SQLite file | `npm run backup:sqlite` | Safe while the app runs; Git-ignored folder. |
| Export of the hosted PostgreSQL database | `DATABASE_URL=... npm run backup:postgres` | One JSON file with every table, Git-ignored. Contains password hashes and personal data: store it privately. Do this weekly, and before any risky change. |
| Provider tools | Neon snapshot (1 manual on the free plan), or `pg_dump` if you have PostgreSQL client tools | Neon's free history is only 6 hours. |

**Restoring** a JSON export is not automated. The supported recovery path is: create a new empty database, run the copy tool from a SQLite backup, or ask for a restore script to be added. Keep the SQLite backup from Step 1 as your known-good starting point.

**Rollback plan if the move goes wrong:** the SQLite file and its backup are untouched by everything above. Stop using the hosted site and keep running locally with `npm run dev` (no `DATABASE_URL`), exactly as before.

## 7. After deploying: checklist

Run through these on the **Vercel** address (ideally also on a phone):

- [ ] The site loads; refreshing on `/owner/tenants` does not give a 404 (the SPA fallback in `client/vercel.json`).
- [ ] Response headers on the Vercel address include `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` (browser dev tools, Network tab, click the page request).
- [ ] Owner login works and **stays** logged in after clicking around and after a page refresh (this is the cookie test).
- [ ] The owner dashboard shows your migrated PG, rooms, tenants and payments (compare with the numbers from Step 3).
- [ ] A tenant who was already registered logs in with their existing password.
- [ ] A tenant you add as "invited" can register at `/register/tenant` and sees only their own data; they cannot open `/owner`.
- [ ] Record a payment, create a complaint, post a notice, request a move-out (then approve or cancel it).
- [ ] `/api/health` returns ok; the Render logs show no errors.

## 8. Remaining blockers and things only you can do

1. **Create the accounts and resources** (Neon, Render, Vercel): not done, by design.
2. **Choose between direct and proxy cookie mode** after testing on a real phone (section 5). Not testable from this repository.
3. **Vercel Hobby terms:** confirm that your use counts as non-commercial, or plan for a paid plan or another static host.
4. **Free-tier behaviour:** Render sleeps (about a minute to wake) and Neon suspends after 5 idle minutes. This is expected on free plans, not a bug.
5. **Backups:** schedule your own (section 6); free PostgreSQL gives you almost none.
6. **Demo database state (2026-10-14):** the Neon `production` branch already holds the original data (copied and verified identical to the SQLite backup) **plus sample/test users and records that were kept on purpose for the demo**. Consequences: **skip Steps 3 and 4** (the copy tool refuses a non-empty database, by design), and do not run `seed`. Only the configured owner (`OWNER_EMAIL`) can log in as owner; the other owner rows are kept but disabled. Some sample accounts use simple passwords that are visible in the public test files, so treat the demo as non-confidential and do not enter real personal data into it.
7. The code still needs **a real-network smoke test** after the first deploy (section 7). Passing the automated tests does not prove the hosted platforms are configured correctly.

## 9. Command reference

```sh
# everyday (local, unchanged)
npm install
npm run dev                       # frontend :5173 + backend :3001, SQLite
npm test                          # all tests on SQLite
npm run test:pg                   # the same tests on a real PostgreSQL engine (no server needed)
npm run test:all                  # both
npm run build                     # frontend production build
npm run seed                      # demo data, local SQLite only

# database (run from your computer)
npm run backup:sqlite
npm run migrate -w server                         # DATABASE_URL set: apply schema migrations only
npm run migrate:from-sqlite -w server -- --sqlite <file> [--commit]
npm run backup:postgres -w server                 # DATABASE_URL set

# what the hosts run
# Vercel : Root Directory = client; client/vercel.json runs  npm ci --workspace client --include-workspace-root  then  npm run build  (output client/dist)
# Render : npm ci --workspace server --omit=dev --omit=optional   then   npm run start --workspace server
```

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Browser console: *blocked by CORS policy* | `CLIENT_ORIGINS` on Render is missing, has a trailing slash, uses `http`, or differs from the address in the address bar. Fix it and redeploy. |
| Login seems to work, then you are logged out | Third-party cookies are being blocked: use the proxy mode in section 5. Also check `COOKIE_SAMESITE=none` and that the site is on https. |
| Every write returns 403 "Cross-site request blocked" | The request's `Origin` is not in `CLIENT_ORIGINS`. |
| Vercel: *No Output Directory named "dist" found* | First check the top of the build log: it must show that the build ran in the `client` folder and that `vite build` printed `dist/index.html`. Root Directory must be `client`, and `client/vercel.json` must exist in the commit being built (a `vercel.json` at the repository root is not read). If `vite build` did not run or failed earlier, the output directory will not exist; the real error is above the message. |
| *The server sent an unexpected reply* in the app | The Vercel build has no `VITE_API_URL` (the app asked Vercel for `/api`). Set it and redeploy the frontend. |
| Render log: `Refusing to start in production on SQLite` | `DATABASE_URL` is missing or empty. |
| Render log: `Cannot start: ... ECONNREFUSED / timeout / password authentication failed` | Wrong or incomplete `DATABASE_URL`, or the database is waking up (retry once). Check `?sslmode=require`. |
| `/api/health/db` returns 503 | The backend is up but cannot reach PostgreSQL. |
| First request after a quiet period takes a minute | Render free tier waking up. |
| Frontend build fails with *Refusing to build: VITE_... looks like a secret* | A secret was put into a `VITE_` variable. Remove it; secrets belong only on Render. |
| No bell or badges after deploying the frontend | The backend does not have the notification API yet (the app hides the bell when it gets a 404). Deploy the backend first. |

## 11. Notifications (unread badges)

A red count appears beside the menu items and the bell. Each user has their own unread state, stored in the database (table `notifications`, one row per person per event), so it survives refreshes, logouts and other devices.

**Who is told what**

| Event | Recipient | Menu item |
|---|---|---|
| Notice published | every *active* tenant of that PG at that moment | Notices |
| Complaint status or reply changed | that tenant | Complaints |
| Rent charge created, payment recorded, charge amount or due date changed | that tenant | My Payments |
| Move-out request approved, rejected, or closed because the owner ended the stay | that tenant | Move Out |
| Tenant raises a complaint | the owner | Complaints |
| Tenant requests or withdraws a move-out | the owner | Move-out Requests |

**Rules**
* **Existing data is not turned into notifications.** The migration only creates an empty table. Everything that exists on deployment day counts as already seen, and badges start at 0. Only events after deployment notify. A tenant who joins later is not told about older notices (they can still read them in the list).
* **Read means opened or acknowledged, never merely visited.** An item becomes read when it is opened in the notification center, when "Mark as read" is pressed, or on "Mark all as read". The owner acting on an item (updating a complaint, approving or rejecting a move-out) also counts. Loading a dashboard or list page never marks anything.
* **No duplicates.** `(recipient, dedupe key)` is unique and inserts use `ON CONFLICT DO NOTHING`; an update that changes nothing notifies nobody.
* **Deleted records.** Deleting a notice or an unpaid charge deletes the notifications about it, so nothing links to a missing page. (Complaints and move-out requests are never deleted by the app.)
* **Privacy.** Every notification query is filtered by the logged-in user's own id; another user's notification answers 404. Tenants never see the owner's notifications or each other's.
* **Request load.** Counts are fetched when the app opens, then every 60 seconds only while the tab is visible; polling pauses after 10 minutes without interaction, resumes on the next interaction or when the tab is shown again, and backs off (doubling, up to 10 minutes) after errors. An open tab keeps the free Render and Neon services awake, which uses a little of the free compute allowance.

**Deploying this feature**
1. It adds migration version 2 (`CREATE TABLE notifications` plus 3 indexes). It reads and writes no existing row and is safe to run on a database that is in use.
2. Render runs pending migrations when the server starts (`DB_AUTO_MIGRATE` is not set), so deploying the new backend applies version 2 by itself. If you prefer a manual step: set `DB_AUTO_MIGRATE=false` on Render first, take `npm run backup:postgres`, run `npm run migrate` from your computer against the direct Neon address, and only then deploy. **Never run the new backend against a database that has not been migrated** (with auto-migration off): actions that create a notification, such as posting a notice, would fail until the table exists.
3. Deploy the **backend first**, then the frontend (the new frontend hides the bell if the backend has no notification API; the old frontend simply ignores the new backend features).
4. Rollback: redeploy the previous version. The old code ignores the table; nothing needs to be dropped.

## Appendix A. SQLite to PostgreSQL migration plan (what was changed)

The application keeps **one SQL text for both databases** and a small adapter (`server/src/db/`) with one async API (`get`, `all`, `run`, `insert`, `transaction`). The driver is chosen at start-up: `DATABASE_URL` set means PostgreSQL (`pg`), otherwise the local SQLite file. A third driver, PGlite (the real PostgreSQL engine inside Node), runs the entire test suite against genuine PostgreSQL without a server.

| Area | SQLite-specific item | Change |
|---|---|---|
| API shape | synchronous `db.prepare().get()/all()/run()` | async `await db.get/all/run/insert`; every route handler is `async`; transactions are `db.transaction(async tx => ...)` and helpers take the transaction as an argument |
| Placeholders | `?` and `@name` | kept; translated to `$1, $2, ...` for PostgreSQL (`db/sql.js`) |
| New ids | `lastInsertRowid` | `INSERT ... RETURNING id` (`db.insert`) |
| Timestamps | `datetime('now')` in queries, `date('now')` | the application passes UTC timestamps/dates as parameters (`nowStamp()`, `today()`); table defaults are written per database |
| Zero-padding | `printf('%02d', ...)` | `CASE WHEN due_day < 10 THEN '0' \|\| ... END` |
| Case-insensitive text | `COLLATE NOCASE` (e-mail column, ordering, room numbers) | `lower(...)` in queries; PostgreSQL gets `UNIQUE INDEX ON lower(email)` |
| Month check | `GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'` | PostgreSQL regex `^[0-9]{4}-(0[1-9]\|1[0-2])$` (stricter: month 01-12) |
| Ids | `INTEGER PRIMARY KEY` | `INTEGER GENERATED BY DEFAULT AS IDENTITY` (sequences are moved past the highest copied id by the copy tool) |
| One PG per owner | trigger `RAISE(ABORT)` | PL/pgSQL trigger raising SQLSTATE `PG001`, serialised per owner with an advisory lock; the error handler maps it to HTTP 409 |
| Constraint errors | `SQLITE_CONSTRAINT_*` codes | also maps PostgreSQL `23505` (unique), `23503` (foreign key), `23001` (restrict) to HTTP 409 |
| Schema versioning | `PRAGMA user_version` + `schema.js` | PostgreSQL `schema_migrations` table + `db/pg-schema.js`, applied in one transaction under an advisory lock; forward-only |
| Numbers | JS numbers | PostgreSQL `COUNT`/`SUM` return 64-bit/numeric; both are parsed to plain numbers |
| Dates | TEXT | **kept as TEXT** in the same formats, so data copies unchanged and the code is identical on both databases |
| Pragmas | WAL, foreign keys, busy timeout | not applicable (PostgreSQL enforces foreign keys; connection pool replaces the busy timeout) |
| Health check | `sqlite_version()` | `/api/health` (no DB) and `/api/health/db` (`SELECT 1`) |

Not changed: authentication, authorization, validation, API routes and responses, and the React application (apart from the optional `VITE_API_URL`, which already existed).

**Two schemas to maintain:** a schema change must be added both to `server/src/schema.js` (SQLite) and `server/src/db/pg-schema.js` (PostgreSQL). `server/test/pg-migrations.test.js` fails if the tables, columns, nullability, named indexes or trigger drift apart.
