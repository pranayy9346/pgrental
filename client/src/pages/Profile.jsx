import { useState } from 'react';
import { Alert, Button, Card, Field, PageHeader, useForm } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

// "My Account" page, shared by owners and tenants.
export default function Profile() {
  const { user, setUser } = useAuth();
  const [saved, setSaved] = useState('');

  const profile = useForm({ name: user.name, phone: user.phone || '' }, async (v) => {
    setSaved('');
    const d = await api('/auth/profile', { method: 'PATCH', body: v });
    setUser(d.user);
    setSaved('profile');
  });

  const pw = useForm({ currentPassword: '', newPassword: '', confirm: '' }, async (v) => {
    setSaved('');
    if (v.newPassword !== v.confirm) {
      throw Object.assign(new Error('Please correct the highlighted fields'), {
        details: { confirm: 'Passwords do not match' },
      });
    }
    await api('/auth/change-password', {
      method: 'POST',
      body: { currentPassword: v.currentPassword, newPassword: v.newPassword },
    });
    pw.reset();
    setUser({ ...user, mustChangePassword: false });
    setSaved('password');
  });

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="My Account" subtitle={user.email} />

      <Card title="Change password">
        <form onSubmit={pw.handleSubmit} className="space-y-4" noValidate>
          <Alert>{pw.error}</Alert>
          {saved === 'password' && <Alert tone="success">Password changed. Other devices have been logged out.</Alert>}
          <Field form={pw} name="currentPassword" label={user.mustChangePassword ? 'Temporary password' : 'Current password'} type="password" autoComplete="current-password" required />
          <Field form={pw} name="newPassword" label="New password" type="password" autoComplete="new-password" hint="At least 8 characters" required />
          <Field form={pw} name="confirm" label="Confirm new password" type="password" autoComplete="new-password" required />
          <Button type="submit" loading={pw.submitting}>
            Change password
          </Button>
        </form>
      </Card>

      {!user.mustChangePassword && (
        <Card title="Profile details">
          <form onSubmit={profile.handleSubmit} className="space-y-4" noValidate>
            <Alert>{profile.error}</Alert>
            {saved === 'profile' && <Alert tone="success">Profile saved.</Alert>}
            <Field form={profile} name="name" label="Full name" required />
            <Field form={profile} name="phone" label="Phone" type="tel" />
            <p className="text-xs text-slate-500">
              {user.role === 'tenant'
                ? 'To change your email address, please contact your PG owner.'
                : 'Your email address is used to log in.'}
            </p>
            <Button type="submit" loading={profile.submitting}>
              Save profile
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
