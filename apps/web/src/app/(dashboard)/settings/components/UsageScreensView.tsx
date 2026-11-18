'use client';

/**
 * Settings → Usage → Screens (Ease Plan 3): the monthly usage review.
 *
 * Each screen, opened by how many people in the last 30 days out of how many
 * can open it — counts only, never names; the People view is where names are.
 * The screens to look at come first: nobody opened them, then under a third
 * of the people who can. Opening this closes the month's "Usage review is
 * ready" bell (the server does that as it answers).
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type UsageScreens } from '@/lib/api-v2';
import { ErrorNote } from '@/components/ui/empty-state';
import { SectionCard } from '@/components/ui/section-card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/table';

type Screen = UsageScreens['screens'][number];

const FLAG_ORDER = { NOBODY: 0, UNDER_A_THIRD: 1 } as const;

/** Worst first: the flags, then the lowest share of the people who can. */
export function screensInReviewOrder(screens: Screen[]): Screen[] {
  return screens
    .filter((s) => s.canOpen > 0)
    .sort((a, b) => {
      const fa = a.flag ? FLAG_ORDER[a.flag] : 2;
      const fb = b.flag ? FLAG_ORDER[b.flag] : 2;
      if (fa !== fb) return fa - fb;
      const share = a.openedBy / a.canOpen - b.openedBy / b.canOpen;
      return share !== 0 ? share : a.label.localeCompare(b.label);
    });
}

export function UsageScreensView() {
  return (
    <SectionCard
      title="Screens"
      description="How many people opened each screen in the last 30 days, out of how many can. Counts only — names are under People."
      bodyClassName="space-y-5"
    >
      <ScreensBody />
    </SectionCard>
  );
}

function ScreensBody() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['usage-screens'],
    queryFn: () => api.usage.screens(),
  });

  // The server closed the review's bell as it answered: bring the bell up to date.
  useEffect(() => {
    if (data?.success) void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }, [data, queryClient]);

  if (error) return <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the screens'}</ErrorNote>;
  if (isPending || !data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-8 w-2/3 animate-pulse rounded-lg bg-subtle" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-subtle" />
        ))}
      </div>
    );
  }

  const rows = screensInReviewOrder(data.screens);
  const nobody = rows.filter((s) => s.flag === 'NOBODY').length;
  const few = rows.filter((s) => s.flag === 'UNDER_A_THIRD').length;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-lg font-semibold text-primary tabular-nums">
          {nobody + few === 0
            ? `Every screen was opened by at least a third of the people who can, in the last ${data.days} days`
            : `${nobody + few} of ${rows.length} screens to look at`}
        </p>
        <p className="mt-0.5 text-xs text-secondary tabular-nums">
          {nobody} nobody opened · {few} under a third of the people who can · the last {data.days} days, counts only
        </p>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>Screen</TH>
            <TH numeric>Opened by</TH>
            <TH>&nbsp;</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((s) => (
            <TR key={s.key}>
              <TD className="font-medium text-primary">{s.label}</TD>
              <TD numeric>
                <span data-screen={s.key}>
                  {s.openedBy} of {s.canOpen}
                </span>
              </TD>
              <TD>
                {s.flag === 'NOBODY' ? (
                  <Badge tone="bad">Nobody opened this in {data.days} days</Badge>
                ) : s.flag === 'UNDER_A_THIRD' ? (
                  <Badge tone="warn">Under a third of the people who can</Badge>
                ) : null}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <p className="text-xs text-secondary">
        “Out of” counts everybody active today who can open the screen, by their permissions now. Screens nobody can
        open are left out.
      </p>
    </div>
  );
}
