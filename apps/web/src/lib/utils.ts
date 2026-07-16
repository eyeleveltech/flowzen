import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

// Short date with no year, e.g. "20 Jun" (day + short month name). Used for compact due-date display.
export function formatShortDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(date));
}

export function formatRelativeDate(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function getInitials(name: string): string {
  if (!name) return '??';
  const cleanName = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!cleanName) return '??';
  return cleanName
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_COLORS = [
  'bg-red-100 text-red-700', 'bg-orange-100 text-orange-700', 'bg-amber-100 text-amber-700',
  'bg-green-100 text-green-700', 'bg-teal-100 text-teal-700', 'bg-blue-100 text-blue-700',
  'bg-indigo-100 text-indigo-700', 'bg-purple-100 text-purple-700', 'bg-pink-100 text-pink-700',
];

export function getAvatarColor(name: string): string {
  if (!name) return 'bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB]';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function triggerHaptic(type: 'light' | 'medium' | 'heavy' = 'medium') {
  if (typeof window === 'undefined' || !navigator.vibrate) return;
  
  switch (type) {
    case 'light':
      navigator.vibrate(20);
      break;
    case 'medium':
      navigator.vibrate(40);
      break;
    case 'heavy':
      navigator.vibrate([40, 50, 40]);
      break;
  }
}

export function getClientDisplayName(client: { name: string, company?: string | null } | null | undefined): string {
  if (!client) return '—';
  if (client.name === 'Internal') return client.company || 'Internal';
  return client.company || client.name;
}

export function toProperCase(str: string): string {
  if (!str) return str;
  return str
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function getProjectStatusFromClient(client: any): 'PLANNING' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED' {
  if (!client) return 'PLANNING';
  // Use lead.stage first if available, otherwise fallback to client.status
  const stageOrStatus = client.lead?.stage || client.status;
  if (!stageOrStatus) return 'PLANNING';
  
  const normalized = stageOrStatus.toUpperCase();
  
  switch (normalized) {
    case 'ACTIVE':
    case 'ACTIVE_RETAINER':
    case 'ACTIVE_PROJECT':
      return 'IN_PROGRESS';
    case 'ONHOLD':
    case 'ON_HOLD':
      return 'ON_HOLD';
    case 'PROJECT_COMPLETED':
      return 'COMPLETED';
    case 'CHURNED':
      return 'CANCELLED';
    case 'PROSPECT':
    default:
      return 'PLANNING';
  }
}
