import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Async, Badge, Button, Card, Field, FormModal, Modal, PageHeader, SecretBox, Table, useConfirm, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { formatDate, formatPeriod, money, todayISO } from '../../lib/format.js';
import { AssignmentFields, assignmentBody } from './Tenants.jsx';

function EditTenant({ tenant, onClose, onSaved }) {
  const form = useForm({ name: tenant.name, email: tenant.email, phone: tenant.phone || '' }, async (v) => {
    await api(`/owner/tenants/${tenant.id}`, { method: 'PATCH', body: v });
    onSaved();
  });
  return (
    <FormModal open title="Edit tenant details" onClose={onClose} form={form}>
      <Field form={form} name="name" label="Full name" required />
      <Field form={form} name="email" label="Email (login)" type="email" required />
      <Field form={form} name="phone" label="Phone" type="tel" />
    </FormModal>
  );
}

function AssignRoom({ tenant, onClose, onSaved }) {
  const moving = Boolean(tenant.room_id);
  const form = useForm({ room_id: '', start_date: todayISO(), monthly_rent: '', deposit: moving ? String(tenant.deposit) : '', due_day: moving ? String(tenant.due_day) : '' }, async (v) => {
    if (!v.room_id) throw Object.assign(new Error('Please choose a room'), { details: { room_id: 'Required' } });
    await api(`/owner/tenants/${tenant.id}/assign`, { method: 'POST', body: assignmentBody(v) });
    onSaved();
  });
  return (
    <FormModal open wide title={moving ? 'Change room' : 'Assign a room'} onClose={onClose} form={form} submitLabel={moving ? 'Move tenant' : 'Assign room'}>
      {moving && (
        <p className="text-sm text-slate-600">
          Currently in <b>{tenant.property_name} · Room {tenant.room_number}</b>. The current stay ends on the new move-in date.
        </p>
      )}
      <AssignmentFields form={form} currentRoomId={tenant.room_id} />
    </FormModal>
  );
}

function EditRent({ tenant, onClose, onSaved }) {
  const form = useForm(
    { monthly_rent: String(tenant.monthly_rent), due_day: String(tenant.due_day), deposit: String(tenant.deposit) },
    async (v) => {
      await api(`/owner/tenants/${tenant.id}/tenancy`, { method: 'PATCH', body: v });
      onSaved();
    },
  );
  return (
    <FormModal open title="Rent & due date" onClose={onClose} form={form}>
      <p className="text-sm text-slate-600">
        Applies to rent charges created from now on. To change a charge that already exists, edit it on the Rent &amp; Payments
        page.
      </p>
      <Field form={form} name="monthly_rent" label="Monthly rent (₹)" type="number" min="0" required />
      <Field form={form} name="due_day" label="Rent due on day of month" type="number" min="1" max="28" hint="1-28" required />
      <Field form={form} name="deposit" label="Deposit (₹)" type="number" min="0" required />
    </FormModal>
  );
}

function MoveOut({ tenant, onClose, onSaved }) {
  const form = useForm({ end_date: todayISO() }, async (v) => {
    await api(`/owner/tenants/${tenant.id}/move-out`, { method: 'POST', body: v });
    onSaved();
  });
  return (
    <FormModal open title={`Move out ${tenant.name}`} onClose={onClose} form={form} submitLabel="Confirm move-out">
      <p className="text-sm text-slate-600">
        This frees their bed in {tenant.property_name} · Room {tenant.room_number}. Their login and history are kept, and
        any unpaid rent stays on record.
      </p>
      <Field form={form} name="end_date" label="Move-out date" type="date" required />
    </FormModal>
  );
}

export default function TenantDetail() {
  const { id } = useParams();
  const state = useApi(`/owner/tenants/${id}`);
  const [dialog, setDialog] = useState(null); // 'edit' | 'assign' | 'moveout'
  const [tempPassword, setTempPassword] = useState(null);
  const confirm = useConfirm();

  const done = () => {
    setDialog(null);
    state.reload();
  };

  return (
    <Async state={state}>
      {({ tenant, tenancies, payments }) => (
        <div className="space-y-6">
          <Link to="/owner/tenants" className="text-sm text-indigo-600 hover:underline">
            ← All tenants
          </Link>
          <PageHeader
            title={tenant.name}
            subtitle={`${tenant.email}${tenant.phone ? ` · ${tenant.phone}` : ''}`}
            actions={
              <>
                <Button variant="secondary" onClick={() => setDialog('edit')}>
                  Edit details
                </Button>
                <Button variant="secondary" onClick={() => setDialog('assign')}>
                  {tenant.room_id ? 'Change room' : 'Assign room'}
                </Button>
 {tenant.room_id && (
                  <Button variant="secondary" onClick={() => setDialog('rent')}>
                    Rent &amp; due date
                  </Button>
                )}
                {tenant.room_id && (
                  <Button variant="secondary" className="text-red-600" onClick={() => setDialog('moveout')}>
                    Move out
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() =>
                    confirm.ask({
                      title: 'Reset password?',
                      message: `${tenant.name} will be logged out and must log in with a new temporary password.`,
                      confirmLabel: 'Reset password',
                      variant: 'primary',
                      onConfirm: async () => {
                        const d = await api(`/owner/tenants/${tenant.id}/reset-password`, { method: 'POST' });
                        setTempPassword(d.tempPassword);
                      },
                    })
                  }
                >
                  Reset password
                </Button>
              </>
            }
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Card title="Current room">
              {tenant.room_id ? (
                <div className="space-y-1 text-sm">
                  <p className="text-lg font-semibold">
                    {tenant.property_name} · {tenant.room_number}
                  </p>
                  <p>Since {formatDate(tenant.start_date)}</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Not currently staying.</p>
              )}
            </Card>
            <Card title="Rent & deposit">
              {tenant.room_id ? (
                <div className="space-y-1 text-sm">
                  <p className="text-lg font-semibold">{money(tenant.monthly_rent)} / month</p>
                  <p>Deposit: {money(tenant.deposit)}</p>
                  <p>Rent due on day {tenant.due_day} of each month</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">—</p>
              )}
            </Card>
            <Card title="Balance due">
              <p className={`text-lg font-semibold ${tenant.balance_due > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {money(tenant.balance_due)}
              </p>
              <Link to={`/owner/payments?period=&tenant_id=${tenant.id}`} className="text-sm text-indigo-600 hover:underline">
                Manage payments →
              </Link>
            </Card>
          </div>

          <Card title="Rent history">
            <Table
              rows={payments}
              empty="No rent charges yet."
              columns={[
                { key: 'period', label: 'Month', render: (p) => formatPeriod(p.period) },
                { key: 'amount_due', label: 'Due', render: (p) => money(p.amount_due) },
                { key: 'amount_paid', label: 'Paid', render: (p) => money(p.amount_paid) },
                { key: 'status', label: 'Status', render: (p) => <Badge status={p.status} /> },
                { key: 'paid_on', label: 'Last paid', render: (p) => formatDate(p.paid_on) },
              ]}
            />
          </Card>

          <Card title="Stay history">
            <Table
              rows={tenancies}
              empty="No stays yet."
              columns={[
                { key: 'room', label: 'Room', render: (t) => `${t.property_name} · ${t.room_number}` },
                { key: 'start', label: 'From', render: (t) => formatDate(t.start_date) },
                { key: 'end', label: 'To', render: (t) => formatDate(t.end_date) },
                { key: 'rent', label: 'Rent', render: (t) => money(t.monthly_rent) },
                { key: 'status', label: 'Status', render: (t) => <Badge status={t.status} /> },
              ]}
            />
          </Card>

          {dialog === 'edit' && <EditTenant tenant={tenant} onClose={() => setDialog(null)} onSaved={done} />}
          {dialog === 'assign' && <AssignRoom tenant={tenant} onClose={() => setDialog(null)} onSaved={done} />}
          {dialog === 'rent' && <EditRent tenant={tenant} onClose={() => setDialog(null)} onSaved={done} />}
          {dialog === 'moveout' && <MoveOut tenant={tenant} onClose={() => setDialog(null)} onSaved={done} />}
          <Modal open={Boolean(tempPassword)} title="New temporary password" onClose={() => setTempPassword(null)}>
            <SecretBox label={`Share this with ${tenant.name}:`} value={tempPassword || ''} />
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setTempPassword(null)}>Done</Button>
            </div>
          </Modal>
          {confirm.element}
        </div>
      )}
    </Async>
  );
}
