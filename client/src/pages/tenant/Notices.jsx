import { Async, Button, Card, Empty, NewTag, PageHeader } from '../../components/ui.jsx';
import { useApi } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { useUnreadEntities } from '../../lib/notifications.jsx';

export default function TenantNotices() {
  const state = useApi('/tenant/notices');
  const unread = useUnreadEntities('notices');
  return (
    <div>
      <PageHeader title="Notices" subtitle="Announcements from your PG owner." />
      <Async state={state}>
        {({ notices }) =>
          notices.length === 0 ? (
            <Empty title="No notices." />
          ) : (
            <div className="space-y-3">
              {notices.map((n) => {
                const isNew = unread.isUnread('notice', n.id);
                return (
                  <Card key={n.id} className={isNew ? 'ring-2 ring-red-500/30' : ''}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{n.title}</h3>
                      {isNew && <NewTag />}
                    </div>
                    <p className="text-xs text-slate-500">{formatDate(n.created_at)}</p>
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{n.body}</p>
                    {isNew && (
                      <div className="mt-3 flex justify-end">
                        <Button size="sm" variant="secondary" onClick={() => unread.markRead('notice', n.id)}>
                          Mark as read
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )
        }
      </Async>
    </div>
  );
}
