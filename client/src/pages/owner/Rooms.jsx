import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Async, Badge, Button, Card, Empty, Field, FormModal, PageHeader, Table, useConfirm, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { floorLabel, money, roomStatusLabels } from '../../lib/format.js';

function RoomForm({ pg, room, defaultFloor = 0, onClose, onSaved }) {
  const form = useForm(
    {
      room_number: room?.room_number || '',
      floor: String(room?.floor ?? defaultFloor),
      capacity: String(room?.capacity ?? 2),
      monthly_rent: room?.monthly_rent ?? '',
      notes: room?.notes || '',
    },
    async (v) => {
      if (room) await api(`/owner/rooms/${room.id}`, { method: 'PATCH', body: v });
      else await api('/owner/pg/rooms', { method: 'POST', body: v });
      onSaved();
    },
  );
  const floors = Array.from({ length: pg.total_floors }, (_, i) => ({ value: String(i), label: floorLabel(i) }));
  return (
    <FormModal open title={room ? `Edit room ${room.room_number}` : 'Add room'} onClose={onClose} form={form}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field form={form} name="room_number" label="Room number" placeholder="e.g. 101" required />
        <Field form={form} name="floor" label="Floor" as="select" options={floors} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field form={form} name="capacity" label="Beds (capacity)" type="number" min="1" max="20" required />
        <Field form={form} name="monthly_rent" label="Rent per bed (₹ / month)" type="number" min="0" required />
      </div>
      <Field form={form} name="notes" label="Notes" placeholder="e.g. AC, attached bathroom" />
    </FormModal>
  );
}

function RoomStatus({ room }) {
  return (
    <div className="flex items-center gap-2">
      <Badge status={room.status}>{roomStatusLabels[room.status]}</Badge>
      <span className="text-xs text-slate-500">
        {room.occupied}/{room.capacity} beds
      </span>
    </div>
  );
}

// Step 2 of 3: PG Details -> Floors & Rooms -> Tenants
export default function Rooms() {
  const state = useApi('/owner/pg');
  const [form, setForm] = useState(null); // null | { room?, floor? }
  const confirm = useConfirm();

  return (
    <Async state={state}>
      {({ pg, rooms }) => {
        if (!pg) {
          return (
            <div className="space-y-4">
              <PageHeader title="Floors & Rooms" subtitle="Step 2 of 3" />
              <Alert tone="info">
                Set up your PG details first.{' '}
                <Link to="/owner/pg" className="font-semibold underline">
                  Go to PG Details
                </Link>
              </Alert>
            </div>
          );
        }
        const floors = Array.from({ length: pg.total_floors }, (_, i) => i);
        const beds = rooms.reduce((s, r) => s + r.capacity, 0);
        const filled = rooms.reduce((s, r) => s + r.occupied, 0);
        const reload = () => {
          setForm(null);
          state.reload();
        };

        return (
          <div className="space-y-6">
            <PageHeader
              title="Floors & Rooms"
              subtitle={`Step 2 of 3 · ${pg.name}: ${pg.total_floors} floor(s), ${rooms.length} room(s), ${filled}/${beds} beds filled`}
              actions={
                <>
                  <Link to="/owner/pg">
                    <span className="text-sm font-medium text-indigo-600 hover:underline">Change number of floors</span>
                  </Link>
                  <Button onClick={() => setForm({})}>+ Add room</Button>
                </>
              }
            />

            {rooms.length === 0 && (
              <Alert tone="info">
                Add rooms to each floor below. When you are done,{' '}
                <Link to="/owner/tenants?add=1" className="font-semibold underline">
                  continue to Tenants
                </Link>
                .
              </Alert>
            )}

            {floors.map((floor) => {
              const onFloor = rooms.filter((r) => r.floor === floor);
              return (
                <Card
                  key={floor}
                  title={`${floorLabel(floor)} · ${onFloor.length} room(s)`}
                  actions={
                    <Button size="sm" variant="secondary" onClick={() => setForm({ floor })}>
                      + Add room to this floor
                    </Button>
                  }
                >
                  {onFloor.length === 0 ? (
                    <Empty title="No rooms on this floor yet." />
                  ) : (
                    <Table
                      rows={onFloor}
                      columns={[
                        { key: 'room_number', label: 'Room', render: (r) => <b>{r.room_number}</b> },
                        { key: 'capacity', label: 'Beds', render: (r) => `${r.capacity}-sharing` },
                        { key: 'monthly_rent', label: 'Rent / bed', render: (r) => money(r.monthly_rent) },
                        { key: 'status', label: 'Availability', render: (r) => <RoomStatus room={r} /> },
                        {
                          key: 'tenants',
                          label: 'Tenants',
                          render: (r) =>
                            r.tenants.length ? (
                              r.tenants.map((t, i) => (
                                <span key={t.tenant_id}>
                                  {i > 0 && ', '}
                                  <Link to={`/owner/tenants/${t.tenant_id}`} className="text-indigo-600 hover:underline">
                                    {t.name}
                                  </Link>
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400">—</span>
                            ),
                        },
                        { key: 'notes', label: 'Notes', render: (r) => r.notes || '' },
                        {
                          key: 'actions',
                          label: '',
                          className: 'text-right whitespace-nowrap',
                          render: (r) => (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setForm({ room: r })}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:bg-red-50"
                                onClick={() =>
                                  confirm.ask({
                                    title: `Delete room ${r.room_number}?`,
                                    message: 'Rooms that have ever had a tenant cannot be deleted (their history is kept).',
                                    confirmLabel: 'Delete room',
                                    onConfirm: async () => {
                                      await api(`/owner/rooms/${r.id}`, { method: 'DELETE' });
                                      state.reload();
                                    },
                                  })
                                }
                              >
                                Delete
                              </Button>
                            </>
                          ),
                        },
                      ]}
                    />
                  )}
                </Card>
              );
            })}

            {rooms.length > 0 && (
              <div className="flex justify-end">
                <Link to="/owner/tenants?add=1">
                  <span className="text-sm font-medium text-indigo-600 hover:underline">Next: add Tenants →</span>
                </Link>
              </div>
            )}

            {form && (
              <RoomForm pg={pg} room={form.room} defaultFloor={form.floor ?? 0} onClose={() => setForm(null)} onSaved={reload} />
            )}
            {confirm.element}
          </div>
        );
      }}
    </Async>
  );
}
