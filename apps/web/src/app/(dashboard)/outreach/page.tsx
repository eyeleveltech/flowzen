'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ShowMore } from '@/components/ui/show-more';
import { ErrorNote } from '@/components/ui/empty-state';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ApiError, api, fileUrl, type DuplicateVerdict } from '@/lib/api-v2';
import { DuplicateNotice } from '@/components/clients/DuplicateNotice';
import { useTeamMembers } from '@/hooks/queries';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { ImportOutreachModal } from '@/components/clients/ImportOutreachModal';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { Upload, UserPlus } from 'lucide-react';
import { VERTICAL_LABEL, SOURCE_LABEL, VERTICAL_OPTIONS, SOURCE_OPTIONS, labelFor } from '@/lib/vertical';
import { RowMenu } from '@/components/ui/row-menu';
import { Pencil, Send, Building2, CalendarClock } from 'lucide-react';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { Search, X } from 'lucide-react';
import { usePageHeader } from '@/hooks/usePageHeader';
import { personOptions } from '@/lib/people';

/**
 * Where the conversation has got to.
 *
 * The old set recorded events — contacted, replied — which could say a call
 * happened and never what to do next. These five describe a conversation with
 * a next action attached, and two of them carry a date, which is what lets
 * this screen answer "who am I calling today".
 */
type OutreachStatus = 'NOT_CONTACTED' | 'FOLLOW_UP' | 'MEETING' | 'INTERESTED' | 'DEAD';

interface OutreachItem {
  id: string;
  name: string;
  vertical: string;
  source: string;
  status: OutreachStatus;
  ownerId: string;
  owner?: { id: string; name: string; designation?: string | null } | null;
  promotedCompany?: { id: string; name: string; status: string } | null;
  contactPersonName?: string | null;
  phone?: string | null;
  email?: string | null;
  remarks?: string | null;
  nextActionDate?: string | null;
  importedAt: string;
}

const STATUS_STYLE: Record<OutreachStatus, string> = {
  NOT_CONTACTED: 'border border-line text-secondary bg-white',
  FOLLOW_UP: 'border border-warning/40 text-warning-ink bg-warning-tint',
  MEETING: 'border border-info/30 text-info bg-info-tint',
  INTERESTED: 'border border-success/40 text-success bg-success-tint',
  DEAD: 'border border-border text-secondary bg-subtle',
};

const STATUS_LABEL: Record<OutreachStatus, string> = {
  NOT_CONTACTED: 'Not contacted',
  FOLLOW_UP: 'Follow up',
  MEETING: 'Meeting',
  INTERESTED: 'Interested',
  DEAD: 'Dead',
};

/** "12 Sep" — short enough to sit under a name without crowding it. */
const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** A callback whose day has passed is the thing this screen is for. */
const isOverdue = (iso: string) => new Date(iso).setHours(23, 59, 59, 999) < Date.now();

/** The two statuses that hang off a date, and what that date is called. */
const CARRIES_ACTION: Partial<Record<OutreachStatus, { dateLabel: string; remarksRequired: boolean; remarksHint: string }>> = {
  FOLLOW_UP: {
    dateLabel: 'Call back on',
    remarksRequired: true,
    remarksHint: 'What did they say? Why do they want a callback?',
  },
  MEETING: {
    dateLabel: 'Meeting on',
    remarksRequired: false,
    remarksHint: 'Time, online or offline, where, and who is going.',
  },
};

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as OutreachStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

// Verticals and sources live in `lib/vertical.ts` — the companies table
// reads the same map, so the two screens cannot drift apart again.

export default function OutreachPage() {
  const router = useRouter();
  /** A failed load, said out loud instead of only in the console. */
  /**
   * The outreach list is the one that arrives by the hundred — it is bulk
   * imported from a scrape — and the endpoint has always stopped at 200 with
   * no way to ask for more. Pages accumulate; you scan this list, you do not
   * flip through it.
   */
  const queryClient = useQueryClient();
  /** A failed ACTION (marking replied, importing). The query owns load errors. */
  const [actionError, setActionError] = useState<string | null>(null);
  const [pages, setPages] = useState(1);

  /*
   * The two filters, and where each one lives.
   *
   * Both narrow server-side. Filtering in the browser would only ever narrow
   * the page already fetched, which on the one list in the product that
   * genuinely arrives by the hundred means searching the first 200 names and
   * calling the rest absent.
   *
   * Status sits in the URL, so "everyone we have not contacted yet" is a link
   * somebody can send. The search box does not — a query string rewritten on
   * every keystroke is noise, and the text is in the box in front of you.
   */
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  /**
   * Keys and labels only. `useTabState` reads `key` and `visible` and never
   * `count`, so the tab the URL selects can be resolved BEFORE the counts
   * exist — which matters now that the counts come from a query whose own key
   * contains the selected tab. Counts are attached further down, once the
   * query has answered.
   */
  const tabDefs: TabDef<'ALL' | OutreachStatus>[] = [
    { key: 'ALL', label: 'All' },
    { key: 'NOT_CONTACTED', label: 'Not contacted' },
    { key: 'FOLLOW_UP', label: 'Follow up' },
    { key: 'MEETING', label: 'Meeting' },
    { key: 'INTERESTED', label: 'Interested' },
    { key: 'DEAD', label: 'Dead' },
  ];
  const [statusFilter, setStatusFilter] = useTabState(tabDefs, 'status');

  // Typing is not a request. Without this, "Prestige" is eight fetches and the
  // answer to "P" can land after the answer to "Prestige".
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Add modal state
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newVertical, setNewVertical] = useState('HEALTHCARE');
  const [newSource, setNewSource] = useState('OUTREACH');
  const [adding, setAdding] = useState(false);

  // Import modal state
  const [importOpen, setImportOpen] = useState(false);

  /*
   * The roster, for the Owner field.
   *
   * `ownerId` has always been written — POST defaults it to whoever adds the
   * name — but there was no way to see it and no way to change it, so a name
   * added by the wrong person stayed with them.
   */
  const team = useTeamMembers();
  const [newOwnerId, setNewOwnerId] = useState('');

  // Edit dialog
  const [editing, setEditing] = useState<OutreachItem | null>(null);
  const [editContactName, setEditContactName] = useState('');
  /**
   * The lead's own history, fetched when the record is opened.
   *
   * Cached per lead, so reopening the same one is instant. Needed an
   * `OutreachEntry` entry in the activity feed's permission map before any of
   * it was readable — anything absent from that map is refused, not allowed.
   */
  const { data: history = [] } = useQuery({
    queryKey: ['activities', 'OutreachEntry', editing?.id],
    enabled: Boolean(editing?.id),
    queryFn: () =>
      api.activities.list({ entityType: 'OutreachEntry', entityId: editing!.id, limit: '50' }),
  });
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editName, setEditName] = useState('');
  const [editVertical, setEditVertical] = useState('HEALTHCARE');
  const [editSource, setEditSource] = useState('OUTREACH');
  const [editOwnerId, setEditOwnerId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const openEdit = (e: OutreachItem) => {
    setEditing(e);
    setEditName(e.name);
    setEditVertical(e.vertical);
    setEditSource(e.source);
    setEditOwnerId(e.owner?.id ?? e.ownerId ?? '');
    setEditContactName(e.contactPersonName ?? '');
    setEditPhone(e.phone ?? '');
    setEditEmail(e.email ?? '');
  };

  const saveEdit = async () => {
    if (!editing || !editName.trim()) return;
    setSavingEdit(true);
    try {
      await api.outreach.update(editing.id, {
        name: editName.trim(),
        vertical: editVertical,
        source: editSource,
        contactPersonName: editContactName.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        ...(editOwnerId ? { ownerId: editOwnerId } : {}),
      });
      toast.success('Updated');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setSavingEdit(false);
    }
  };

  // Row-level status changes
  const [markingReplied, setMarkingReplied] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  /** The lead and the status being moved to, while its date and note are asked for. */
  const [actionFor, setActionFor] = useState<{ entry: OutreachItem; status: OutreachStatus } | null>(null);
  const [actionDate, setActionDate] = useState('');
  const [actionRemarks, setActionRemarks] = useState('');
  const [savingAction, setSavingAction] = useState(false);

  // Promote modal state
  const [promotingEntry, setPromotingEntry] = useState<OutreachItem | null>(null);
  const [promoteCity, setPromoteCity] = useState('Chennai');
  const [promoteName, setPromoteName] = useState('');
  const [promoteVertical, setPromoteVertical] = useState('');
  const [promoteOwnerId, setPromoteOwnerId] = useState('');
  const [promoteForce, setPromoteForce] = useState(false);
  const [promoteVerdict, setPromoteVerdict] = useState<DuplicateVerdict | null>(null);
  const [promoteContactName, setPromoteContactName] = useState('');
  const [promoteContactEmail, setPromoteContactEmail] = useState('');
  const [promoteContactPhone, setPromoteContactPhone] = useState('');
  const [promoting, setPromoting] = useState(false);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['outreach', statusFilter, query, pages],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const rows: OutreachItem[] = [];
      let meta: { total: number } | undefined;
      let counts = { ALL: 0, NOT_CONTACTED: 0, FOLLOW_UP: 0, MEETING: 0, INTERESTED: 0, DEAD: 0 };
      let cold = 0;
      for (let p = 1; p <= pages; p++) {
        const res = await api.outreach.list({
          page: String(p),
          ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
          ...(query ? { search: query } : {}),
        });
        if (!res.success) break;
        rows.push(...(res.entries as OutreachItem[]));
        meta = res.meta;
        // The chips follow the search but not the status, so each one reports
        // what you would get by pressing it rather than what you already have.
        counts = res.counts;
        cold = res.summary.cold;
      }
      return {
        entries: rows,
        // From the server. It used to be `res.entries.length`, which is the
        // size of the page just fetched — the same figure it was being
        // compared against, so "N more rows" could only ever say zero.
        total: meta?.total ?? rows.length,
        counts,
        cold,
      };
    },
  });

  const entries: OutreachItem[] = data?.entries ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? { ALL: 0, NOT_CONTACTED: 0, FOLLOW_UP: 0, MEETING: 0, INTERESTED: 0, DEAD: 0 };
  const cold = data?.cold ?? 0;
  const loading = isPending;
  const loadingMore = isFetching && !isPending;
  const loadError = error instanceof Error ? error.message : error ? 'Could not load the outreach list' : null;

  const statusTabs: TabDef<'ALL' | OutreachStatus>[] = tabDefs.map((t) => ({
    ...t,
    count: counts[t.key as keyof typeof counts],
  }));

  /** What the add / import / status flows call once a row has changed. */
  const load = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['outreach'] });
    // A status change writes a history row, so the trail on the open record
    // has to be refetched too or it shows the change one edit late.
    await queryClient.invalidateQueries({ queryKey: ['activities'] });
  }, [queryClient]);

  // Two deliberate steps, on request: marking a reply is a plain status flip
  // (no Company yet), and promoting is its own separate action once a row
  // sits at Replied. A row that's Replied but never promoted just stays
  // visible in this list rather than disappearing, so nothing gets lost —
  // the visible "Promote to company" button on that row is the reminder.
  /**
   * Moving a lead along.
   *
   * FOLLOW_UP and MEETING cannot be set from the dropdown alone — both need a
   * date, and a follow-up needs a note as well. Choosing either opens the
   * little form below rather than firing a request that the server would
   * refuse; asking for the date is the whole reason those statuses exist.
   */
  const changeStatus = async (entry: OutreachItem, status: OutreachStatus) => {
    const carriesAction = Boolean(CARRIES_ACTION[status]);
    // Re-choosing the status you are already on is how you MOVE a date —
    // picking Meeting again on a lead already meeting reopens the dialog to
    // reschedule it. Without this the only way to change a meeting date was to
    // move the lead to Follow up and back, and Follow up demands a note, so
    // rescheduling meant inventing a callback that never happened.
    if (status === entry.status && !carriesAction) return;
    if (carriesAction) {
      openAction(entry, status);
      return;
    }
    setUpdatingStatus(entry.id);
    try {
      await api.outreach.updateStatus(entry.id, { status });
      await load();
    } catch (e) {
      // A failed action used to log to the console and stop. The button simply
      // did nothing, so the natural response was to press it again.
      toast.error(e instanceof Error ? e.message : 'Could not change that status');
    } finally {
      setUpdatingStatus(null);
    }
  };

  /**
   * Open the date-and-note dialog for a lead.
   *
   * Pre-filled from the row, so rescheduling starts from the date that is
   * already there rather than an empty field somebody has to remember.
   */
  const openAction = (entry: OutreachItem, status: OutreachStatus) => {
    setActionFor({ entry, status });
    setActionDate(entry.nextActionDate?.slice(0, 10) ?? '');
    setActionRemarks(entry.remarks ?? '');
  };

  /** Saving the date and note the two action statuses require. */
  const saveAction = async () => {
    if (!actionFor) return;
    setSavingAction(true);
    try {
      await api.outreach.updateStatus(actionFor.entry.id, {
        status: actionFor.status,
        nextActionDate: actionDate || null,
        remarks: actionRemarks.trim() || null,
      });
      setActionFor(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSavingAction(false);
    }
  };

  /**
   * Interested is the gate to promotion, and it means something specific now:
   * met, happy, and asking for a quotation. A row that sits at Interested and
   * is never promoted stays visible in this list rather than disappearing —
   * the button on that row is the reminder.
   */
  const markInterested = async (entry: OutreachItem) => {
    setMarkingReplied(entry.id);
    try {
      await api.outreach.updateStatus(entry.id, { status: 'INTERESTED' });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not update that row');
    } finally {
      setMarkingReplied(null);
    }
  };

  const openPromote = (entry: OutreachItem) => {
    setPromotingEntry(entry);
    setPromoteCity('Chennai');
    // Pre-filled from the lead and editable. Everything here was collected
    // while the lead was cold; the person promoting it has just met them and
    // is the one who knows the legal name and the right number.
    setPromoteName(entry.name);
    setPromoteVertical(entry.vertical);
    setPromoteOwnerId(entry.owner?.id ?? entry.ownerId ?? '');
    setPromoteContactName(entry.contactPersonName ?? '');
    setPromoteContactEmail(entry.email ?? '');
    setPromoteContactPhone(entry.phone ?? '');
    setPromoteForce(false);
  };

  const confirmPromote = async () => {
    if (!promotingEntry) return;
    setPromoting(true);
    setPromoteVerdict(null);
    try {
      const res = await api.outreach.promote(promotingEntry.id, {
        city: promoteCity.trim() || 'Chennai',
        companyName: promoteName.trim() || undefined,
        vertical: promoteVertical || undefined,
        ownerId: promoteOwnerId || undefined,
        ...(promoteForce ? { force: true } : {}),
        contactName: promoteContactName.trim() || undefined,
        contactEmail: promoteContactEmail.trim() || undefined,
        contactPhone: promoteContactPhone.trim() || undefined,
      });
      const company = (res as { company?: { id: string; name: string } }).company;
      setPromotingEntry(null);
      if (company) {
        toast.success(
          <span>
            {company.name} created.{' '}
            <button onClick={() => router.push(`/companies/${company.id}`)} className="underline font-medium">
              Open it
            </button>
          </span>,
        );
      }
      await load();
    } catch (e) {
      /**
       * The 409 carries the match, not just a sentence — `{ action, matches,
       * canForce }` under `data`. Promotion used to run no duplicate check at
       * all, so a lead whose name already belonged to a client hit the unique
       * index and came back as a bare "Something went wrong".
       */
      if (e instanceof ApiError && e.status === 409 && e.data) {
        setPromoteVerdict(e.data as DuplicateVerdict);
      } else {
        // A failed action used to log to the console and stop. The button
        // simply did nothing, so the natural response was to press it again.
        toast.error(e instanceof Error ? e.message : 'Could not promote that lead');
      }
    }
    finally { setPromoting(false); }
  };

  const addEntry = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await api.outreach.create({
        name: newName.trim(),
        vertical: newVertical,
        source: newSource,
        contactPersonName: newContactName.trim() || null,
        phone: newPhone.trim() || null,
        email: newEmail.trim() || null,
        ...(newOwnerId ? { ownerId: newOwnerId } : {}),
      });
      setAddOpen(false);
      setNewName('');
      setNewContactName('');
      setNewPhone('');
      setNewEmail('');
      setNewOwnerId('');
      load();
    } catch (e) {
      // A failed action used to log to the console and stop. The
      // button simply did nothing, so the natural response was to
      // press it again.
      toast.error(e instanceof Error ? e.message : 'Could not promote that entry');
    }
    finally { setAdding(false); }
  };

  // The server leaves promoted entries out of this list entirely now — an
  // entry that became a company belongs on /companies. Filtering here after
  // the fetch is what made the row count and the total disagree.
  const shown = entries;

  // A narrower list is a new list. Leaving `pages` at 4 would ask the server
  // for four pages of a result that now has one.
  const narrow = (fn: () => void) => { setPages(1); fn(); };

  // `total` follows the filters, so unqualified it would read "1 of 1 shown"
  // while six other names sit behind a chip.
  const filtered = Boolean(query) || statusFilter !== 'ALL';
  usePageHeader(
    'Outreach list',
    filtered ? `${shown.length} of ${total} matching · ${cold} in all` : `${shown.length} of ${total} shown`,
  );

  return (
    <div className="page-shell">
      {(loadError ?? actionError) && (
        <div className="mb-6">
          {/*
            A failed load used to reach console.error and stop, so the screen
            rendered its empty state and "the server is down" looked exactly
            like "you have nothing yet".
          */}
          <ErrorNote onDismiss={() => { setActionError(null); void queryClient.resetQueries({ queryKey: ['outreach'] }); }}>{loadError ?? actionError}</ErrorNote>
        </div>
      )}
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
          <ExportCsvButton href={fileUrl('/outreach?format=csv')} />
          <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setAddOpen(true)}>
            New name
          </Button>
      </div>

      {/* The left-accent note the retainer card and the rest of the app use for
          "here is why this screen behaves the way it does" — a plain bordered
          box reads as another card of content, which this is not. */}
      <div className="mb-6 rounded-r-xl border-l-[3px] border-accent bg-subtle/60 px-4 py-3">
        <p className="mb-0.5 text-sm font-semibold text-primary">Deliberately not in the company list</p>
        <p className="text-sm text-secondary">
          {cold} scraped names nobody has <span className="italic">spoken</span> to. A <span className="text-primary font-medium">reply</span>, then a promote, turns a row into a Company — and only then does it appear <span className="italic">anywhere else</span> in the system.
        </p>
      </div>

      {/* Table section */}
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-primary mr-auto">Cold names</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary" strokeWidth={1.75} />
            <input
              type="search"
              value={search}
              onChange={(e) => narrow(() => setSearch(e.target.value))}
              placeholder="Search names"
              aria-label="Search outreach names"
              className="w-56 rounded-lg border border-border py-1.5 pl-8 pr-8 text-sm outline-none transition-colors focus:border-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => narrow(() => setSearch(''))}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
          <Button variant="secondary" size="sm" icon={Upload} onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
        </div>
        {/*
          The status filter, which only narrows — it is not the dropdown on
          each row, which edits. Same underline row the client list and Money
          use, so the gesture is the one already learnt.
        */}
        <Tabs className="px-2" tabs={statusTabs} active={statusFilter} onChange={(k) => narrow(() => setStatusFilter(k))} />
        <div className="overflow-x-auto">
        <table className="w-full data-table">
          <thead>
            <tr className="border-b border-border bg-subtle/50">
              <th className="eyebrow text-left">Name</th>
              <th className="eyebrow text-left">Industry</th>
              <th className="eyebrow text-left">Source</th>
              <th className="eyebrow text-left">Owner</th>
              <th className="eyebrow text-left">Status</th>
              <th className=""></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-secondary">Loading...</td></tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-16 text-center text-sm text-secondary">
                  {/*
                    "No entries found" was the answer to both "you have not
                    imported anything" and "nothing matches Prestige", which
                    are not the same problem and do not have the same fix.
                  */}
                  {query || statusFilter !== 'ALL' ? (
                    <>
                      Nothing matches that.{' '}
                      <button
                        type="button"
                        onClick={() => narrow(() => { setSearch(''); setStatusFilter('ALL'); })}
                        className="rounded-sm font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        Clear the filters
                      </button>{' '}
                      to see all {cold}.
                    </>
                  ) : (
                    'No entries found.'
                  )}
                </td>
              </tr>
            ) : shown.map(e => (
              <tr key={e.id} className="hover:bg-subtle transition-colors">
                <td className="font-semibold text-primary">
                  {e.name}
                  {/*
                    The reason this screen exists now. Without the date on the
                    row, "who am I calling today" is a question you can only
                    answer by opening every lead one at a time.
                  */}
                  {CARRIES_ACTION[e.status] && e.nextActionDate && (
                    <button
                      type="button"
                      onClick={() => openAction(e, e.status)}
                      title={`Change when — ${e.name}`}
                      className="mt-0.5 block text-left text-micro font-normal text-secondary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {CARRIES_ACTION[e.status]?.dateLabel}{' '}
                      <span className={isOverdue(e.nextActionDate) ? 'font-semibold text-danger' : 'font-semibold text-primary'}>
                        {formatDay(e.nextActionDate)}
                      </span>
                      {e.remarks && <span className="text-secondary"> · {e.remarks}</span>}
                    </button>
                  )}
                  {/* A lead with no way to reach it predates the rule that
                      there must be one. Saying so is how the backlog gets
                      cleared — the edit form is where it gets fixed. */}
                  {!e.phone && !e.email && (
                    <div className="mt-0.5 text-micro font-normal text-warning-ink">No phone or email</div>
                  )}
                </td>
                <td className="text-secondary">{labelFor(VERTICAL_LABEL, e.vertical)}</td>
                <td className="text-secondary">{labelFor(SOURCE_LABEL, e.source)}</td>
                <td className="text-secondary">{e.owner?.name ?? 'Unassigned'}</td>
                <td className="">
                  <Select
                    value={e.status}
                    onChange={(v) => changeStatus(e, v as OutreachStatus)}
                    options={STATUS_OPTIONS}
                    disabled={updatingStatus === e.id}
                    ariaLabel="Change status — Follow up and Meeting will ask for a date"
                    className="w-37.5"
                    buttonClassName={`text-micro font-semibold tracking-[0.03em] rounded-full px-2 py-1 gap-1 ${STATUS_STYLE[e.status]}`}
                  />
                </td>
                <td className="text-right">
                  {/* Promoting is the one thing on this screen that creates a
                      Company, so it is the only button here drawn as an action
                      rather than a nudge. Everything else — including the edit
                      that did not exist at all until now — sits behind the
                      row menu, the same as on the team screen. */}
                  <div className="flex items-center justify-end gap-2">
                    {e.status === 'INTERESTED' ? (
                      <Button variant="primary" size="sm" onClick={() => openPromote(e)} className="whitespace-nowrap">
                        Promote to company
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={markingReplied === e.id}
                        onClick={() => markInterested(e)}
                        className="whitespace-nowrap"
                      >
                        Mark interested
                      </Button>
                    )}
                    <RowMenu
                      label={`Actions for ${e.name}`}
                      actions={[
                        {
                          // Discoverable, and reachable by keyboard and on
                          // mobile — the date on the row is the quick way, but
                          // it is small and not everybody will find it.
                          label: e.status === 'MEETING' ? 'Reschedule meeting' : 'Change callback date',
                          icon: CalendarClock,
                          onSelect: () => openAction(e, e.status),
                          visible: Boolean(CARRIES_ACTION[e.status]),
                        },
                        { label: 'Edit details', icon: Pencil, onSelect: () => openEdit(e) },
                        {
                          label: 'Mark interested',
                          icon: Send,
                          onSelect: () => markInterested(e),
                          visible: e.status !== 'INTERESTED',
                        },
                        {
                          label: 'Promote to company',
                          icon: Building2,
                          onSelect: () => openPromote(e),
                          visible: e.status === 'INTERESTED',
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!loading && (
          <ShowMore
            shown={shown.length}
            total={total}
            loading={loadingMore}
            noun="name"
            onMore={() => setPages((n) => n + 1)}
          />
        )}
      </Card>

      {/*
        Both dialogs on this screen were built by hand, from before `Modal`
        existed: a bare `fixed inset-0` with a click-to-close backdrop and no
        focus trap, no Escape key, and no focus returned to whatever opened it —
        so a keyboard could tab straight out of the dialog into the page behind
        it. Their fields were hand-paired labels and native selects, which is
        why the dropdowns wore the browser's chevron instead of the app's, and
        the two footer buttons were a 50/50 grid rather than the right-aligned
        pair every other dialog in the product ends with.
      */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add to outreach list">
        <ModalBody>
          <Field label="Company name" value={newName} onChange={setNewName} required placeholder="Who did you find?" />
          <Field
            label="Contact person"
            value={newContactName}
            onChange={setNewContactName}
            placeholder="Who do we ask for?"
          />
          {/*
            One of these two is required, and the server enforces the same rule.
            A name with no phone and no email is a note, not a lead — nobody can
            act on it, and it would sit in the list forever looking like work.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" value={newPhone} onChange={setNewPhone} placeholder="e.g. 98400 11223" />
            <Field label="Email" type="email" value={newEmail} onChange={setNewEmail} placeholder="e.g. hello@acme.com" />
          </div>
          {!newPhone.trim() && !newEmail.trim() && (
            <p className="text-xs text-secondary">Add a phone number or an email — one of the two is enough.</p>
          )}
          <FieldSelect label="Industry" value={newVertical} onChange={setNewVertical} options={VERTICAL_OPTIONS} />
          <FieldSelect label="Source" value={newSource} onChange={setNewSource} options={SOURCE_OPTIONS} />
          {/* The form never asked, and POST quietly filed the name under
              whoever was logged in — which is right most of the time and was
              impossible to correct the rest of the time. */}
          <FieldSelect
            label="Owner"
            value={newOwnerId}
            onChange={setNewOwnerId}
            options={personOptions(team)}
            placeholder="You"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            loading={adding}
            disabled={!newName.trim() || (!newPhone.trim() && !newEmail.trim())}
            onClick={() => void addEntry()}
          >
            Add to the list
          </Button>
        </ModalFooter>
      </Modal>

      {/*
        Follow up and Meeting both hang off a date, and the label is what
        changes rather than the field. Asking here is the point: a callback
        with no date is not a callback, and the server refuses one anyway.
      */}
      <Modal
        open={Boolean(actionFor)}
        onClose={() => setActionFor(null)}
        title={
          actionFor
            ? actionFor.status === actionFor.entry.status
              ? `${actionFor.status === 'MEETING' ? 'Reschedule meeting' : 'Change callback date'} — ${actionFor.entry.name}`
              : `${STATUS_LABEL[actionFor.status]} — ${actionFor.entry.name}`
            : ''
        }
      >
        <ModalBody>
          <Field
            label={actionFor ? (CARRIES_ACTION[actionFor.status]?.dateLabel ?? 'Date') : 'Date'}
            type="date"
            value={actionDate}
            onChange={setActionDate}
            required
          />
          <Field
            label="Remarks"
            textarea
            value={actionRemarks}
            onChange={setActionRemarks}
            required={actionFor ? Boolean(CARRIES_ACTION[actionFor.status]?.remarksRequired) : false}
            hint={actionFor ? CARRIES_ACTION[actionFor.status]?.remarksHint : undefined}
            placeholder={actionFor?.status === 'FOLLOW_UP' ? 'They asked us to call back after Diwali…' : '11:30am, offline, at their office…'}
          />
          <p className="text-xs text-secondary">
            Saved to this lead&apos;s history. Earlier notes are kept — this does not replace them.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setActionFor(null)}>Cancel</Button>
          <Button
            variant="primary"
            loading={savingAction}
            disabled={
              !actionDate ||
              (actionFor ? Boolean(CARRIES_ACTION[actionFor.status]?.remarksRequired) && !actionRemarks.trim() : true)
            }
            onClick={() => void saveAction()}
          >
            Save
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={Boolean(promotingEntry)}
        onClose={() => setPromotingEntry(null)}
        title="Promote to company"
        description={
          promotingEntry
            ? `${promotingEntry.name} becomes a real Company — a Prospect, visible everywhere else in the system from here on. The lead is archived, not deleted.`
            : undefined
        }
      >
        <ModalBody>
          <Field label="Company name" value={promoteName} onChange={setPromoteName} required placeholder="Their legal name" />
          <Field label="City" value={promoteCity} onChange={setPromoteCity} placeholder="Chennai" />
          <Field label="Contact person" value={promoteContactName} onChange={setPromoteContactName} placeholder="Who we deal with" />
          {/* Both carried over from the lead but editable here. The vertical
              was often a guess when the name was scraped, and the owner of a
              cold lead is not always who ends up running the account. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect label="Industry" value={promoteVertical} onChange={setPromoteVertical} options={VERTICAL_OPTIONS} />
            <FieldSelect
              label="Owner"
              value={promoteOwnerId}
              onChange={setPromoteOwnerId}
              options={personOptions(team)}
              placeholder="You"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Contact email" type="email" value={promoteContactEmail} onChange={setPromoteContactEmail} placeholder="Optional" />
            <Field label="Contact phone" value={promoteContactPhone} onChange={setPromoteContactPhone} placeholder="Optional" />
          </div>
          {/* A near-name clash can be overridden; a matching phone or email is
              the same company and cannot be. The server decides which. */}
          {promoteVerdict && (
            <DuplicateNotice
              verdict={promoteVerdict}
              checking={false}
              force={promoteForce}
              onForce={setPromoteForce}
            />
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={promoting} onClick={() => setPromotingEntry(null)}>Cancel</Button>
          <Button variant="primary" loading={promoting} onClick={() => void confirmPromote()}>
            Promote
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit this name">
        <ModalBody>
          <Field label="Company name" value={editName} onChange={setEditName} required />
          <Field label="Contact person" value={editContactName} onChange={setEditContactName} placeholder="Who do we ask for?" />
          {/* This is where a lead that predates the rule gets a way to reach
              it. The edit form deliberately does NOT require one — refusing
              every edit until somebody produces a phone number is how a rule
              stops people using the screen at all. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" value={editPhone} onChange={setEditPhone} placeholder="e.g. 98400 11223" />
            <Field label="Email" type="email" value={editEmail} onChange={setEditEmail} placeholder="e.g. hello@acme.com" />
          </div>
          <FieldSelect label="Industry" value={editVertical} onChange={setEditVertical} options={VERTICAL_OPTIONS} />
          <FieldSelect label="Source" value={editSource} onChange={setEditSource} options={SOURCE_OPTIONS} />
          <FieldSelect
            label="Owner"
            value={editOwnerId}
            onChange={setEditOwnerId}
            options={personOptions(team)}
            placeholder="Unassigned"
          />

          {/*
            The trail. `remarks` on the row is only ever the LATEST note — a
            lead followed up four times keeps four of them here, in order,
            rather than the last one having eaten the other three.
          */}
          <div className="border-t border-border pt-4">
            <p className="eyebrow mb-2">History</p>
            {history.length === 0 ? (
              <p className="text-xs text-secondary">Nothing recorded yet. Status changes show up here.</p>
            ) : (
              <ol className="space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="text-xs">
                    <span className="text-secondary">
                      {new Date(h.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ·{' '}
                    </span>
                    <span className="font-semibold text-primary">
                      {h.payload?.from === h.payload?.to
                        ? /* Same status, new date — a reschedule, not a move. */
                          `${STATUS_LABEL[h.payload?.to as OutreachStatus] ?? h.payload?.to} rescheduled`
                        : `${STATUS_LABEL[h.payload?.from as OutreachStatus] ?? h.payload?.from} → ${
                            STATUS_LABEL[h.payload?.to as OutreachStatus] ?? h.payload?.to
                          }`}
                    </span>
                    {h.payload?.nextActionDate && (
                      <span className="text-secondary"> · {formatDay(h.payload.nextActionDate)}</span>
                    )}
                    {h.actor?.name && <span className="text-secondary"> by {h.actor.name}</span>}
                    {h.payload?.remarks && <div className="mt-0.5 text-secondary">{h.payload.remarks}</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" loading={savingEdit} disabled={!editName.trim()} onClick={() => void saveEdit()}>
            Save changes
          </Button>
        </ModalFooter>
      </Modal>

      {importOpen && (
        <ImportOutreachModal
          onClose={() => setImportOpen(false)}
          onImported={(created) => {
            setImportOpen(false);
            toast.success(`${created} ${created === 1 ? 'name' : 'names'} added to the outreach list.`);
            load();
          }}
        />
      )}
    </div>
  );
}
