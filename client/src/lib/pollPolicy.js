// The timing rules for refreshing the unread notification counts. Plain functions so they can be tested without a browser
// (client/test/pollPolicy.test.js). The provider in notifications.jsx applies them.
export const POLL_MS = 60_000; // normal wait between refreshes while the tab is visible
export const MAX_BACKOFF_MS = 10 * 60_000; // longest wait after repeated failures
export const IDLE_AFTER_MS = 10 * 60_000; // stop polling after this long without any interaction
export const MIN_GAP_MS = 15_000; // never refresh more often than this when the tab is merely revisited

// After a success the wait goes back to normal; after a failure it doubles, up to the maximum.
export const nextDelay = (current, ok) => (ok ? POLL_MS : Math.min(current * 2, MAX_BACKOFF_MS));

export const isIdle = (lastActivity, now) => now - lastActivity > IDLE_AFTER_MS;

export const shouldRefreshOnWake = (lastFetch, now) => now - lastFetch >= MIN_GAP_MS;
