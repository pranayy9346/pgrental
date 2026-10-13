import { Async, Card, Empty, PageHeader } from '../../components/ui.jsx';
import { useApi } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

export default function TenantNotices() {
  const state = useApi('/tenant/notices');
  return (
    <div>
      <PageHeader title="Notices" subtitle="Announcements from your PG owner." />
      <Async state={state}>
        {({ notices }) =>
          notices.length === 0 ? (
            <Empty title="No notices." />
          ) : (
            <div className="space-y-3">
              {notices.map((n) => (
                <Card key={n.id}>
                  <h3 className="font-semibold text-slate-900">{n.title}</h3>
                  <p className="text-xs text-slate-500">{formatDate(n.created_at)}</p>
                  <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{n.body}</p>
                </Card>
              ))}
            </div>
          )
        }
      </Async>
    </div>
  );
}
