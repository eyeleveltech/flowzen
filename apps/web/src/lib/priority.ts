import { PRIORITY_CONFIG } from '@flowzen/shared';

export { PRIORITY_CONFIG };

export function getPriorityDot(priority?: string | null): string {
  if (!priority || !PRIORITY_CONFIG[priority]) {
    return 'bg-gray-300';
  }
  return PRIORITY_CONFIG[priority].dot;
}

export function getPriorityBadge(priority?: string | null): string {
  if (!priority || !PRIORITY_CONFIG[priority]) {
    return 'bg-gray-100 text-gray-600 border-gray-200';
  }
  return PRIORITY_CONFIG[priority].badge;
}

export function getPriorityColor(priority?: string | null): string {
  if (!priority || !PRIORITY_CONFIG[priority]) {
    return 'text-gray-400';
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
