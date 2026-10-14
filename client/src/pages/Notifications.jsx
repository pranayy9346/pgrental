import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Card, Empty, Icon, Loading, PageHeader, Tabs } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { formatDateTime, timeAgo } from '../lib/format.js';
import { useNotifications } from '../lib/notifications.jsx';

const categoryMeta = {
  notices: ['megaphone', 'Notice'],
  complaints: ['message', 'Complaint'],
  payments: ['card', 'Payment'],
  moveout: ['logout', 'Move-out'],
};

const PAGE = 20;

// The notification center, shared by owners and tenants (the server only ever returns the caller's own).
// Opening an item marks it as read; so do the "Mark as read" button and the explicit "Mark all as read".
// Just visiting this page never marks anything.
export default function Notifications() {
  const navigate = useNavigate();
  const { summary, applySummary, markOne, markAll } = useNotifications();
  const [tab, setTab] = useState('unread'); // 'unread' | 'all'
  const [state, setState] = useState({ items: [], nextBefore: null, loading: true, loadingMore: false, error: null });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (before) => {
      setState((s) => (before ? { ...s, loadingMore: true, error: null } : { ...s, loading: true, error: null }));
      try {
        const d = await api(`/notifications?status=${tab}&limit=${PAGE}${before ? `&before=${before}` : ''}`);
        applySummary(d.summary); // the list answer already carries fresh counts for the badges
        setState((s) => ({
          items: before ? [...s.items, ...d.notifications] : d.notifications,
          nextBefore: d.nextBefore,
          loading: false,
          loadingMore: false,
          error: null,
        }));
      } catch (error) {
        setState((s) => ({ ...s, loading: false, loadingMore: false, error }));
      }
    },
    [tab, applySummary],
  );

  useEffect(() => {
    load();
  }, [load]);

  const unreadCount = summary?.total ?? 0;
  const markLocally = (id) =>
    setState((s) => ({
      ...s,
      items:
        tab === 'unread'
          ? s.items.filter((n) => n.id !== id)
          : s.items.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString().slice(0, 19).replace('T', ' ') } : n)),
    }));

  async function open(n) {
    if (!n.read_at) {
      try {
        await markOne(n.id);
      } catch {
        /* still go to the page: reading it is what the person asked for */
      }
    }
    navigate(n.link);
  }

  async function markRead(n) {
    setBusy(true);
    try {
      await markOne(n.id);
      markLocally(n.id);
    } catch (error) {
      setState((s) => ({ ...s, error }));
    } finally {
      setBusy(false);
    }
  }

  async function readAll() {
    setBusy(true);
    try {
      await markAll();
      const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
      setState((s) => ({ ...s, items: tab === 'unread' ? [] : s.items.map((n) => (n.read_at ? n : { ...n, read_at: stamp })), nextBefore: tab === 'unread' ? null : s.nextBefore }));
    } catch (error) {
      setState((s) => ({ ...s, error }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle="Updates about notices, complaints, rent and move-out requests."
        actions={
          <Button variant="secondary" onClick={readAll} loading={busy} disabled={unreadCount === 0}>
            Mark all as read
          </Button>
        }
      />
      <Tabs
        label="Show notifications"
        value={tab}
        onChange={setTab}
        tabs={[
          ['unread', unreadCount ? `Unread (${unreadCount > 99 ? '99+' : unreadCount})` : 'Unread'],
          ['all', 'All'],
        ]}
      />

      {state.error && (
        <div className="mb-4 space-y-3">
          <Alert>{state.error.message}</Alert>
          <Button variant="secondary" onClick={() => load()}>
            Try again
          </Button>
        </div>
      )}

      {state.loading ? (
        <Loading />
      ) : state.items.length === 0 && !state.error ? (
        <Empty title={tab === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}>
          {tab === 'unread' ? 'New updates will show up here and as a red badge on the menu.' : 'Updates about your PG will be listed here.'}
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <ul className="-m-4 divide-y divide-slate-100 sm:-m-5">
            {state.items.map((n) => {
              const [icon, label] = categoryMeta[n.category] ?? ['bell', 'Update'];
              const unread = !n.read_at;
              return (
                <li key={n.id} className={`flex items-start gap-3 px-4 py-4 sm:px-5 ${unread ? 'bg-indigo-50/40' : ''}`}>
                  <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${unread ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                    <Icon name={icon} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => open(n)} className="block w-full rounded-md text-left focus-visible:outline-2">
                      <span className="flex items-start gap-2">
                        <span className={`min-w-0 flex-1 break-words text-sm ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>{n.title}</span>
                        {unread && (
                          <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-red-600">
                            <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
                            Unread
                          </span>
                        )}
                      </span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block break-words text-sm text-slate-600">{n.body}</span>}
                    </button>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="font-medium">{label}</span>
                      <time dateTime={n.created_at.replace(' ', 'T') + 'Z'} title={formatDateTime(n.created_at)}>
                        {timeAgo(n.created_at)}
                      </time>
                      {!unread && <span title={formatDateTime(n.read_at)}>Read</span>}
                    </div>
                  </div>
                  {unread && (
                    <Button size="sm" variant="ghost" className="shrink-0" onClick={() => markRead(n)} disabled={busy}>
                      Mark as read
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {state.nextBefore && !state.loading && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" loading={state.loadingMore} onClick={() => load(state.nextBefore)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
