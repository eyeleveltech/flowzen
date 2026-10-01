'use client';

/**
 * Booking a meeting, a shoot, or anything else with a time and people on it.
 *
 * Anybody may book one, for anybody: the person booking does not have to be on
 * it — an assistant books the boss's meeting. The people on it are told at once
 * (by the server), and nobody else is.
 *
 * The warnings box is live: as the time, the people or the gear change it asks
 * the server what would get in the way. It never stops a save — a shoot can go
 * ahead with a camera somebody else has booked; it just should not happen by
 * accident.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { TriangleAlert } from 'lucide-react';
import {
  api,
  ApiError,
  type CalendarClash,
  type CalendarEventDetail,
  type CalendarEventInput,
  type CalendarEventKind,
} from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect, FieldCheckbox } from '@/components/ui/field';
import { MultiSelect } from '@/components/ui/multi-select';
import { ErrorNote } from '@/components/ui/empty-state';
import { dueTimeOptions } from '@/lib/due-time';
import { personOptions } from '@/lib/people';

const KINDS: { value: CalendarEventKind; label: string }[] = [
  { value: 'MEETING', label: 'Meeting' },
  { value: 'SHOOT', label: 'Shoot' },
  { value: 'OTHER', label: 'Other' },
];
/** Every quarter hour, without the "No time" a task's due time offers. */
const TIMES = dueTimeOptions().filter((o) => o.value);

/** What a company is to the studio, as the client field says it. */
const COMPANY_STATUS: Record<string, string> = { CLIENT: 'Client', PROSPECT: 'Prospect', PAST: 'Past client' };
const STATUS_ORDER: Record<string, number> = { CLIENT: 0, PROSPECT: 1, PAST: 2 };

const STATUS_WORD: Record<string, string> = {
  IN_STOCK: 'In the cupboard',
  BOOKED_OUT: 'Out on a booking',
  ASSIGNED: 'With somebody',
  IN_REPAIR: 'In repair',
};

/** An hour after "10:00", within the day. */
const plusHour = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export type EventModalStart = { date: string; time?: string };

export function EventModal({
  open,
  onClose,
  onSaved,
  start,
  event,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  /** A new event, on this day (and time). */
  start?: EventModalStart | null;
  /** Or an existing one, to change. */
  event?: CalendarEventDetail | null;
}) {
  const team = useTeamMembers();
  const { data: options } = useQuery({
    queryKey: ['calendar-event-options'],
    queryFn: () => api.calendar.eventOptions(),
    enabled: open,
    staleTime: 60_000,
  });

  const [kind, setKind] = useState<CalendarEventKind>('MEETING');
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('10:00');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('11:00');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [job, setJob] = useState('');
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [clashes, setClashes] = useState<CalendarClash[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filled from the event being changed, or from the day that was clicked.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setClashes([]);
    if (event) {
      setKind(event.kind);
      setTitle(event.title);
      setAllDay(event.allDay);
      setStartDate(event.startsAt.slice(0, 10));
      setEndDate(event.endsAt.slice(0, 10));
      setStartTime(event.allDay ? '10:00' : event.startsAt.slice(11, 16));
      setEndTime(event.allDay ? '11:00' : event.endsAt.slice(11, 16));
      setLocation(event.location ?? '');
      setNotes(event.notes ?? '');
      setAttendeeIds(event.attendees.map((a) => a.id));
      setCompanyId(event.company?.id ?? '');
      setJob(event.project ? `project:${event.project.id}` : event.retainer ? `retainer:${event.retainer.id}` : '');
      setContactIds(event.contacts.map((c) => c.id));
      setAssetIds(event.gear.map((g) => g.assetId));
      return;
    }
    const day = start?.date ?? new Date().toISOString().slice(0, 10);
    const time = start?.time ?? '10:00';
    setKind('MEETING');
    setTitle('');
    setAllDay(false);
    setStartDate(day);
    setEndDate(day);
    setStartTime(time);
    setEndTime(plusHour(time));
    setLocation('');
    setNotes('');
    setAttendeeIds([]);
    setCompanyId('');
    setJob('');
    setContactIds([]);
    setAssetIds([]);
  }, [open, event, start]);

  const company = options?.companies.find((c) => c.id === companyId);
  const jobOptions = company
    ? [
        ...company.projects.map((p) => ({ value: `project:${p.id}`, label: p.name })),
        ...company.retainers.map((r) => ({ value: `retainer:${r.id}`, label: r.name })),
      ]
    : [];

  const span = useMemo(
    () =>
      allDay
        ? { startsAt: startDate, endsAt: endDate || startDate }
        : { startsAt: `${startDate}T${startTime}`, endsAt: `${endDate || startDate}T${endTime}` },
    [allDay, startDate, endDate, startTime, endTime],
  );
  const shootGear = kind === 'SHOOT' ? assetIds : [];

  // The live warnings: asked again a moment after anything that matters changes.
  useEffect(() => {
    if (!open || !startDate) return;
    let stale = false;
    const t = setTimeout(() => {
      if (shootGear.length === 0 && attendeeIds.length === 0) {
        setClashes([]);
        return;
      }
      api.calendar
        .clashes({ ...span, allDay, assetIds: shootGear, attendeeIds, excludeEventId: event?.id ?? null })
        .then((r) => !stale && setClashes(r.clashes))
        // A window that is not one yet (end before start) has nothing to say.
        .catch(() => !stale && setClashes([]));
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [open, span, allDay, shootGear.join(','), attendeeIds.join(','), event?.id, startDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeStartDate = (d: string) => {
    setStartDate(d);
    if (!endDate || endDate < d) setEndDate(d);
  };
  const changeStartTime = (t: string) => {
    setStartTime(t);
    if (endDate === startDate && endTime <= t) setEndTime(plusHour(t));
  };
  // A different client: what belonged to the old one goes.
  const changeCompany = (id: string) => {
    setCompanyId(id);
    setJob('');
    setContactIds([]);
  };

  const canSave = Boolean(title.trim()) && Boolean(startDate);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    const [jobKind, jobId] = job ? job.split(':') : [null, null];
    const body: CalendarEventInput = {
      kind,
      title: title.trim(),
      ...span,
      allDay,
      location: location.trim() || null,
      notes: notes.trim() || null,
      attendeeIds,
      companyId: companyId || null,
      projectId: jobKind === 'project' ? jobId : null,
      retainerId: jobKind === 'retainer' ? jobId : null,
      contactIds,
      assetIds: shootGear,
    };
    try {
      const res = event ? await api.calendar.updateEvent(event.id, body) : await api.calendar.createEvent(body);
      toast.success(event ? 'Saved' : `${KINDS.find((k) => k.value === kind)?.label} booked`);
      if (res.clashes.length) toast(`Saved with ${res.clashes.length} warning${res.clashes.length === 1 ? '' : 's'} — see the event.`);
      onSaved(res.event.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={event ? 'Change this event' : 'New event'}>
      <form onSubmit={submit} className="flex h-full flex-col">
        <ScrollingModalBody className="space-y-5">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <FieldSelect label="Kind" value={kind} onChange={(v) => setKind(v as CalendarEventKind)} options={KINDS} />
            <Field label="Title" value={title} onChange={setTitle} required placeholder="Acme review" />
          </div>

          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={allDay ? 'From' : 'Starts'} type="date" value={startDate} onChange={changeStartDate} required />
              {!allDay && <FieldSelect label="At" value={startTime} onChange={changeStartTime} options={TIMES} />}
              <Field label={allDay ? 'To' : 'Ends'} type="date" value={endDate} onChange={setEndDate} required />
              {!allDay && <FieldSelect label="At" value={endTime} onChange={setEndTime} options={TIMES} />}
            </div>
            <FieldCheckbox label="All day" checked={allDay} onChange={setAllDay} />
          </div>

          <Field label="Place" value={location} onChange={setLocation} placeholder="Board room, Studio B, the client's office" />

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-body">People</p>
            <MultiSelect
              ariaLabel="People"
              compact={false}
              showSelectAll={false}
              options={personOptions(team)}
              value={attendeeIds}
              onChange={setAttendeeIds}
              placeholder="Who is on it — you don't have to be"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect
              label="Client or prospect"
              value={companyId}
              onChange={changeCompany}
              placeholder="None"
              // Clients first, then prospects, then past clients — each saying which it is.
              options={[
                { value: '', label: 'None' },
                ...[...(options?.companies ?? [])]
                  .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name))
                  .map((c) => ({ value: c.id, label: c.name, sublabel: COMPANY_STATUS[c.status] ?? c.status })),
              ]}
            />
            <FieldSelect
              label="Project or retainer"
              value={job}
              onChange={setJob}
              disabled={!company || jobOptions.length === 0}
              placeholder={!company ? 'Choose a client first' : jobOptions.length === 0 ? 'Nothing live' : 'None'}
              options={[{ value: '', label: 'None' }, ...jobOptions]}
            />
          </div>
          {company && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-body">With, from {company.name}</p>
              <MultiSelect
                ariaLabel="Client contacts"
                compact={false}
                showSelectAll={false}
                options={company.contacts.map((c) => ({ value: c.id, label: c.name }))}
                value={contactIds}
                onChange={setContactIds}
                placeholder={company.contacts.length ? 'Their people on it — for reference, never emailed' : 'No contacts on file'}
              />
            </div>
          )}

          {kind === 'SHOOT' && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-body">Gear</p>
              <MultiSelect
                ariaLabel="Gear"
                compact={false}
                showSelectAll={false}
                options={(options?.assets ?? []).map((a) => ({
                  value: a.id,
                  label: `${a.tag} ${a.name}`,
                  sublabel: STATUS_WORD[a.status] ?? a.status,
                }))}
                value={assetIds}
                onChange={setAssetIds}
                placeholder="Reserve gear for the shoot"
              />
              <p className="text-micro text-secondary">
                Reserving is a plan. Taking it out is still a checkout on the day.
              </p>
            </div>
          )}

          <Field label="Notes" value={notes} onChange={setNotes} textarea rows={3} />

          {clashes.length > 0 && (
            <div role="status" className="rounded-card border border-warning/30 bg-warning-tint px-4 py-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-warning-ink">
                <TriangleAlert className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Worth a look before you save
              </p>
              <ul className="space-y-1 text-xs text-warning-ink">
                {clashes.map((c, i) => (
                  <li key={i}>
                    {c.kind === 'person' ? c.message : <><span className="font-semibold">{c.subject}</span> — {c.message}</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ScrollingModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {/* Never held back by a warning. */}
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            {event ? 'Save' : 'Book it'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
