import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { format } from 'date-fns';

import { ROLE_LABELS } from '@flowzen/shared';

/**
 * tailwind-merge, taught about this app's own type step.
 *
 * `--text-micro` is a real Tailwind v4 theme token, so `text-micro` is a real
 * font-size utility — but tailwind-merge works off a built-in table, not the
 * stylesheet, and `text-` is ambiguous: it prefixes both sizes and colours.
 * Not recognising `micro` as a size, it filed it as a COLOUR, then dropped it
 * as a conflict the moment a real colour followed.
 *
 * `<Badge tone="info">` was the visible case — `text-micro … text-info`
 * merged down to `text-info` alone, and the pill fell back to the
 * inherited 16px instead of 11. Every `cn()` call that pairs the two was
 * silently doing the same thing.
 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['micro'] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getRoleLabel(role?: string | null): string {
  if (!role) return '—';
  return ROLE_LABELS[role] || role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function safeDate(date: string | Date | number | null | undefined): Date | null {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d;
}

export function toDateInput(date: string | Date | number | null | undefined): string {
  if (!date) return '';
  const d = safeDate(date);
  if (!d) return '';
  return format(d, 'yyyy-MM-dd');
}

export function formatDate(date: string | Date | number | null | undefined): string {
  const d = safeDate(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

// Short date with no year, e.g. "Jun 20" (short month + day). Used for compact due-date display.
export function formatShortDate(date: string | Date | number | null | undefined): string {
  const d = safeDate(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export function formatDateTime(date: string | Date | number | null | undefined): string {
  const d = safeDate(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatTime(date: string | Date | number | null | undefined): string {
  const d = safeDate(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatRelativeDate(date: string | Date | number | null | undefined): string {
  const d = safeDate(date);
  if (!d) return '—';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(d);
}

// Maps ISO 4217 currency codes to their most natural locale for Intl.NumberFormat formatting.
const CURRENCY_LOCALE: Record<string, string> = {
  INR: 'en-IN', USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB',
  AED: 'ar-AE', SGD: 'en-SG', AUD: 'en-AU', CAD: 'en-CA',
  MYR: 'ms-MY', LKR: 'si-LK', NPR: 'ne-NP', BDT: 'bn-BD',
  PKR: 'ur-PK', THB: 'th-TH', PHP: 'en-PH', IDR: 'id-ID', VND: 'vi-VN',
};

export function formatCurrency(value: number | null | undefined, currency = 'INR'): string {
  if (value == null) return '—';
  const locale = CURRENCY_LOCALE[currency] ?? 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCurrencyCompact(value: number | null | undefined, currency = 'INR'): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '- ' : '';

  // Indian Lakh/Crore notation only applies to INR
  if (currency === 'INR') {
    if (abs >= 1_00_00_000) {
      const cr = value / 1_00_00_000;
      if (abs >= 1_00_00_00_000) return `${sign}₹${Math.round(cr)} Cr`;
      return `${sign}₹${cr.toFixed(2)} Cr`;
    }
    if (abs >= 1_00_000) return `${sign}₹${(value / 1_00_000).toFixed(1)} L`;
    return `${sign}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  // Other currencies: use Intl compact notation (K / M)
  const locale = CURRENCY_LOCALE[currency] ?? 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function getInitials(name: string): string {
  if (!name) return '??';
  const cleanName = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!cleanName) return '??';
  const words = cleanName.split(' ').filter(Boolean);
  // A one-word name gets its first two letters, not one.
  //
  // Names used to arrive as "Vikram (Developer)", so every avatar had a second
  // word to take a letter from and this returned "VD". With the job title
  // moved to its own column the names are single words, and first-letter-only
  // turned the whole team into "P", "T", "V", "J" — an avatar that no longer
  // tells two people apart.
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Avatar tint — one colour, for everybody: the brand gold (--color-accent),
 * white initials on top. Matches the prototype's own PERSON column swatch
 * (EYELEVEL_OS_HANDOFF/prototype/01_APPLICATION_UI.html) rather than the
 * neutral grey this used to be — the grey read as unstyled next to the rest
 * of the app once the gold accent was introduced elsewhere.
 *
 * Still one pairing for every name, not a per-person hash: initials already
 * say who someone is, so the swatch doesn't need to carry identity too, and a
 * single colour stays out of the way of status colours (a red "Overdue"
 * badge next to a red avatar was the failure mode a hashed palette used to
 * produce).
 *
 * `name` is kept in the signature so the ~67 call sites stay untouched, and so a future
 * per-person treatment (a photo, say) has somewhere to hook in.
 */
const AVATAR_CLASSES = 'bg-accent text-white';

export function getAvatarColor(_name?: string): string {
  return AVATAR_CLASSES;
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
  // The hidden "Internal" account holds an org's own projects. Show it as "Internal · <Org>"
  // (company holds the org name) so people can tell an internal project from client work.
  if (client.name === 'Internal') return client.company ? `Internal · ${client.company}` : 'Internal';
  return client.company || client.name;
}

/** True for the hidden per-org "Internal" account that own-organization projects file under. */
export function isInternalClient(client: { name?: string | null; engagementType?: string | null } | null | undefined): boolean {
  return !!client && (client.name === 'Internal' || client.engagementType === 'INTERNAL');
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
  // Use the most recent deal's stage if available, otherwise fall back to client.status.
  // `leads` is an array now — one account can have been won more than once.
  const stageOrStatus = client.leads?.[0]?.stage || client.lead?.stage || client.status;
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
    default:
      // Pre-win pipeline stages (NEW_LEAD … NEGOTIATION) land here. A client status never does
      // any more — every one of the four is handled above.
      return 'PLANNING';
  }
}

export type ProjectHealth = 'GREEN' | 'AMBER' | 'RED';

export const PROJECT_HEALTH_CONFIG: Record<ProjectHealth, { color: string; label: string }> = {
  GREEN: { color: 'bg-success-tint text-success border-success/30', label: 'On Track' },
  AMBER: { color: 'bg-warning-tint text-warning-ink border-warning/30', label: 'At Risk' },
  RED: { color: 'bg-danger-tint text-danger border-danger/30', label: 'Off Track' },
};

export function computeProjectHealth(
  overdueTasksCount: number,
  endDate: string | Date | null | undefined,
  status: string
): ProjectHealth {
  const todayStart = new Date();
  if (overdueTasksCount >= 3 || (endDate && new Date(endDate) < todayStart && status !== 'COMPLETED')) {
    return 'RED';
  }
  if (overdueTasksCount >= 1) {
    return 'AMBER';
  }
  return 'GREEN';
}

/**
 * A stored instant, split into the date and time inputs a form shows.
 *
 * Both halves are read in the SAME clock. The task panel used to take the date
 * from `iso.slice(0, 10)` — which is UTC — and the time from `toTimeString()`,
 * which is local. In Asia/Kolkata a task due 20:00 UTC showed "22 Aug" beside
 * "01:30", two readings of one instant five and a half hours apart. Saving the
 * form recombined them and moved the due date nineteen and a half hours
 * backwards, without anybody editing anything.
 *
 * Midnight comes back as no time at all, because a task due "22 August" has no
 * meaningful hour and inventing one puts a number in the box that the user never
 * typed.
 */
export function splitLocalDateTime(value: string | Date | null | undefined): {
  date: string;
  time: string;
} {
  const d = safeDate(value);
  if (!d) return { date: '', time: '' };

  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const midnight = d.getHours() === 0 && d.getMinutes() === 0;

  return { date, time: midnight ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * The date and time inputs, back into one instant.
 *
 * Built field by field through the local Date constructor rather than by parsing
 * `"2026-08-22"`, which the language reads as UTC midnight — so `setHours` on the
 * result landed on the previous day for every reader west of Greenwich.
 *
 * No time means local midnight, which is what "due on the 22nd" means.
 */
export function joinLocalDateTime(date: string, time: string): string | null {
  if (!date) return null;

  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;

  const [hh, mm] = time ? time.split(':').map(Number) : [0, 0];
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).toISOString();
}

/**
 * A count and its noun, agreeing.
 *
 * "across 1 tasks" was live on My Work — the first screen everybody opens. It
 * was one of thirteen places that interpolated a number in front of a hardcoded
 * plural, and the app already got it right in a few others by writing the
 * ternary out longhand:
 *
 *     `${n} retainer${n === 1 ? '' : 's'}`
 *
 * So the convention existed and simply was not reachable. This is it, named.
 *
 *     plural(1, 'task')             -> "1 task"
 *     plural(3, 'task')             -> "3 tasks"
 *     plural(2, 'company', 'companies') -> "2 companies"
 *
 * Pass the irregular plural where -s is wrong; English has too many of those to
 * infer, and guessing is how you get "companys".
 */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}
