// An error with an HTTP status code. Throw it from any route; the error handler in app.js turns it
// into a JSON response like { "error": "message", "details": {...} }.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const conflict = (message) => new HttpError(409, message);

// Parses a positive integer route parameter such as /rooms/:id.
export function idParam(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

export function currentPeriod(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
