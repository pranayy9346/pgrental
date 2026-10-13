import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { homeFor, useAuth } from '../lib/auth.jsx';
import { Alert, Loading } from './ui.jsx';

const navs = {
  owner: [
    { to: '/owner', label: 'Dashboard', end: true },
    { to: '/owner/pg', label: '1. PG Details' },
    { to: '/owner/rooms', label: '2. Floors & Rooms' },
    { to: '/owner/tenants', label: '3. Tenants' },
    { to: '/owner/payments', label: 'Rent & Payments' },
    { to: '/owner/complaints', label: 'Complaints' },
    { to: '/owner/vacate-requests', label: 'Move-out Requests' },
    { to: '/owner/notices', label: 'Notices' },
    { to: '/owner/profile', label: 'My Account' },
  ],
  tenant: [
    { to: '/tenant', label: 'My Stay', end: true },
    { to: '/tenant/payments', label: 'My Payments' },
    { to: '/tenant/complaints', label: 'Complaints' },
    { to: '/tenant/vacate', label: 'Move Out' },
    { to: '/tenant/notices', label: 'Notices' },
    { to: '/tenant/profile', label: 'My Account' },
  ],
};

// Wraps every logged-in page. Redirects to /login if not logged in, and to the right dashboard
// if a user opens the other role's pages.
export default function Layout({ role }) {
  const { user, checking, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (checking) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;

  const profilePath = `/${role}/profile`;
  if (user.mustChangePassword && location.pathname !== profilePath) return <Navigate to={profilePath} replace />;

  const links = navs[role];
  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-lg font-bold text-indigo-700">PG Manager</p>
            <p className="text-xs text-slate-500">{role === 'owner' ? 'Owner dashboard' : 'Tenant portal'}</p>
          </div>
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm md:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            Menu
          </button>
        </div>
        <nav className={`${menuOpen ? 'block' : 'hidden'} space-y-1 px-3 pb-4 md:block`}>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <div className="mt-4 border-t border-slate-100 px-3 pt-4">
            <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <button onClick={logout} className="mt-3 text-sm font-medium text-red-600 hover:underline">
              Log out
            </button>
          </div>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        {user.mustChangePassword && (
          <div className="mb-6">
            <Alert tone="warning">You are using a temporary password. Please set a new password to continue.</Alert>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
