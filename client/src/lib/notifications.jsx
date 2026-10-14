import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { isIdle, nextDelay, POLL_MS, shouldRefreshOnWake } from './pollPolicy.js';

// Unread notification counts for the logged-in user, shared by the sidebar badges, the bell and the notification page.
//
// Requests are kept to a minimum:
//  * the counts are fetched when the app opens, and then every 60 seconds, but only while the tab is visible;
//  * polling pauses after 10 minutes without any interaction and resumes (with an immediate refresh) when the
//    person comes back; it also refreshes when the tab becomes visible again (at most once every 15 seconds);
//  * after a failed request the wait doubles, up to 10 minutes, and goes back to 60 seconds after a success;
//  * actions that change the counts (marking read) get the new counts in their own response: no extra request.
// Nothing here marks a notification as read by itself: only the explicit actions below do.
// The numbers and rules live in pollPolicy.js (unit-tested).

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const [summary, setSummary] = useState(null); // null until the first answer
  const [available, setAvailable] = useState(true); // false if the server has no notification API (older backend)
  const [announcement, setAnnouncement] = useState('');
  const known = useRef(null); // last total, to announce only increases to screen readers
  const poll = useRef({ timer: null, delay: POLL_MS, paused: false, lastActivity: Date.now(), lastFetch: 0, stopped: false });

  const applySummary = useCallback((next) => {
    if (!next) return;
    setSummary(next);
    if (known.current !== null && next.total > known.current) {
      setAnnouncement(`You have ${next.total} unread notification${next.total === 1 ? '' : 's'}.`);
    }
    known.current = next.total;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const d = await api('/notifications/summary');
      poll.current.lastFetch = Date.now();
      applySummary(d.summary);
    } catch (err) {
      if (err.status === 404) {
        // An older backend without notifications: hide the badges and stop asking.
        poll.current.stopped = true;
        setAvailable(false);
        setSummary(null);
      }
      throw err;
    }
  }, [applySummary]);

  useEffect(() => {
    const p = poll.current;
    p.stopped = false;
    p.lastActivity = Date.now();

    const schedule = () => {
      clearTimeout(p.timer);
      p.timer = null;
      if (p.stopped || document.hidden || p.paused) return;
      p.timer = setTimeout(tick, p.delay);
    };
    async function tick() {
      p.timer = null;
      if (p.stopped || document.hidden) return;
      if (isIdle(p.lastActivity, Date.now())) {
        p.paused = true; // idle: stop until the person is back
        return;
      }
      try {
        await refresh();
        p.delay = nextDelay(p.delay, true);
      } catch {
        p.delay = nextDelay(p.delay, false);
      }
      schedule();
    }
    // Called on interaction and when the tab becomes visible.
    async function wake() {
      if (p.stopped || document.hidden) return;
      p.paused = false;
      if (shouldRefreshOnWake(p.lastFetch, Date.now())) {
        try {
          await refresh();
          p.delay = nextDelay(p.delay, true);
        } catch {
          p.delay = nextDelay(p.delay, false);
        }
      }
      if (!p.timer) schedule();
    }
    let lastNoted = 0;
    const onActivity = () => {
      const now = Date.now();
      p.lastActivity = now;
      if (p.paused && now - lastNoted > 1000) {
        lastNoted = now;
        wake();
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(p.timer);
        p.timer = null;
      } else {
        p.lastActivity = Date.now();
        wake();
      }
    };

    wake(); // first load
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      p.stopped = true;
      clearTimeout(p.timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // Explicit actions. Each answer carries the new counts.
  const post = useCallback(
    async (path, body) => {
      const d = await api(path, { method: 'POST', body });
      applySummary(d.summary);
      return d;
    },
    [applySummary],
  );
  const markOne = useCallback((id) => post(`/notifications/${id}/read`), [post]);
  const markEntity = useCallback((entity_type, entity_id) => post('/notifications/read', { entity_type, entity_id }), [post]);
  const markAll = useCallback(() => post('/notifications/read', { all: true }), [post]);

  const value = useMemo(
    () => ({ summary, available, announcement, refresh, applySummary, markOne, markEntity, markAll }),
    [summary, available, announcement, refresh, applySummary, markOne, markEntity, markAll],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

const NONE = { summary: null, available: false, announcement: '', refresh: async () => {}, applySummary() {}, markOne: async () => ({}), markEntity: async () => ({}), markAll: async () => ({}) };
export const useNotifications = () => useContext(NotificationsContext) ?? NONE;

// For list pages: which records of a category have unread notifications ("New" tags), and an explicit "Mark as read".
// Reading this changes nothing. The list is re-fetched only when the category's unread count changes.
export function useUnreadEntities(category) {
  const { summary, available, markEntity } = useNotifications();
  const [keys, setKeys] = useState(() => new Set());
  const skip = useRef(null); // count we already know about because of our own "mark as read"
  const count = summary?.[category] ?? 0;
  const loaded = summary !== null;

  useEffect(() => {
    // Ask only when the counts say something in this category is unread: nothing to tag means no request at all.
    if (!available || !loaded) return undefined;
    if (count === 0) {
      setKeys((prev) => (prev.size ? new Set() : prev));
      return undefined;
    }
    if (skip.current === count) {
      skip.current = null;
      return undefined;
    }
    let live = true;
    api(`/notifications/unread-entities?category=${category}`)
      .then((d) => live && setKeys(new Set(d.items.map((i) => `${i.entity_type}:${i.entity_id}`))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [category, count, available, loaded]);

  const isUnread = useCallback((type, id) => keys.has(`${type}:${id}`), [keys]);
  const markRead = useCallback(
    async (type, id) => {
      try {
        const d = await markEntity(type, id);
        skip.current = d.summary?.[category] ?? null;
        setKeys((prev) => {
          const next = new Set(prev);
          next.delete(`${type}:${id}`);
          return next;
        });
        return true;
      } catch {
        return false; // the tag simply stays; the person can try again
      }
    },
    [markEntity, category],
  );
  return { isUnread, markRead };
}
