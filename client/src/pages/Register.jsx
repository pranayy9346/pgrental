import { Link, Navigate, useNavigate } from 'react-router';
import { Alert, Button, Field, useForm } from '../components/ui.jsx';
import { homeFor, useAuth } from '../lib/auth.jsx';
import { AuthShell } from './Login.jsx';

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const form = useForm({ name: '', email: '', phone: '', password: '', confirm: '' }, async (v) => {
    if (v.password !== v.confirm) {
      throw Object.assign(new Error('Please correct the highlighted fields'), {
        details: { confirm: 'Passwords do not match' },
      });
    }
    await register({ name: v.name, email: v.email, phone: v.phone, password: v.password });
    navigate('/owner', { replace: true });
  });

  if (user) return <Navigate to={homeFor(user)} replace />;

  return (
    <AuthShell title="Create owner account" subtitle="Manage your PGs, rooms, tenants and rent in one place.">
      <form onSubmit={form.handleSubmit} className="space-y-4" noValidate>
        <Alert>{form.error}</Alert>
        <Field form={form} name="name" label="Full name" autoComplete="name" required />
        <Field form={form} name="email" label="Email" type="email" autoComplete="email" required />
        <Field form={form} name="phone" label="Phone" type="tel" autoComplete="tel" hint="Shown to your tenants" />
        <Field form={form} name="password" label="Password" type="password" autoComplete="new-password" hint="At least 8 characters" required />
        <Field form={form} name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
        <Button type="submit" className="w-full" loading={form.submitting}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
