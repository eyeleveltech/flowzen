'use client';

/**
 * My Department's header: the department, its day in one sentence, and the
 * team — each face opens that person's panel.
 *
 * Forest green, the sidebar's own colour, with the brand gold down its edge:
 * the one place on the page that is not white, so the eye starts here. The
 * sentence counts each task once, however many of the team share it, and says
 * "nothing overdue" rather than printing a zero.
 */

import type { DepartmentOverview } from '@/lib/api-v2';
import { Select } from '@/components/ui/select';
import { getInitials, plural } from '@/lib/utils';

/** The team's day, in one line: "16 open tasks · 7 overdue · 2 on hold · 3 done this week". */
export function daySentence(overview: DepartmentOverview): { text: string; tone: 'calm' | 'late' }[] {
  const union = (key: keyof DepartmentOverview['people'][number]['lists']) =>
    new Set(overview.people.flatMap((p) => p.lists[key])).size;
  const open = union('open');
  const overdue = union('overdue');
  const waiting = union('waiting');
  const inReview = union('inReview');
  const done = union('doneThisWeek');
  return [
    { text: plural(open, 'open task'), tone: 'calm' as const },
    overdue ? { text: `${overdue} overdue`, tone: 'late' as const } : { text: 'nothing overdue', tone: 'calm' as const },
    waiting ? { text: `${waiting} on hold`, tone: 'calm' as const } : null,
    inReview ? { text: `${inReview} in review`, tone: 'calm' as const } : null,
    done ? { text: `${done} done this week`, tone: 'calm' as const } : null,
  ].filter((x): x is { text: string; tone: 'calm' | 'late' } => Boolean(x));
}

export function DepartmentHeader({
  overview,
  choices,
  departmentId,
  onSwitch,
  onOpenPerson,
}: {
  overview: DepartmentOverview;
  /** The departments this person may switch between — more than one shows the switcher. */
  choices: { id: string; name: string }[];
  departmentId: string;
  onSwitch: (id: string) => void;
  onOpenPerson: (id: string) => void;
}) {
  const { department } = overview;
  const day = daySentence(overview);
  const dateLine = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${overview.today}T00:00:00Z`),
  );

  return (
    <header className="relative overflow-hidden rounded-card bg-primary text-white">
      {/* The gold edge: the brand's mark, and where the eye lands first. */}
      <span className="absolute inset-y-0 left-0 w-1 bg-accent" aria-hidden="true" />
      <div className="flex flex-col gap-5 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-white/55">{dateLine}</p>
            <h2 className="mt-1 truncate text-3xl font-semibold tracking-[-0.02em]">{department.name}</h2>
            <p className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-sm text-white/75">
              {day.map((part, i) => (
                <span key={part.text} className="whitespace-nowrap">
                  {i > 0 && <span className="mr-2 text-white/30" aria-hidden="true">·</span>}
                  <span className={part.tone === 'late' ? 'font-semibold text-[#f2c879]' : undefined}>{part.text}</span>
                </span>
              ))}
            </p>
          </div>
          {choices.length > 1 && (
            <div className="w-full sm:w-56">
              <Select
                ariaLabel="Which department"
                value={departmentId}
                onChange={onSwitch}
                options={choices.map((d) => ({ value: d.id, label: d.name }))}
              />
            </div>
          )}
        </div>

        {/* The team: a face each, in name order — never by any number. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-white/10 pt-4">
          {overview.people.length === 0 ? (
            <p className="text-sm text-white/70">Nobody is in {department.name} yet. People are placed in Settings → Departments.</p>
          ) : (
            overview.people.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenPerson(p.id)}
                className="group/face flex items-center gap-2.5 rounded-full py-0.5 pl-0.5 pr-3 text-left outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-micro font-bold text-white ring-1 ring-white/25">
                  {getInitials(p.name)}
                  {/* They have said what they are on — the only thing this dot means. */}
                  {p.nowTaskId && (
                    <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-[#7fcf9f] ring-2 ring-primary" title="Has said what they're working on" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium leading-tight">{p.name}</span>
                  <span className="block truncate text-micro leading-tight text-white/55">
                    {p.id === department.headId ? 'Head' : p.designation || 'Team'}
                  </span>
                </span>
              </button>
            ))
          )}
          {!department.headName && <span className="text-micro text-white/55">No head set</span>}
        </div>
      </div>
    </header>
  );
}
