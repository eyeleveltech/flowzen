'use client';

/**
 * Setup → Feedback (Ease Plan 3) — Management only, like its routes.
 *
 * Every "Something confusing? Tell us" note, newest first: who sent it, from
 * which page, phone or computer, when, and what they said. Each is New, Seen
 * or Done. Done with a note tells the sender, in their bell, that it was
 * looked at and what was done — the loop the box promises.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Monitor, Smartphone } from 'lucide-react';
import { api, ApiError, type FeedbackNote, type FeedbackStatus } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { ErrorNote } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeDate, cn } from '@/lib/utils';

const STATUS: { key: FeedbackStatus; label: string }[] = [
  { key: 'NEW', label: 'New' },
  { key: 'SEEN', label: 'Seen' },
  { key: 'DONE', label: 'Done' },
];
type Filter = FeedbackStatus | 'ALL';

export function FeedbackTab({ tz, locale }: { tz: string; locale: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const { data, isPending, error } = useQuery({ queryKey: ['feedback'], queryFn: () => api.feedback.list() });
  const notes = useMemo(() => data?.notes ?? [], [data]);
  const count = (f: Filter) => (f === 'ALL' ? notes.length : notes.filter((n) => n.status === f).length);
  const shown = filter === 'ALL' ? notes : notes.filter((n) => n.status === filter);

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

  const saved = (id: string, patch: Partial<FeedbackNote>) => {
    queryClient.setQueryData<typeof data>(['feedback'], (old) =>
      old ? { ...old, notes: old.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } : old,
    );
    // The "N new feedback notes" bell moves with it.
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <SectionCard
      // The tab's own heading already says "Feedback".
      title="Notes"
      description="Sent from the ? help panel and the profile menu. Marking a note Done with a reply tells the sender in their bell."
      aside={
        <div role="group" aria-label="Show" className="flex gap-1.5">
          {(['ALL', 'NEW', 'SEEN', 'DONE'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                filter === f ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border text-secondary hover:bg-subtle',
              )}
            >
              {f === 'ALL' ? 'All' : STATUS.find((s) => s.key === f)!.label} {count(f)}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-3"
    >
      {error ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the feedback'}</ErrorNote>
      ) : isPending ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-card bg-subtle" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-card border border-dashed border-border px-4 py-8 text-center text-sm text-secondary">
          {notes.length === 0 ? 'No feedback yet. When somebody sends a note, it shows here and you get a bell.' : 'Nothing here.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((n) => (
            <FeedbackRow key={n.id} note={n} when={when} onSaved={saved} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function FeedbackRow({
  note,
  when,
  onSaved,
}: {
  note: FeedbackNote;
  when: (iso: string) => string;
  onSaved: (id: string, patch: Partial<FeedbackNote>) => void;
}) {
  const [reply, setReply] = useState(note.note ?? '');
  const [saving, setSaving] = useState<FeedbackStatus | null>(null);
  const changed = reply.trim() !== (note.note ?? '');

  const save = async (status: FeedbackStatus) => {
    // The status it already has, with nothing new written: nothing to save.
    if (status === note.status && !changed) return;
    setSaving(status);
    try {
      const res = await api.feedback.update(note.id, { status, note: reply.trim() || null });
      onSaved(note.id, res.note);
      const first = status === 'DONE' && reply.trim() && !(note.status === 'DONE' && note.note);
      toast.success(first ? `Done. ${note.from.name} has been told.` : 'Saved');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save it');
    } finally {
      setSaving(null);
    }
  };

  const Device = note.device === 'PHONE' ? Smartphone : Monitor;
  return (
    <li data-feedback={note.id} data-status={note.status} className="rounded-card border border-border bg-white">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2.5">
        <p className="min-w-0 text-sm">
          <span className="font-semibold text-primary">{note.from.name}</span>
          {note.from.dept && <span className="text-secondary"> · {note.from.dept}</span>}
        </p>
        <p className="flex items-center gap-2 text-xs text-secondary">
          <span className="font-mono" title={note.screen ?? undefined}>
            {note.path}
          </span>
          <Device className="h-3.5 w-3.5" aria-label={note.device === 'PHONE' ? 'Phone' : 'Computer'} />
          <time dateTime={note.createdAt} title={when(note.createdAt)}>
            {formatRelativeDate(note.createdAt)}
          </time>
          {note.status === 'NEW' && <Badge tone="info">New</Badge>}
        </p>
      </div>
      <div className="space-y-3 px-4 py-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-body">{note.message}</p>
        <div>
          <label htmlFor={`reply-${note.id}`} className="eyebrow mb-1.25 block">
            What was done (optional)
          </label>
          <textarea
            id={`reply-${note.id}`}
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, 2000))}
            rows={2}
            placeholder="Leave is under Calendar → Time off. Added it to the help."
            className="w-full resize-none rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-body outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-micro text-secondary">
            {note.status === 'DONE' && note.note
              ? `${note.from.name} was told${note.handledBy ? ` by ${note.handledBy.name}` : ''}.`
              : `Done with a reply tells ${note.from.name} in their bell.`}
          </p>
          <div role="group" aria-label="Status" className="flex items-center gap-1.5">
            {STATUS.map((s) => (
              <Button
                key={s.key}
                type="button"
                size="sm"
                variant={note.status === s.key && !changed ? 'primary' : 'ghost'}
                aria-pressed={note.status === s.key}
                loading={saving === s.key}
                disabled={saving !== null}
                onClick={() => void save(s.key)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}
