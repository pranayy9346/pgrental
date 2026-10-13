import { useCallback, useEffect, useState } from 'react';

// Error thrown for any non-2xx response. `details` holds per-field validation messages from the server.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

// Called when any request comes back 401 (session expired) so the app can return to the login page.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// By default requests go to the same origin (/api/...) and the Vite dev server proxies them to the backend.
// Set VITE_API_URL (e.g. http://localhost:3001) in client/.env to call the backend directly; this relies on CORS.
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      credentials: API_URL ? 'include' : 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?');
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data === null) {
    // Every endpoint answers with JSON. Anything else usually means the request reached the wrong server, e.g. the
    // hosted frontend was built without VITE_API_URL and is asking its own host for /api.
    throw new ApiError(res.status, 'The server sent an unexpected reply. If this is the hosted site, check that VITE_API_URL points to the backend.');
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  }
  return data;
}

// Loads data for a page. Usage: const { data, error, loading, reload } = useApi('/owner/properties');
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
