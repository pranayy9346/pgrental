const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const money = (n) => rupees.format(n || 0);

export function formatDate(value) {
  if (!value) return '—';
  // Dates from SQLite are 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' (UTC).
  const d = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(`${value.replace(' ', 'T')}Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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
