'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShowMore } from '@/components/ui/show-more';
import { ErrorNote } from '@/components/ui/empty-state';
import { plural } from '@/lib/utils';
import { api, fileUrl, formatMoney } from '@/lib/api-v2';
import { useAuthStore } from '@/stores';
import { NewClientModal } from '@/components/clients/NewClientModal';
import { ImportClientsModal } from '@/components/clients/ImportClientsModal';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge, type Tone } from '@/components/ui/badge';
import { verticalLabel } from '@/lib/vertical';

type CompanyFilter = 'ALL' | 'CLIENT' | 'PROSPECT' | 'PAST';

interface CompanyItem {
  id: string;
  name: string;
  vertical: string;
  status: string;
  owner?: { id: string; name: string } | null;
  /**
   * `monthlyValue` is NULL for a caller without money.figures — the server
   * masks it rather than sending it and trusting the screen to hide it. Typing
   * it as `number` is what let `n.toLocaleString()` past the compiler and
   * turned this page into a blank screen for Business Development, whose whole
   * job is this list.
   */
  activeRetainer?: { monthlyValue: number | null } | null;
  liveProjectsCount: number;
  attentionSentence?: string | null;
  updatedAt: string;
}

/**
 * The state of the business — every client, every prospect, whatever the tab.
 *
 * Sent by the server, deliberately, rather than counted here from the rows on
 * screen. Counting the rows is what made the Prospects tile read 0 while the
 * Prospect tab was open, and Contracted Monthly read ₹0 on an agency with
 * ₹4,85,000 a month contracted.
 */
interface Summary {
  clients: number;
  prospects: number;
  past: number;
  total: number;
  outreachCount: number;
  /** Null when the caller may not see figures — not zero. */
  contractedMonthly: number | null;
  retainerCount: number;
}

/** What each tab WOULD show. Follows the search, ignores the chosen tab. */
type Counts = Record<CompanyFilter, number>;

const STATUS_LABEL: Record<string, string> = {
  CLIENT: 'Client',
  PROSPECT: 'Prospect',
  PAST: 'Past',
};

/*
 * Through the shared Badge rather than three hand-written pill classes: the
 * same three states are drawn on the client record, the outreach list and the
 * pipeline, and they had all agreed only by accident.
 */
const STATUS_TONE: Record<string, Tone> = {
  CLIENT: 'good',
  PROSPECT: 'warn',
  PAST: 'neutral',
};

export default function CompaniesPage() {
  const { user } = useAuthStore();
  const [filter, setFilter] = useState<CompanyFilter>('ALL');
  /** A failed load, said out loud instead of only in the console. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ clients: 0, prospects: 0, past: 0, total: 0, outreachCount: 0, contractedMonthly: null, retainerCount: 0 });
  const [counts, setCounts] = useState<Counts>({ ALL: 0, CLIENT: 0, PROSPECT: 0, PAST: 0 });
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const router = useRouter();

  /**
   * How many pages of this list have been asked for.
   *
   * The endpoint has always paginated at 200 and the screen has never sent a
   * page number, so client 201 was unreachable and nothing said so. Pages
   * accumulate rather than replace: this is a list you scan, not a book you
   * flip through, and losing your place to see the next 200 is worse than a
   * long page.
   */
  const [pages, setPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // A new tab starts again at the first page.
  useEffect(() => { setPages(1); }, [filter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows: CompanyItem[] = [];
      let data: any = null;
      for (let p = 1; p <= pages; p++) {
        const params: Record<string, string> = { page: String(p) };
        if (filter !== 'ALL') params.status = filter;
        const res = await api.companies.list(params);
        // api.companies.list returns Company[] directly, but our list endpoint returns { success, companies }
        // Use type assertion
        data = res as any;
        rows.push(...(data.companies ?? (Array.isArray(data) ? data : [])));
      }
      const list = rows;
      setCompanies(list);
      setTotal(data?.meta?.total ?? list.length);

      // Both of these come from the server precisely BECAUSE the rows above
      // are filtered. Deriving them from `list` is the bug this page had: open
      // a tab and every other tab reported itself empty, the tiles collapsed,
      // and the outreach figure was a hardcoded 380 against a real 7.
      if (data.summary) setSummary(data.summary);
      if (data.counts) setCounts(data.counts);

      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('create') === 'true') {
        setCreateOpen(true);
        router.replace('/companies');
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the client list');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter, pages, router]);

  useEffect(() => { load(); }, [load]);

  // The server already applied the tab. Filtering again here was harmless,
  // but it is the tell: this page believed `companies` was the whole list,
  // and every count it derived from that belief inherited it.
  //
  // There is also no search box on this screen — `search` was declared,
  // passed to the API and never settable by anything, so it is gone. The
  // endpoint still takes the parameter and the tab counts still narrow with
  // it, for the day a box appears.
  const filtered = companies;

  usePageHeader('Companies', plural(summary.total, 'record'));

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
          <ExportCsvButton href={fileUrl('/companies?format=csv')} />
          {/* The importer was written, tested and then never mounted — the
              only way in was to type companies one at a time. */}
          <button
            className="flex items-center gap-1.5 border border-border text-sm font-medium text-body px-3 h-8 rounded-lg hover:bg-subtle transition-colors"
            onClick={() => setImportOpen(true)}
          >
            Import
          </button>
          <button
            className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 h-8 rounded-lg hover:bg-primary/90 transition-colors"
            onClick={() => setCreateOpen(true)}
          >
            <span className="text-base leading-none">+</span> New
          </button>
      </div>

      <StatRow className="mb-8">
        <StatTile label="Clients" value={summary.clients} note="live engagements" />
        <StatTile label="Prospects" value={summary.prospects} note="real conversations" />
        <StatTile
          label="In the Outreach List"
          value={summary.outreachCount}
          note="kept out of this list"
        />
        <StatTile
          label="Contracted Monthly"
          value={summary.contractedMonthly === null ? 'Hidden' : formatMoney(summary.contractedMonthly)}
          note={
            summary.contractedMonthly === null
              ? `${plural(summary.retainerCount, 'retainer')} running`
              : `across ${plural(summary.retainerCount, 'retainer')}`
          }
          dark
        />
      </StatRow>

      <Tabs
        tabs={[
          { key: 'ALL', label: 'All', count: counts.ALL },
          { key: 'CLIENT', label: STATUS_LABEL.CLIENT, count: counts.CLIENT },
          { key: 'PROSPECT', label: STATUS_LABEL.PROSPECT, count: counts.PROSPECT },
          { key: 'PAST', label: STATUS_LABEL.PAST, count: counts.PAST },
        ] as TabDef<CompanyFilter>[]}
        active={filter}
        onChange={setFilter}
      />

      {/* Table */}
      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full data-table">
          <thead>
            <tr className="border-b border-border">
              <th className="eyebrow text-left">Company</th>
              <th className="eyebrow text-left">Vertical</th>
              <th className="eyebrow text-left">Status</th>
              <th className="eyebrow text-left">Owner</th>
              <th className="eyebrow text-right">Retainer / mo</th>
              {/* Left, not right. It is a sentence — "Newly added prospect; no
                  proposal sent yet" — and right-aligned prose makes the eye
                  find a new starting point on every row. */}
              <th className="eyebrow text-left">What’s happening</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-secondary">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-16 text-center text-sm text-secondary">No companies found.</td></tr>
            ) : filtered.map(c => (
              <tr
                key={c.id}
                className="hover:bg-subtle transition-colors cursor-pointer"
                // router.push, not window.location: a full page reload throws
                // away the session already in memory and re-downloads the app
                // to move between two screens of it.
                onClick={() => router.push(`/companies/${c.id}`)}
              >
                <td className="">
                  {/*
                    A real link, not just the row's click handler. You cannot
                    Tab to a table row, so with the handler alone a keyboard or
                    screen-reader user could not open a single client from this
                    list — the primary way into the app. It also makes
                    middle-click-to-new-tab work, which is a mouse benefit.
                  */}
                  <Link
                    href={`/companies/${c.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-semibold text-primary rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {c.name}
                  </Link>
                </td>
                {/* "HOSPITALITY", "IT AND SAAS" — the enum, shouted. The
                    outreach list already had a map for these; both screens
                    read the same one now. */}
                <td className="text-secondary">{verticalLabel(c.vertical)}</td>
                <td className="">
                  <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                </td>
                <td className="text-secondary">{c.owner?.name ?? '—'}</td>
                {/* Tabular, so the rupee figures line up down the column
                    instead of drifting with the digit widths. */}
                <td className="text-right tabular-nums">
                  {c.activeRetainer ? (
                    formatMoney(c.activeRetainer.monthlyValue)
                  ) : (
                    // Fourteen of twenty-one rows have no retainer. A muted
                    // dash says "not applicable" without drawing the eye down
                    // a column of them.
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="max-w-72 text-xs text-secondary">
                  <span className="block truncate" title={c.attentionSentence ?? undefined}>
                    {c.attentionSentence ?? <span className="text-muted">Nothing to flag</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!loading && (
          <ShowMore
            shown={filtered.length}
            total={total}
            loading={loadingMore}
            noun="record"
            onMore={() => { setLoadingMore(true); setPages((p) => p + 1); }}
          />
        )}
      </Card>

      {importOpen && (
        <ImportClientsModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            void load();
          }}
        />
      )}

      {createOpen && (
        <NewClientModal
          onConfirm={() => {
            setCreateOpen(false);
            load();
          }}
          onCancel={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}
