const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const money = (n) => rupees.format(n || 0);

// Text of the red unread counter: the number, or "99+" above 99 (the badge itself is hidden at 0).
export const badgeText = (count) => (count > 99 ? '99+' : String(count));

export function formatDate(value) {
  if (!value) return '—';
  // Dates from SQLite are 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' (UTC).
  const d = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(`${value.replace(' ', 'T')}Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Timestamps are stored in UTC ('YYYY-MM-DD HH:MM:SS'); the business runs on India time, so show them in IST.
const IST = 'Asia/Kolkata';
const parseStamp = (value) => new Date(`${value.replace(' ', 'T')}Z`);

export function formatDateTime(value) {
  if (!value) return '—';
  return `${parseStamp(value).toLocaleString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} IST`;
}

// "just now", "5 min ago", "3 h ago", "2 d ago", then the date (IST). `now` is a parameter so it can be tested.
export function timeAgo(value, now = Date.now()) {
  if (!value) return '';
  const seconds = Math.max(0, Math.round((now - parseStamp(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} d ago`;
  return parseStamp(value).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatPeriod(period) {
  if (!period) return '—';
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export const thisPeriod = () => todayISO().slice(0, 7);

export const labels = {
  pending: 'Pending',
  partial: 'Part paid',
  paid: 'Paid',
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  active: 'Active',
  ended: 'Ended',
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  other: 'Other',
};

export const complaintCategories = ['electrical', 'plumbing', 'cleaning', 'internet', 'furniture', 'food', 'other'];
export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// Floor 0 is the ground floor: "Ground floor", "1st floor", "2nd floor", "3rd floor", "4th floor"...
export function floorLabel(n) {
  if (n === 0) return 'Ground floor';
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix} floor`;
}

export const roomStatusLabels = { vacant: 'Vacant', partial: 'Partly filled', full: 'Full' };
