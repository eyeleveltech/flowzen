'use client';

import { useTeamScope } from '@/hooks/queries';
import { cn } from '@/lib/utils';

/**
 * Whose people a Head is looking at, on Team and All work:
 * "Showing Video (12 people). Management sees everyone."
 *
 * A Head sees the departments they lead and nothing else, so a list that is
 * shorter than the studio says why. Nothing at all for anybody whose view is
 * not limited.
 */
export function TeamScopeLine({ className }: { className?: string }) {
  const scope = useTeamScope();
  if (!scope || scope.all) return null;

  const parts = scope.departments.map(
    (d) => `${d.name} (${d.peopleCount} ${d.peopleCount === 1 ? 'person' : 'people'})`,
  );
  const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return <p className={cn('text-xs text-secondary', className)}>Showing {list}. Management sees everyone.</p>;
}
