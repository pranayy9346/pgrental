# Security model

How the PG Rental Management System authenticates people, protects their data, and what it deliberately does not
do. Every control listed here is enforced on the server; the React app only mirrors it. Tests that cover each control
are named in brackets (all under `server/test/`).

## Who can do what

| Actor | How they get in | What they can reach |
| --- | --- | --- |
| Owner (exactly one) | `OWNER_EMAIL` / `OWNER_PASSWORD` in the server configuration. No sign-up exists. | `/api/owner/*`, only rows that belong to their PG. |
| Tenant | Added by the owner, then registers with the owner-added email **and** a one-time invite code. | `/api/tenant/*`, only their own stay, payments, complaints and requests. |
| Visitor | Nothing | Login, tenant registration, `/api/health`. |

Role checks (`requireRole`) run on every owner and tenant route. Records belonging to someone else answer **404**, not
403, so their existence is not revealed. [`api.test.js`, `owner-config.test.js`, `tenant-accounts.test.js`]

## Tenant registration and invite codes

- Adding a tenant, **New invite code** and **Reset access** each return a fresh code: 12 characters of Crockford base32
  (60 random bits), formatted `XXXX-XXXX-XXXX`. It is shown to the owner **once**.
- Only a SHA-256 hash of the code is stored, next to an expiry (7 days). Registering uses it up; issuing a new one
  replaces it.
- Registration needs email + code. The claim is a single conditional `UPDATE`, so concurrent attempts produce exactly
  one account.
- Every refusal (unknown email, wrong or expired code, already registered, owner's email) returns the **same** 400
  answer, so the form cannot be used to discover which emails the owner added.
- Attempts are limited to 20 per IP address per 15 minutes.
- The owner's registration link puts the code after `#` (`/register/tenant#email=…&code=…`). Browsers never send that
  part to a server, and the page removes it from the address bar once read.

[`registration.test.js`]

## Passwords

- scrypt, N = 2^16, r = 8, p = 1, 16-byte random salt, 64-byte key, timing-safe comparison. The cost is stored inside
  each hash (`scrypt$ln=16,r=8,p=1$salt$key`). Hashes from before this format used Node's default cost (2^14). They
  are upgraded automatically on the next successful login, and the owner's at server start.
- Why not OWASP's 2^17: it needs 128 MiB per hash, and Node runs up to 4 hashes at once. That is the whole memory of
  a 512 MB instance, so a burst of logins could crash the server.
- Hashes with absurd cost parameters (a tampered row) are treated as unusable instead of being computed.
- Length 8–128 characters. Passwords are checked exactly as typed (never trimmed).
- Unknown emails, disabled owners and tenants who have not registered still cost one full hash, so response time does
  not reveal which accounts exist.
- Changing a password logs out the user's other devices. Wrong current passwords are limited to 5 per 15 minutes per
  user.

[`security.test.js`, `registration.test.js`]

## Sessions

- 32 random bytes per session, kept in an `HttpOnly` cookie. The database stores only its SHA-256 hash. Absolute
  lifetime 7 days, and expired rows are purged hourly.
- `Secure` in production. With `Secure` the cookie is named `__Host-pg_session`, so a sibling subdomain cannot set or
  overwrite it.
- `SameSite=Lax` by default; `None` only for the split Vercel + Render deployment (see CSRF below).
- Logging in or registering ends any session the browser already had (no session fixation).
- Logout deletes the session on the server. Reset access and owner password changes delete all of that user's
  sessions.

[`security.test.js`, `production-config.test.js`]

## Brute-force protection

| Limit | Key | Threshold (per 15 min) |
| --- | --- | --- |
| Login, one account | IP + email | 10 attempts |
| Login, many accounts (password spraying) | IP | 100 attempts; successful logins give theirs back |
| Tenant registration | IP | 20 attempts; successful registrations give theirs back |
| Change password | user | 5 wrong attempts |

An attempt is counted **before** the password is hashed, so parallel bursts cannot slip in under the limit.
[`security.test.js`]

These limits use the visitor's IP, which is only correct when `TRUST_PROXY` is the **number** of proxies in front of
the server (`1` on Render). Express reads any string as a list of proxy addresses, so before this was handled,
`TRUST_PROXY=1` made every visitor share the proxy's address. The server now converts it to a number. It refuses
`true`, because any visitor could then choose their own IP with `X-Forwarded-For`.

## Cross-site requests (CSRF / CORS)

- CORS allows only origins listed in `CLIENT_ORIGINS`, with credentials. Origins are never `*`.
- Every state-changing request is checked: an `Origin` header from another site is refused. With `SameSite=None`, an
  `Origin` from the allow-list is **required**. [`cors.test.js`, `production-config.test.js`]

## Headers

The API and the server-served React app send:

- `Content-Security-Policy`: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Cross-Origin-Opener-Policy: same-origin`, and a restrictive `Permissions-Policy`.
- HSTS in production.
- `/api/*` is also sent with `Cache-Control: no-store`.

`client/vercel.json` sends the same set for the Vercel-hosted frontend. Its `connect-src` allows `https:` so that the
frontend can reach the Render API.

## Data protection

- Only parameterised SQL. The few dynamic `SET` lists are built from validator-whitelisted keys.
- One validator for every input, which keeps only declared fields. Extra fields such as `role` are ignored.
- Password hashes, invite-code hashes and session hashes never appear in API responses.
- Secrets live only in server environment variables. The client build refuses to start if a `VITE_` variable looks
  like a secret.

## Security log

Security events are written to standard output as one JSON line each:

- `login_failed`, `rate_limited`, `register_failed`, `registered`
- `invite_issued`, `access_reset`
- `password_changed`, `change_password_failed`

They include the email or user id and the IP, never passwords, codes or tokens. `SECURITY_LOG=off` silences them.

## Deployment checklist

- [ ] `NODE_ENV=production` (Secure cookies, HSTS, no SQLite fallback).
- [ ] `OWNER_PASSWORD` is long (12+ characters, the server warns otherwise) and unique; it is stored only in the
      hosting dashboard.
- [ ] `TRUST_PROXY=1` on Render (a number, not `true`).
- [ ] `CLIENT_ORIGINS` lists exactly the frontend's https address.
- [ ] `DATABASE_URL` uses TLS (`sslmode=require` / `verify-full`).
- [ ] Tenants who were invited before invite codes existed get a **New invite code** from their page.

## Known limitations (accepted for a single small PG)

- **Rate-limit counters are in memory.** They reset on restart and are not shared if more than one server instance
  runs. A shared store (Redis, or a database table) would be needed to scale out.
- **No e-mail.** There is no e-mail verification or self-service password reset. A lost password goes through the
  owner's **Reset access**, and invite codes travel through whatever channel the owner uses (WhatsApp, SMS, in person).
- **The owner password is a deployment setting.** It can only be changed in the hosting dashboard. There is no MFA.
- **No idle timeout.** Sessions live 7 days from login, regardless of activity.
- **The split deployment needs third-party cookies.** With the frontend on `*.vercel.app` and the API on
  `*.onrender.com`, the session cookie is cross-site (`SameSite=None`). Browsers that block third-party cookies
  (Safari, and Chrome with that setting) will not keep the login. Serving the API through the frontend's own domain
  (a Vercel rewrite of `/api/*` to Render, see DEPLOYMENT.md) makes it same-site and allows `SameSite=Lax` again.
- **No audit table.** Security events go to the hosting platform's logs, which are kept only as long as that
  platform keeps them.

## Reporting a problem

Please report suspected vulnerabilities privately to the maintainers rather than in a public issue.
