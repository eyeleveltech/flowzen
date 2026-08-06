import { PRIORITY_CONFIG } from '@flowzen/shared';

export { PRIORITY_CONFIG };

// Fallbacks use the theme tokens rather than Tailwind's gray-*, so an unknown priority looks like
// the rest of the app instead of introducing a fifth grey that nothing else uses.
export function getPriorityDot(priority?: string | null): string {
  if (!priority || !PRIORITY_CONFIG[priority]) {
    return 'bg-line';
  }
  return PRIORITY_CONFIG[priority].dot;
}

export function getPriorityBadge(priority?: string | null): string {
  if (!priority || !PRIORITY_CONFIG[priority]) {
    return 'bg-surface text-secondary border-border';
  }
  return PRIORITY_CONFIG[priority].badge;
}

export function getPriorityColor(priority?: string | null): string {
  if (!priority || !PRIORITY_CONFIG[priority]) {
    return 'text-secondary';
  }
  return PRIORITY_CONFIG[priority].color;
}

export function getPriorityLabel(priority?: string | null): string {
  if (!priority) return '—';
  if (PRIORITY_CONFIG[priority]) {
    return PRIORITY_CONFIG[priority].label;
  }
  return priority.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
