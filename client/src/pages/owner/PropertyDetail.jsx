import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Async, Badge, Button, Card, Field, FormModal, PageHeader, Table, useConfirm, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PropertyForm } from './Properties.jsx';

function RoomForm({ propertyId, room, onClose, onSaved }) {
  const form = useForm(
    {
      room_number: room?.room_number || '',
      capacity: room?.capacity ?? 1,
      monthly_rent: room?.monthly_rent ?? '',
      notes: room?.notes || '',
    },
    async (v) => {
      if (room) await api(`/owner/rooms/${room.id}`, { method: 'PATCH', body: v });
      else await api(`/owner/properties/${propertyId}/rooms`, { method: 'POST', body: v });
      onSaved();
    },
  );
  return (
    <FormModal open title={room ? `Edit room ${room.room_number}` : 'Add room'} onClose={onClose} form={form}>
      <Field form={form} name="room_number" label="Room number / name" placeholder="e.g. 101" required />
      <div className="grid grid-cols-2 gap-4">
        <Field form={form} name="capacity" label="Beds (sharing)" type="number" min="1" max="20" required />
        <Field form={form} name="monthly_rent" label="Rent per bed (₹ / month)" type="number" min="0" required />
      </div>
      <Field form={form} name="notes" label="Notes" placeholder="e.g. AC, attached bathroom" />
    </FormModal>
  );
}

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const state = useApi(`/owner/properties/${id}`);
  const [editingProperty, setEditingProperty] = useState(false);
  const [roomForm, setRoomForm] = useState(null); // null | { room?: object }
  const confirm = useConfirm();

  return (
    <Async state={state}>
      {({ property, rooms }) => {
        const beds = rooms.reduce((s, r) => s + r.capacity, 0);
        const filled = rooms.reduce((s, r) => s + r.occupied, 0);
        return (
          <div className="space-y-6">
            <Link to="/owner/properties" className="text-sm text-indigo-600 hover:underline">
              ← All properties
            </Link>
            <PageHeader
              title={property.name}
              subtitle={`${property.address}, ${property.city}`}
              actions={
                <>
                  <Button variant="secondary" onClick={() => setEditingProperty(true)}>
                    Edit property
                  </Button>
                  <Button
                    variant="secondary"
                    className="text-red-600"
                    onClick={() =>
                      confirm.ask({
                        title: 'Delete property?',
                        message: `This permanently deletes "${property.name}". Only properties without rooms can be deleted.`,
                        confirmLabel: 'Delete',
                        onConfirm: async () => {
                          await api(`/owner/properties/${property.id}`, { method: 'DELETE' });
                          navigate('/owner/properties');
                        },
                      })
                    }
                  >
                    Delete
                  </Button>
                </>
              }
            />
            {property.description && <p className="text-sm text-slate-600">{property.description}</p>}

            <Card
              title={`Rooms (${rooms.length}) · ${filled}/${beds} beds filled`}
              actions={
                <Button size="sm" onClick={() => setRoomForm({})}>
                  + Add room
                </Button>
              }
            >
              <Table
                rows={rooms}
                empty="No rooms yet. Add a room to start assigning tenants."
                columns={[
                  { key: 'room_number', label: 'Room', render: (r) => <b>{r.room_number}</b> },
                  { key: 'capacity', label: 'Beds', render: (r) => `${r.capacity}-sharing` },
                  { key: 'monthly_rent', label: 'Rent / bed', render: (r) => money(r.monthly_rent) },
                  {
                    key: 'occupancy',
                    label: 'Occupancy',
                    render: (r) =>
                      r.occupied >= r.capacity ? (
                        <Badge status="ended">Full</Badge>
                      ) : (
                        <Badge status="active">{r.capacity - r.occupied} vacant</Badge>
                      ),
                  },
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
                        <Button size="sm" variant="ghost" onClick={() => setRoomForm({ room: r })}>
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
            </Card>

            {editingProperty && (
              <PropertyForm
                property={property}
                onClose={() => setEditingProperty(false)}
                onSaved={() => {
                  setEditingProperty(false);
                  state.reload();
                }}
              />
            )}
            {roomForm && (
              <RoomForm
                propertyId={property.id}
                room={roomForm.room}
                onClose={() => setRoomForm(null)}
                onSaved={() => {
                  setRoomForm(null);
                  state.reload();
                }}
              />
            )}
            {confirm.element}
          </div>
        );
      }}
    </Async>
  );
}
