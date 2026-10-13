import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import db from './db.js';
import { loadUser } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import authRoutes from './routes/auth.js';
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

app.get('/api/health', (req, res) => {
  const { version } = db.prepare('SELECT sqlite_version() AS version').get();
  res.json({ status: 'ok', database: { connected: true, sqliteVersion: version } });
});

app.use('/api/auth', authRoutes);
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
  else if (err.code === 'SQLITE_CONSTRAINT_TRIGGER') [status, message] = [409, err.message];
  else if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') [status, message] = [409, 'That record already exists'];
  else if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY')
    [status, message] = [409, 'This record is linked to other records and cannot be changed or deleted'];
  else if (status >= 500 && !(err instanceof HttpError)) {
    console.error(err);
    message = 'Something went wrong on the server';
  }

  res.status(status).json({ error: message, ...(err.details && { details: err.details }) });
});

export default app;
