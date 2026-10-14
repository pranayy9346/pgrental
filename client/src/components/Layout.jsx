import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { homeFor, useAuth } from '../lib/auth.jsx';
import { NotificationsProvider, useNotifications } from '../lib/notifications.jsx';
import { Alert, CountBadge, Icon, Loading } from './ui.jsx';

// Each group has an optional heading. Order inside "Setup" is the order an owner works through when starting out.
const navs = {
  owner: [
    { items: [{ to: '/owner', label: 'Dashboard', icon: 'dashboard', end: true }] },
    {
      heading: 'Setup',
      items: [
        { to: '/owner/pg', label: 'PG Details', icon: 'building' },
        { to: '/owner/rooms', label: 'Floors & Rooms', icon: 'layers' },
        { to: '/owner/tenants', label: 'Tenants', icon: 'users' },
      ],
    },
    {
      heading: 'Manage',
      items: [
        { to: '/owner/payments', label: 'Rent & Payments', icon: 'card' },
        { to: '/owner/complaints', label: 'Complaints', icon: 'message', badge: 'complaints' },
        { to: '/owner/vacate-requests', label: 'Move-out Requests', icon: 'logout', badge: 'moveout' },
        { to: '/owner/notices', label: 'Notices', icon: 'megaphone' },
      ],
    },
    { heading: 'Account', items: [{ to: '/owner/profile', label: 'My Account', icon: 'user' }] },
  ],
  tenant: [
    {
      items: [
        { to: '/tenant', label: 'My Stay', icon: 'home', end: true },
        { to: '/tenant/payments', label: 'My Payments', icon: 'card', badge: 'payments' },
        { to: '/tenant/complaints', label: 'Complaints', icon: 'message', badge: 'complaints' },
        { to: '/tenant/vacate', label: 'Move Out', icon: 'logout', badge: 'moveout' },
        { to: '/tenant/notices', label: 'Notices', icon: 'megaphone', badge: 'notices' },
      ],
    },
    { heading: 'Account', items: [{ to: '/tenant/profile', label: 'My Account', icon: 'user' }] },
  ],
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    onChange();
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const initials = (name) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

// Red count beside a menu item (nothing is shown at 0).
function NavCount({ category }) {
  const { summary } = useNotifications();
  const count = summary?.[category] ?? 0;
  if (!count) return null;
  return (
    <span className="ml-auto">
      <CountBadge count={count} />
    </span>
  );
}

// The notification bell: links to the notification center and carries the total unread count.
function Bell({ role, className = '' }) {
  const { summary, available } = useNotifications();
  if (!available) return null;
  const total = summary?.total ?? 0;
  return (
    <NavLink
      to={`/${role}/notifications`}
      aria-label={total ? `Notifications, ${total > 99 ? 'more than 99' : total} unread` : 'Notifications'}
      className={({ isActive }) =>
        `relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
          isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
        } ${className}`
      }
    >
      <Icon name="bell" className="h-6 w-6" />
      {total > 0 && <CountBadge count={total} announce={false} className="absolute -right-0.5 -top-0.5 ring-2 ring-white" />}
    </NavLink>
  );
}

// Tells screen-reader users when the number of unread notifications goes up (not on first load).
function Announcer() {
  const { announcement } = useNotifications();
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}

function Brand({ role }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
        <Icon name="building" className="h-5 w-5" />
      </span>
      <div className="leading-tight">
        <p className="text-base font-bold text-slate-900">PG Manager</p>
        <p className="text-xs text-slate-500">{role === 'owner' ? 'Owner dashboard' : 'Tenant portal'}</p>
      </div>
    </div>
  );
}

// Wraps every logged-in page. Redirects to /login if not logged in, and to the right dashboard
// if a user opens the other role's pages.
export default function Layout({ role }) {
  const { user, checking, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // The drawer closes on navigation, on Escape, and the page behind it does not scroll while it is open.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);
  useEffect(() => {
    if (isDesktop) setMenuOpen(false);
  }, [isDesktop]);

  if (checking) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;

  const profilePath = `/${role}/profile`;
  if (user.mustChangePassword && location.pathname !== profilePath) return <Navigate to={profilePath} replace />;

  const groups = navs[role];
  const drawerHidden = !isDesktop && !menuOpen;
  return (
    <NotificationsProvider key={user.id}>
    <div className="min-h-dvh md:flex">
      <Announcer />
      {/* Phone / small tablet: top bar with the menu button */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
        >
          <Icon name="menu" className="h-6 w-6" />
        </button>
        <p className="text-base font-bold text-slate-900">PG Manager</p>
        <Bell role={role} className="-mr-2" />
      </header>

      {menuOpen && <div className="fixed inset-0 z-40 bg-slate-900/50 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <aside
        id="app-sidebar"
        inert={drawerHidden}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-slate-200 bg-white transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-dvh md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 ${menuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between px-5 py-5">
          <Brand role={role} />
          <Bell role={role} className="-mr-2 max-md:hidden" />
          <button
            type="button"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 px-3 pb-4">
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.heading && <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{group.heading}</p>}
              <div className="space-y-0.5">
                {group.items.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    end={l.end}
                    className={({ isActive }) =>
                      `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon name={l.icon} className={`h-5 w-5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                        {l.label}
                        {l.badge && <NavCount category={l.badge} />}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700" aria-hidden="true">
              {initials(user.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <Icon name="logout" className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
          {user.mustChangePassword && (
            <div className="mb-6">
              <Alert tone="warning">You are using a temporary password. Please set a new password to continue.</Alert>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
    </NotificationsProvider>
  );
}
