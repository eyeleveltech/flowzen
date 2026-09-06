import {
  ASSET_CATEGORY_LABEL,
  ASSET_CONDITION_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_USEFUL_LIFE,
  ASSET_BOOKABLE_BY_DEFAULT,
} from '@flowzen/shared';
import type { Tone } from '@/components/ui/badge';

export {
  ASSET_CATEGORY_LABEL,
  ASSET_CONDITION_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_USEFUL_LIFE,
  ASSET_BOOKABLE_BY_DEFAULT,
};

/**
 * An asset's status, in the tones the rest of the app already speaks.
 *
 * Deliberately the FIVE existing `Badge` tones and no sixth. A green pill means
 * "fine, nothing to do" on every screen in this product, and a module that
 * introduces its own purple to say "in repair" teaches people that a colour
 * means one thing here and something else two clicks away.
 *
 * The one distinction worth spending a tone on is ASSIGNED against BOOKED_OUT:
 * a laptop with a designer is settled, and a lens on a shoot has a clock
 * running on it. Those are not the same state and must not look alike.
 */
export const assetTone = (status: string): Tone => {
  switch (status) {
    case 'IN_STOCK':
      return 'good';
    case 'ASSIGNED':
      return 'info';
    case 'BOOKED_OUT':
      return 'warn';
    case 'LOST':
      return 'bad';
    // IN_REPAIR, RETIRED and SOLD are all "off the floor" — quiet, not alarming.
    default:
      return 'neutral';
  }
};

export const assetStatusLabel = (status: string): string =>
  ASSET_STATUS_LABEL[status] ?? status.replace(/_/g, ' ').toLowerCase();

export const assetCategoryLabel = (category: string): string =>
  ASSET_CATEGORY_LABEL[category] ?? category.replace(/_/g, ' ');

export const CATEGORY_OPTIONS = Object.keys(ASSET_CATEGORY_LABEL).map((value) => ({
  value,
  label: ASSET_CATEGORY_LABEL[value],
}));

export const CONDITION_OPTIONS = Object.keys(ASSET_CONDITION_LABEL).map((value) => ({
  value,
  label: ASSET_CONDITION_LABEL[value],
}));

export const STATUS_OPTIONS = Object.keys(ASSET_STATUS_LABEL).map((value) => ({
  value,
  label: ASSET_STATUS_LABEL[value],
}));

/**
 * Rupees, whole.
 *
 * A re-export, not a tenth implementation. There were nine hand-rolled copies
 * of this across the app and one of them blanked a page by calling
 * `.toLocaleString()` on a value the server had masked to null.
 */
export { formatMoney as rupees } from '@/lib/api-v2';

/** A date, short. Assets live for years, so the year is never dropped. */
export const shortDate = (value: string | null | undefined): string =>
  !value
    ? '—'
    : new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(value));

/** "3 days late" / "back tomorrow" — a due date said the way a person would. */
export const dueLabel = (dueAt: string | null | undefined): string => {
  if (!dueAt) return '—';
  const due = new Date(dueAt);
  const days = Math.floor((due.getTime() - Date.now()) / 86_400_000);
  if (days < -1) return `${Math.abs(days)} days late`;
  if (days === -1) return '1 day late';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
};
