import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import db from './db.js';
import { cookieSettings, loadUser } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import authRoutes from './routes/auth.js';
import notificationRoutes from './routes/notifications.js';
import ownerRoutes from './routes/owner/index.js';
import tenantRoutes from './routes/tenant.js';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

// Basic security headers.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
  next();
});

app.use(express.json({ limit: '100kb' }));

// Browser origins allowed to call the API from another origin (CORS) and to make changes (CSRF check below).
// Set CLIENT_ORIGINS in server/.env as a comma-separated list. In development it defaults to the Vite dev server.
// In production it defaults to none: the built app is served by this server, so it is same-origin.
const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGINS ?? (process.env.NODE_ENV === 'production' ? '' : devOrigins.join(',')))
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

// CORS must come before the routes so that preflight (OPTIONS) requests are answered here.
// Origins that are not in the list get no CORS headers, so the browser blocks them.
app.use(
  '/api',
  cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true, // lets the browser send the login cookie; origin is never '*'
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  }),
);

// CSRF protection: requests that change data must come from our own site or an allowed client origin.
// (The session cookie is also SameSite=Lax, which blocks most cross-site requests on its own.)
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  // With SameSite=None the browser sends the login cookie from any site, so SameSite no longer protects against
  // cross-site writes. Browsers always add an Origin header to such requests; insist on it and on the allow-list.
  if (cookieSettings().sameSite === 'none' && (!origin || !allowedOrigins.has(origin))) {
    return next(new HttpError(403, 'Cross-site request blocked'));
  }
  if (origin && !allowedOrigins.has(origin)) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.get('host')) return next(new HttpError(403, 'Cross-site request blocked'));
  }
  next();
});

app.use('/api', loadUser);

// Liveness check for the hosting platform (point Render's "Health Check Path" here). It deliberately does NOT touch the
// database: free PostgreSQL plans suspend an idle database to save compute hours, and a health check that pings it
// every few seconds would keep it awake all month.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Readiness check including the database. Reports 503 (without internal details) if the database is unreachable.
app.get('/api/health/db', async (req, res) => {
  try {
    await db.ping();
    res.json({ status: 'ok', database: { connected: true, engine: db.dialect } });
  } catch (err) {
    console.error('Database health check failed:', err.message);
    res.status(503).json({ status: 'error', database: { connected: false } });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/tenant', tenantRoutes);

app.use('/api', (req, res, next) => next(new HttpError(404, 'API route not found')));

// In production (`npm run build` then `npm start`) the backend also serves the built React app.
const clientDist = path.resolve(import.meta.dirname, '../../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Central error handler: every thrown error ends up here and becomes a JSON response.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message;

  if (err.type === 'entity.parse.failed') message = 'Request body is not valid JSON';
  // 'PG001' is raised by the one-PG-per-owner trigger; 23505 / 23503 / 23001 are PostgreSQL's unique, foreign-key and restrict violations.
  else if (err.code === 'SQLITE_CONSTRAINT_TRIGGER' || err.code === 'PG001') [status, message] = [409, err.message];
  else if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === '23505') [status, message] = [409, 'That record already exists'];
  else if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || err.code === '23503' || err.code === '23001')
    [status, message] = [409, 'This record is linked to other records and cannot be changed or deleted'];
  else if (status >= 500 && !(err instanceof HttpError)) {
    console.error(err);
    message = 'Something went wrong on the server';
  }

  res.status(status).json({ error: message, ...(err.details && { details: err.details }) });
});

export default app;
