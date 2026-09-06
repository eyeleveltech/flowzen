'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShowMore } from '@/components/ui/show-more';
import { ErrorNote } from '@/components/ui/empty-state';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, fileUrl } from '@/lib/api-v2';
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
import { Pencil, Send, Building2 } from 'lucide-react';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { Search, X } from 'lucide-react';
import { usePageHeader } from '@/hooks/usePageHeader';
import { personOptions } from '@/lib/people';

type OutreachStatus = 'NOT_CONTACTED' | 'CONTACTED' | 'REPLIED' | 'DEAD';

interface OutreachItem {
  id: string;
  name: string;
  vertical: string;
  source: string;
  status: OutreachStatus;
  ownerId: string;
  owner?: { id: string; name: string; designation?: string | null } | null;
  promotedCompany?: { id: string; name: string; status: string } | null;
  importedAt: string;
}

const STATUS_STYLE: Record<OutreachStatus, string> = {
  NOT_CONTACTED: 'border border-line text-secondary bg-white',
  CONTACTED: 'border border-info/30 text-info bg-info-tint',
  REPLIED: 'border border-success/40 text-success bg-success-tint',
  DEAD: 'border border-border text-secondary bg-subtle',
};

const STATUS_LABEL: Record<OutreachStatus, string> = {
  NOT_CONTACTED: 'Not contacted',
  CONTACTED: 'Contacted',
  REPLIED: 'Replied',
  DEAD: 'Dead',
};

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as OutreachStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

// Verticals and sources live in `lib/vertical.ts` — the companies table
// reads the same map, so the two screens cannot drift apart again.

export default function OutreachPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<OutreachItem[]>([]);
  /** A failed load, said out loud instead of only in the console. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  /**
   * The outreach list is the one that arrives by the hundred — it is bulk
   * imported from a scrape — and the endpoint has always stopped at 200 with
   * no way to ask for more. Pages accumulate; you scan this list, you do not
   * flip through it.
   */
  const [pages, setPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);

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
  const [counts, setCounts] = useState({ ALL: 0, NOT_CONTACTED: 0, CONTACTED: 0, REPLIED: 0, DEAD: 0 });
  const [cold, setCold] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const statusTabs: TabDef<'ALL' | OutreachStatus>[] = [
    { key: 'ALL', label: 'All', count: counts.ALL },
    { key: 'NOT_CONTACTED', label: 'Not contacted', count: counts.NOT_CONTACTED },
    { key: 'CONTACTED', label: 'Contacted', count: counts.CONTACTED },
    { key: 'REPLIED', label: 'Replied', count: counts.REPLIED },
    { key: 'DEAD', label: 'Dead', count: counts.DEAD },
  ];
  const [statusFilter, setStatusFilter] = useTabState(statusTabs, 'status');

  // Typing is not a request. Without this, "Prestige" is eight fetches and the
  // answer to "P" can land after the answer to "Prestige".
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Add modal state
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
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
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [newOwnerId, setNewOwnerId] = useState('');

  // Edit dialog
  const [editing, setEditing] = useState<OutreachItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editVertical, setEditVertical] = useState('HEALTHCARE');
  const [editSource, setEditSource] = useState('OUTREACH');
  const [editOwnerId, setEditOwnerId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    api.team.members().then((r) => setTeam(r.members ?? [])).catch(() => setTeam([]));
  }, []);

  const openEdit = (e: OutreachItem) => {
    setEditing(e);
    setEditName(e.name);
    setEditVertical(e.vertical);
    setEditSource(e.source);
    setEditOwnerId(e.owner?.id ?? e.ownerId ?? '');
  };

  const saveEdit = async () => {
    if (!editing || !editName.trim()) return;
    setSavingEdit(true);
    try {
      await api.outreach.update(editing.id, {
        name: editName.trim(),
        vertical: editVertical,
        source: editSource,
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

  // Promote modal state
  const [promotingEntry, setPromotingEntry] = useState<OutreachItem | null>(null);
  const [promoteCity, setPromoteCity] = useState('Chennai');
  const [promoteContactName, setPromoteContactName] = useState('');
  const [promoteContactEmail, setPromoteContactEmail] = useState('');
  const [promoteContactPhone, setPromoteContactPhone] = useState('');
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows: OutreachItem[] = [];
      let meta: { total: number } | undefined;
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
        setCounts(res.counts);
        setCold(res.summary.cold);
      }
      setEntries(rows);
      // From the server. It used to be `res.entries.length`, which is the size
      // of the page just fetched — the same figure it was being compared
      // against, so "N more rows" could only ever say zero.
      setTotal(meta?.total ?? rows.length);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [pages, statusFilter, query]);

  useEffect(() => { load(); }, [load]);

  // Two deliberate steps, on request: marking a reply is a plain status flip
  // (no Company yet), and promoting is its own separate action once a row
  // sits at Replied. A row that's Replied but never promoted just stays
  // visible in this list rather than disappearing, so nothing gets lost —
  // the visible "Promote to company" button on that row is the reminder.
  const markReplied = async (entry: OutreachItem) => {
    setMarkingReplied(entry.id);
    try {
      await api.outreach.updateStatus(entry.id, 'REPLIED');
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the outreach list');
    }
    finally { setMarkingReplied(null); }
  };

  const changeStatus = async (entry: OutreachItem, status: OutreachStatus) => {
    setUpdatingStatus(entry.id);
    try {
      await api.outreach.updateStatus(entry.id, status);
      await load();
    } catch (e) {
      // A failed action used to log to the console and stop. The
      // button simply did nothing, so the natural response was to
      // press it again.
      toast.error(e instanceof Error ? e.message : 'Could not mark that replied');
    }
    finally { setUpdatingStatus(null); }
  };

  const openPromote = (entry: OutreachItem) => {
    setPromotingEntry(entry);
    setPromoteCity('Chennai');
    setPromoteContactName('');
    setPromoteContactEmail('');
    setPromoteContactPhone('');
  };

  const confirmPromote = async () => {
    if (!promotingEntry) return;
    setPromoting(true);
    try {
      const res = await api.outreach.promote(promotingEntry.id, {
        city: promoteCity.trim() || 'Chennai',
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
      // A failed action used to log to the console and stop. The
      // button simply did nothing, so the natural response was to
      // press it again.
      toast.error(e instanceof Error ? e.message : 'Could not change that status');
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
        ...(newOwnerId ? { ownerId: newOwnerId } : {}),
      });
      setAddOpen(false);
      setNewName('');
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
      {loadError && (
        <div className="mb-6">
          {/*
            A failed load used to reach console.error and stop, so the screen
            rendered its empty state and "the server is down" looked exactly
            like "you have nothing yet".
          */}
          <ErrorNote onDismiss={() => setLoadError(null)}>{loadError}</ErrorNote>
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
              <th className="eyebrow text-left">Vertical</th>
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
                <td className="font-semibold text-primary">{e.name}</td>
                <td className="text-secondary">{labelFor(VERTICAL_LABEL, e.vertical)}</td>
                <td className="text-secondary">{labelFor(SOURCE_LABEL, e.source)}</td>
                <td className="text-secondary">{e.owner?.name ?? 'Unassigned'}</td>
                <td className="">
                  <Select
                    value={e.status}
                    onChange={(v) => changeStatus(e, v as OutreachStatus)}
                    options={STATUS_OPTIONS}
                    disabled={updatingStatus === e.id}
                    ariaLabel="Change status — e.g. undo a wrong 'Mark as replied'"
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
                    {e.status === 'REPLIED' ? (
                      <Button variant="primary" size="sm" onClick={() => openPromote(e)} className="whitespace-nowrap">
                        Promote to company
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={markingReplied === e.id}
                        onClick={() => markReplied(e)}
                        className="whitespace-nowrap"
                      >
                        Mark as replied
                      </Button>
                    )}
                    <RowMenu
                      label={`Actions for ${e.name}`}
                      actions={[
                        { label: 'Edit details', icon: Pencil, onSelect: () => openEdit(e) },
                        {
                          label: 'Mark as replied',
                          icon: Send,
                          onSelect: () => markReplied(e),
                          visible: e.status !== 'REPLIED',
                        },
                        {
                          label: 'Promote to company',
                          icon: Building2,
                          onSelect: () => openPromote(e),
                          visible: e.status === 'REPLIED',
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
            onMore={() => { setLoadingMore(true); setPages((n) => n + 1); }}
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
          <FieldSelect label="Vertical" value={newVertical} onChange={setNewVertical} options={VERTICAL_OPTIONS} />
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
          <Button variant="primary" loading={adding} disabled={!newName.trim()} onClick={() => void addEntry()}>
            Add to the list
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={Boolean(promotingEntry)}
        onClose={() => setPromotingEntry(null)}
        title="Promote to company"
        description={
          promotingEntry
            ? `${promotingEntry.name} becomes a real Company — marked Replied, and visible everywhere else in the system from here on.`
            : undefined
        }
      >
        <ModalBody>
          <Field label="City" value={promoteCity} onChange={setPromoteCity} placeholder="Chennai" />
          <Field label="Contact name" value={promoteContactName} onChange={setPromoteContactName} placeholder="Who replied" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Contact email" type="email" value={promoteContactEmail} onChange={setPromoteContactEmail} placeholder="Optional" />
            <Field label="Contact phone" value={promoteContactPhone} onChange={setPromoteContactPhone} placeholder="Optional" />
          </div>
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
          <FieldSelect label="Vertical" value={editVertical} onChange={setEditVertical} options={VERTICAL_OPTIONS} />
          <FieldSelect label="Source" value={editSource} onChange={setEditSource} options={SOURCE_OPTIONS} />
          <FieldSelect
            label="Owner"
            value={editOwnerId}
            onChange={setEditOwnerId}
            options={personOptions(team)}
            placeholder="Unassigned"
          />
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
