import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Async, Badge, Button, Card, Field, FormModal, PageHeader, Table, useConfirm, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { formatDate, formatPeriod, labels, money, thisPeriod, todayISO } from '../../lib/format.js';

const methods = ['upi', 'cash', 'bank_transfer', 'card', 'other'];

function RecordPayment({ payment, onClose, onSaved }) {
  const remaining = payment.amount_due - payment.amount_paid;
  const form = useForm({ amount: String(remaining), paid_on: todayISO(), method: 'upi', note: '' }, async (v) => {
    await api(`/owner/payments/${payment.id}/record`, { method: 'POST', body: v });
    onSaved();
  });
  return (
    <FormModal open title="Record payment" onClose={onClose} form={form} submitLabel="Save payment">
      <p className="text-sm text-slate-600">
        <b>{payment.tenant_name}</b> · {formatPeriod(payment.period)} · outstanding <b>{money(remaining)}</b>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field form={form} name="amount" label="Amount received (₹)" type="number" min="1" required hint="Enter less for a part payment" />
        <Field form={form} name="paid_on" label="Date received" type="date" required />
      </div>
      <Field form={form} name="method" label="Method" as="select" options={methods.map((m) => ({ value: m, label: labels[m] }))} />
      <Field form={form} name="note" label="Note" placeholder="e.g. UPI ref no." />
    </FormModal>
  );
}

function EditCharge({ payment, onClose, onSaved }) {
  const form = useForm({ amount_due: String(payment.amount_due), due_date: payment.due_date, note: payment.note || '' }, async (v) => {
    await api(`/owner/payments/${payment.id}`, { method: 'PATCH', body: v });
    onSaved();
  });
  return (
    <FormModal open title="Edit charge" onClose={onClose} form={form}>
      <p className="text-sm text-slate-600">
        {payment.tenant_name} · {formatPeriod(payment.period)}. Use this to add extra charges such as electricity, or to give a
        discount.
      </p>
      <Field form={form} name="amount_due" label="Total amount due (₹)" type="number" min="0" required />
      <Field form={form} name="due_date" label="Due date" type="date" required />
      <Field form={form} name="note" label="Note" placeholder="e.g. Includes ₹450 electricity" />
    </FormModal>
  );
}

export default function Payments() {
  const [params, setParams] = useSearchParams();
  const period = params.get('period') ?? thisPeriod();
  const status = params.get('status') || '';
  const tenantId = params.get('tenant_id') || '';

  const query = new URLSearchParams();
  if (period) query.set('period', period);
  if (status) query.set('status', status);
  if (tenantId) query.set('tenant_id', tenantId);
  const state = useApi(`/owner/payments?${query}`);

  const [dialog, setDialog] = useState(null); // { type: 'record' | 'edit', payment }
  const [message, setMessage] = useState(null);
  const [generating, setGenerating] = useState(false);
  const confirm = useConfirm();

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (!value && key !== 'period') next.delete(key);
    setParams(next);
  };

  async function generate() {
    const p = period || thisPeriod();
    setGenerating(true);
    setMessage(null);
    try {
      const r = await api('/owner/payments/generate', { method: 'POST', body: { period: p } });
      setMessage({
        tone: 'success',
        text: r.created
          ? `Created ${r.created} rent charge(s) for ${formatPeriod(r.period)}.`
          : `All active tenants already have a charge for ${formatPeriod(r.period)}.`,
      });
      state.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setGenerating(false);
    }
  }

  const done = () => {
    setDialog(null);
    state.reload();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rent & Payments"
        subtitle="Create monthly rent charges, then record money as tenants pay."
        actions={
          <Button onClick={generate} loading={generating}>
            Create rent charges for {formatPeriod(period || thisPeriod())}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Month</span>
          <input
            type="month"
            value={period}
            onChange={(e) => update('period', e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Status</span>
          <select
            value={status}
            onChange={(e) => update('status', e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All</option>
            <option value="unpaid">Not fully paid</option>
            <option value="pending">Pending</option>
            <option value="partial">Part paid</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        {period && (
          <Button variant="ghost" onClick={() => update('period', '')}>
            Show all months
          </Button>
        )}
        {tenantId && (
          <Button variant="ghost" onClick={() => update('tenant_id', '')}>
            ✕ Clear tenant filter
          </Button>
        )}
      </div>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card>
        <Async state={state}>
          {({ payments }) => {
            const due = payments.reduce((s, p) => s + p.amount_due, 0);
            const paid = payments.reduce((s, p) => s + p.amount_paid, 0);
            return (
              <>
                {payments.length > 0 && (
                  <p className="mb-3 text-sm text-slate-600">
                    Showing {payments.length} charge(s): <b>{money(due)}</b> due, <b className="text-emerald-600">{money(paid)}</b>{' '}
                    received, <b className="text-red-600">{money(due - paid)}</b> outstanding.
                  </p>
                )}
                <Table
                  rows={payments}
                  empty="No rent charges for this filter. Use “Create rent charges” to bill your active tenants."
                  columns={[
                    {
                      key: 'tenant',
                      label: 'Tenant',
                      render: (p) => (
                        <div>
                          <Link to={`/owner/tenants/${p.tenant_id}`} className="font-medium text-indigo-600 hover:underline">
                            {p.tenant_name}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {p.property_name} · {p.room_number}
                          </div>
                        </div>
                      ),
                    },
                    { key: 'period', label: 'Month', render: (p) => formatPeriod(p.period) },
                    {
                      key: 'amount_due',
                      label: 'Due',
                      render: (p) => (
                        <div>
                          {money(p.amount_due)}
                          {p.note && <div className="text-xs text-slate-500">{p.note}</div>}
                        </div>
                      ),
                    },
                    { key: 'amount_paid', label: 'Paid', render: (p) => money(p.amount_paid) },
                    { key: 'status', label: 'Status', render: (p) => <Badge status={p.status} /> },
                    {
                      key: 'paid_on',
                      label: 'Paid on',
                      render: (p) => (p.paid_on ? `${formatDate(p.paid_on)}${p.method ? ` · ${labels[p.method]}` : ''}` : `Due ${formatDate(p.due_date)}`),
                    },
                    {
                      key: 'actions',
                      label: '',
                      className: 'text-right whitespace-nowrap',
                      render: (p) => (
                        <>
                          {p.status !== 'paid' && (
                            <Button size="sm" onClick={() => setDialog({ type: 'record', payment: p })}>
                              Record payment
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'edit', payment: p })}>
                            Edit
                          </Button>
                          {p.amount_paid === 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600 hover:bg-red-50"
                              onClick={() =>
                                confirm.ask({
                                  title: 'Delete this charge?',
                                  message: `${p.tenant_name} · ${formatPeriod(p.period)} · ${money(p.amount_due)}`,
                                  confirmLabel: 'Delete charge',
                                  onConfirm: async () => {
                                    await api(`/owner/payments/${p.id}`, { method: 'DELETE' });
                                    state.reload();
                                  },
                                })
                              }
                            >
                              Delete
                            </Button>
                          )}
                        </>
                      ),
                    },
                  ]}
                />
              </>
            );
          }}
        </Async>
      </Card>

      {dialog?.type === 'record' && <RecordPayment payment={dialog.payment} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.type === 'edit' && <EditCharge payment={dialog.payment} onClose={() => setDialog(null)} onSaved={done} />}
      {confirm.element}
    </div>
  );
}
