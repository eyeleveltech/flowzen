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
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
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

export function getAvatarColor(name: string): string {
  return 'bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB]';
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
