import { badRequest } from './http.js';

// Small schema validator. Example:
//   const data = validate(req.body, { name: str({ max: 100 }), capacity: int({ min: 1 }) });
// Returns only the declared fields (cleaned up), or throws a 400 listing every invalid field.
export function validate(input, schema, { partial = false } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const out = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (partial && !(key in body)) continue;
    try {
      const value = rule(body[key]);
      if (value !== undefined) out[key] = value;
    } catch (err) {
      errors[key] = err.message;
    }
  }
  if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields', errors);
  if (partial && !Object.keys(out).length) throw badRequest('Nothing to update');
  return out;
}

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function optionalWrap(rule, optional) {
  return (v) => {
    if (isBlank(v)) {
      if (optional) return null;
      throw new Error('Required');
    }
    return rule(v);
  };
}

export const str = ({ min = 1, max = 200, optional = false } = {}) =>
  optionalWrap((v) => {
    if (typeof v !== 'string') throw new Error('Must be text');
    const s = v.trim();
    if (s.length < min) throw new Error(`Must be at least ${min} characters`);
    if (s.length > max) throw new Error(`Must be at most ${max} characters`);
    return s;
  }, optional);

export const int = ({ min = 0, max = 100_000_000, optional = false } = {}) =>
  optionalWrap((v) => {
    const n = typeof v === 'string' ? Number(v.trim()) : v;
    if (!Number.isInteger(n)) throw new Error('Must be a whole number');
    if (n < min) throw new Error(`Must be at least ${min}`);
    if (n > max) throw new Error(`Must be at most ${max}`);
    return n;
  }, optional);

export const email = ({ optional = false } = {}) =>
  optionalWrap((v) => {
    if (typeof v !== 'string') throw new Error('Must be text');
    const s = v.trim().toLowerCase();
    if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error('Enter a valid email address');
    return s;
  }, optional);

export const phone = ({ optional = true } = {}) =>
  optionalWrap((v) => {
    if (typeof v !== 'string') throw new Error('Must be text');
    const s = v.trim();
    if (!/^\+?[0-9 -]{7,20}$/.test(s)) throw new Error('Enter a valid phone number');
    return s;
  }, optional);

export const password = ({ optional = false } = {}) =>
  optionalWrap((v) => {
    if (typeof v !== 'string') throw new Error('Must be text');
    if (v.length < 8) throw new Error('Must be at least 8 characters');
    if (v.length > 128) throw new Error('Must be at most 128 characters');
    return v;
  }, optional);

export const date = ({ optional = false } = {}) =>
  optionalWrap((v) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Must be a date (YYYY-MM-DD)');
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new Error('Not a real date');
    return v;
  }, optional);

export const period = ({ optional = false } = {}) =>
  optionalWrap((v) => {
    if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new Error('Must be a month (YYYY-MM)');
    return v;
  }, optional);

export const oneOf = (values, { optional = false } = {}) =>
  optionalWrap((v) => {
    if (!values.includes(v)) throw new Error(`Must be one of: ${values.join(', ')}`);
    return v;
  }, optional);
