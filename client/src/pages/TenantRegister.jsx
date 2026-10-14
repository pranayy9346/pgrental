import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Alert, Button, Field, useForm } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { homeFor, useAuth } from '../lib/auth.jsx';
import { AuthShell } from './Login.jsx';

// The owner's registration link looks like /register/tenant#email=...&code=... . The part after '#' never leaves the
// browser, and it is removed from the address bar straight away so the code does not linger in history or on screen.
function takeInviteFromLink() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.has('code') || params.has('email')) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return { email: params.get('email') || '', invite_code: params.get('code') || '' };
}

// Tenants create their account with the email their PG owner added, the invite code the owner gave them, and a
// password of their choice.
export default function TenantRegister() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [fromLink] = useState(takeInviteFromLink);

  const form = useForm({ ...fromLink, password: '', confirm: '' }, async (v) => {
    if (v.password !== v.confirm) {
      throw Object.assign(new Error('Please correct the highlighted fields'), { details: { confirm: 'Passwords do not match' } });
    }
    const d = await api('/auth/tenant/register', {
      method: 'POST',
      body: { email: v.email, invite_code: v.invite_code, password: v.password },
    });
    setUser(d.user);
    navigate('/tenant', { replace: true });
  });

  if (user) return <Navigate to={homeFor(user)} replace />;

  return (
    <AuthShell title="Tenant registration" subtitle="Use the email address and the invite code your PG owner gave you, and choose a password.">
      <form onSubmit={form.handleSubmit} className="space-y-4" noValidate>
        <Alert>{form.error}</Alert>
        <Field form={form} name="email" label="Email" type="email" autoComplete="email" required />
        <Field
          form={form}
          name="invite_code"
          label="Invite code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-EFGH-JK23"
          hint="12 letters and numbers from your PG owner. It works once and expires after 7 days."
          required
        />
        <Field
          form={form}
          name="password"
          label="Choose a password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters"
          required
        />
        <Field form={form} name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
        <Button type="submit" className="w-full" loading={form.submitting}>
          Create my account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
