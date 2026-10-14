'use client';

/**
 * Follow-ups, on the owner's My Work (Sales next step plan, decision 5).
 *
 * Their own open deals and active leads whose next step is due today, already
 * overdue (in red), or tomorrow. There is no bell for an overdue next step —
 * this list is where the owner sees it, and Log touch is right here, so
 * following up and recording it are one step.
 *
 * Shown only when there is something in it: most people sell nothing, and an
 * empty "Follow-ups" box on their My Work would be noise.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageSquarePlus } from 'lucide-react';
import { api, type FollowUpItem } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/utils';
import { LogTouchModal, type SalesTarget } from './SalesDialogs';
import { stepDate } from './NextStep';

export const followUpsKey = ['follow-ups'] as const;

const when = (f: FollowUpItem, today: string) => {
  if (f.overdue) return `was due ${stepDate(f.date)}`;
  if (f.dueToday) return 'today';
  return f.date > today ? 'tomorrow' : stepDate(f.date);
};

export function FollowUps() {
  const { data, refetch } = useQuery({ queryKey: followUpsKey, queryFn: () => api.followUps.list() });
  const [touching, setTouching] = useState<SalesTarget | null>(null);
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  const today = data?.today ?? '';
  const overdue = items.filter((i) => i.overdue).length;

  return (
    <Card padding="none" className="overflow-hidden">
      <CardHeader>
        <CardTitle>Follow-ups</CardTitle>
        <p className="text-micro text-secondary">
          {plural(items.length, 'next step')} due by tomorrow{overdue ? ` · ${overdue} overdue` : ''}
        </p>
      </CardHeader>
      <ul className="divide-y divide-border">
        {items.map((f) => (
          <li key={`${f.kind}-${f.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
            <span className="w-11 shrink-0 text-micro font-semibold uppercase tracking-[0.04em] text-secondary">
              {f.kind === 'DEAL' ? 'Deal' : 'Lead'}
            </span>
            <div className="min-w-0 flex-1">
              <Link href={f.link} className="text-sm font-semibold text-primary hover:underline">
                {f.name}
              </Link>
              <p className="truncate text-xs text-body">{f.nextStep ?? 'No next step written'}</p>
            </div>
            <span className={`text-xs whitespace-nowrap ${f.overdue ? 'font-semibold text-danger' : f.dueToday ? 'font-semibold text-primary' : 'text-secondary'}`}>
              {when(f, today)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={MessageSquarePlus}
              onClick={() =>
                setTouching({ kind: f.kind, id: f.id, name: f.name, nextStep: f.nextStep, nextStepDate: f.date })
              }
            >
              Log touch
            </Button>
          </li>
        ))}
      </ul>
      {touching && (
        <LogTouchModal
          target={touching}
          onClose={() => setTouching(null)}
          onDone={() => {
            setTouching(null);
            void refetch();
          }}
        />
      )}
    </Card>
  );
}
