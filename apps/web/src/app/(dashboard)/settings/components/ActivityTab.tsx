'use client';

/**
 * Everything that has happened in Flowzen, readable.
 *
 * Every write already leaves a row — who, what, when, and what changed. This
 * tab used to print the last hundred as "task deleted · Naif · Task", which
 * could not say which task, or go further back, or answer the questions people
 * actually bring here: who deleted ID CARD, what did Naif do this week, when
 * did the Carlton retainer stop, has anybody been trying Ramya's password.
 *
 * The server writes the sentence (services/activityLog.ts). This screen only
 * lays it out: a day at a time, newest first, narrowed by person, area, dates
 * or a search, with the older pages a click away.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Bot, Search, ShieldAlert, X } from 'lucide-react';
import { api, ApiError, type AuditEntry, type AuditFilters } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { Field, FieldSelect } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/empty-state';

const PAGE = 50;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** The calendar day an instant falls on, in the organisation's zone. */
const dayKeyIn = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );

export function ActivityTab({ tz, locale }: { tz: string; locale: string }) {
  const [person, setPerson] = useState('');
  const [area, setArea] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');

  // A search per keystroke is a query per keystroke; wait for a pause.
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const filters: AuditFilters = { actor: person, area, from, to, q, limit: PAGE };
  const filtered = Boolean(person || area || from || to || q);

  const { data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['audit-log', filters],
    queryFn: ({ pageParam }) => api.config.auditLog({ ...filters, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });

  const first = data?.pages[0];
  const entries = useMemo(() => data?.pages.flatMap((p) => p.entries) ?? [], [data]);

  // The filter lists come with the first page, so they are there before any
  // filter is set and stay put while one is.
  const [people, setPeople] = useState<{ value: string; label: string }[]>([]);
  const [areas, setAreas] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!first) return;
    if (people.length === 0) {
      setPeople([
        { value: '', label: 'Everyone' },
        { value: 'system', label: 'Flowzen (automatic)' },
        ...first.people.map((p) => ({ value: p.id, label: p.active ? p.name : `${p.name} (left)` })),
      ]);
    }
    if (areas.length === 0) {
      setAreas([{ value: '', label: 'Everything' }, ...first.areas.map((a) => ({ value: a.key, label: a.label }))]);
    }
  }, [first, people.length, areas.length]);

  const clear = () => {
    setPerson('');
    setArea('');
    setFrom('');
    setTo('');
    setTyped('');
    setQ('');
  };

  // Newest first, a heading for each day.
  const days = useMemo(() => {
    const out: { key: string; rows: AuditEntry[] }[] = [];
    for (const e of entries) {
      const key = dayKeyIn(e.at, tz);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(e);
      else out.push({ key, rows: [e] });
    }
    return out;
  }, [entries, tz]);

  const today = dayKeyIn(new Date().toISOString(), tz);
  const yesterday = dayKeyIn(new Date(Date.now() - 86_400_000).toISOString(), tz);
  const dayTitle = (key: string) => {
    const long = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(key.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' as const } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${key}T12:00:00Z`));
    return key === today ? `Today · ${long}` : key === yesterday ? `Yesterday · ${long}` : long;
  };
  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

  return (
    <SectionCard
      title="Activity"
      description="Everything that happens in Flowzen — who did it, when, and what changed. Read-only."
      aside={
        first ? (
          <span className="text-xs tabular-nums text-secondary">
            {first.total.toLocaleString(locale)} {filtered ? 'matching' : first.total === 1 ? 'event' : 'events'}
          </span>
        ) : null
      }
      bodyClassName="space-y-5"
    >
      {/* Narrowing it down */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          className="sm:col-span-2 lg:col-span-4"
          label="Search"
          value={typed}
          onChange={setTyped}
          placeholder="A task, client, invoice, person…"
          icon={<Search className="h-4 w-4" />}
        />
        <FieldSelect label="Who" value={person} onChange={setPerson} options={people} placeholder="Everyone" />
        <FieldSelect label="Area" value={area} onChange={setArea} options={areas} placeholder="Everything" />
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
      </div>
      {filtered && (
        <div className="-mt-2 flex justify-end">
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        </div>
      )}

      {error ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the activity log'}</ErrorNote>
      ) : isPending ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-subtle" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-secondary">
          {filtered ? 'Nothing matches these filters.' : 'Nothing recorded yet.'}
        </p>
      ) : (
        <div className="space-y-6">
          {days.map((d) => (
            <section key={d.key} aria-label={dayTitle(d.key)}>
              <h3 className="eyebrow sticky top-0 z-[1] -mx-1 bg-white/95 px-1 py-1.5 backdrop-blur-sm">
                {dayTitle(d.key)}
              </h3>
              <ol className="divide-y divide-border">
                {d.rows.map((e) => (
                  <Row key={e.id} e={e} time={time(e.at)} />
                ))}
              </ol>
            </section>
          ))}

          {hasNextPage && (
            <div className="flex justify-center pt-1">
              <Button size="sm" onClick={() => void fetchNextPage()} loading={isFetchingNextPage}>
                Show older
              </Button>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/** One thing that happened: when, who, the sentence, and what changed under it. */
function Row({ e, time }: { e: AuditEntry; time: string }) {
  const failed = e.verb === 'sign_in_failed';
  const who = e.actor?.name ?? e.nobody;

  return (
    <li className="flex gap-3 py-3">
      <span className="w-16 shrink-0 whitespace-nowrap pt-0.5 text-xs tabular-nums text-secondary">{time}</span>

      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-micro font-semibold ${
          failed ? 'bg-danger-tint text-danger' : e.actor ? 'bg-primary/10 text-primary' : 'bg-subtle text-secondary'
        }`}
      >
        {failed ? (
          <ShieldAlert className="h-3.5 w-3.5" />
        ) : e.actor ? (
          initials(e.actor.name)
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-body">
          <span className="font-semibold text-primary">{who}</span> {e.action}
          {e.subject && (
            <>
              {' '}
              {e.subject.href ? (
                <Link
                  href={e.subject.href}
                  className="font-medium text-primary underline decoration-border underline-offset-2 transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {e.subject.label}
                </Link>
              ) : (
                <span className="font-medium text-primary">{e.subject.label}</span>
              )}
              {e.subject.gone && <span className="ml-1.5 text-xs text-secondary">(removed)</span>}
            </>
          )}
        </p>
        {e.subject?.context && <p className="mt-0.5 truncate text-xs text-secondary">{e.subject.context}</p>}
        {e.detail.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {e.detail.map((line, i) => (
              <li key={i} className={`break-words text-xs ${failed ? 'text-danger' : 'text-secondary'}`}>
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
