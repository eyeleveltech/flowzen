'use client';

/**
 * The equipment register.
 *
 * Four tabs, and the ORDER is the argument: All, then Out now, then In repair,
 * then Retired. "Out now" sits second because it is the only tab with a clock
 * running on it — the Monday question is not "what do we own" but "what has not
 * come back", and a board you have to go looking for is a board nobody opens.
 *
 * Prices appear only for `money.figures`, and not because this screen hides
 * them: the server does not send them. What the screen does is stop leaving a
 * column of dashes where a number would be, because an empty column reads as
 * missing data rather than as none of your business.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { plural } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Package, Plus } from 'lucide-react';
import { api, fileUrl, type AssetAccess, type AssetListItem, type AssetMovementRow, type AssetSummary } from '@/lib/api-v2';
import { usePageHeader } from '@/hooks/usePageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { Select } from '@/components/ui/select';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs } from '@/components/ui/tabs';
import { NewAssetModal } from '@/components/assets/NewAssetModal';
import { ImportAssetsModal } from '@/components/assets/ImportAssetsModal';
import {
  CATEGORY_OPTIONS,
  assetCategoryLabel,
  assetStatusLabel,
  assetTone,
  dueLabel,
  rupees,
  shortDate,
} from '@/lib/assets';

type Tab = 'ALL' | 'OUT' | 'REPAIR' | 'RETIRED';

const TABS: { key: Tab; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OUT', label: 'Out now' },
  { key: 'REPAIR', label: 'In repair' },
  { key: 'RETIRED', label: 'Retired' },
];

export default function AssetsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('ALL');
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [outNow, setOutNow] = useState<AssetMovementRow[]>([]);
  /** Tab counts, from the register rather than from the filtered rows. */
  const [counts, setCounts] = useState({ all: 0, out: 0, repair: 0, retired: 0 });
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [access, setAccess] = useState<AssetAccess>({ canManage: false, canSeeFigures: false });
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (category) params.category = category;
      if (search.trim()) params.q = search.trim();
      if (tab === 'REPAIR') params.status = 'IN_REPAIR';

      const [list, sum, out] = await Promise.all([
        api.assets.listFull(params),
        api.assets.summary(),
        api.assets.outNow(),
      ]);
      setAssets(list.data);
      setCounts(list.counts);
      setAccess(list.access);
      setSummary(sum.data);
      setOutNow(out);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the register');
    } finally {
      setLoading(false);
    }
  }, [category, search, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  // RETIRED covers all three ways an asset leaves — written off, sold, lost.
  // Three separate tabs for three endings nobody looks at daily would be three
  // mostly-empty screens.
  const rows = useMemo(() => {
    if (tab === 'RETIRED') return assets.filter((a) => ['RETIRED', 'SOLD', 'LOST'].includes(a.status));
    if (tab === 'REPAIR') return assets.filter((a) => a.status === 'IN_REPAIR');
    return assets.filter((a) => !['RETIRED', 'SOLD', 'LOST'].includes(a.status));
  }, [assets, tab]);

  usePageHeader('Assets', summary ? `${plural(summary.total, 'item')} on the register` : 'Company equipment');

  const csvParams = new URLSearchParams({ format: 'csv', ...(category ? { category } : {}) });

  return (
    <div className="page-shell">
      <div className="mb-8 flex flex-wrap items-center justify-end gap-2">
        <ExportCsvButton href={fileUrl(`/assets?${csvParams}`)} />
        {access.canManage && (
          <>
            {/* Seeding the register is a one-off hour with a spreadsheet, not
                sixty trips through the form. */}
            <Button size="sm" onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Enter kit
            </Button>
          </>
        )}
      </div>

      {/* The strip. Overdue is the one figure that can turn red, because it is
          the only one that is ever a problem rather than a fact. */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Every note describes the number ABOVE it and nothing else. Hanging
            "due for replacement" under the repair count read as a caption for
            it, so one item at the shop was captioned "nothing at the shop". */}
        <StatTile
          label="On the register"
          value={summary?.total ?? '—'}
          note={
            summary?.dueForReplacement
              ? `${summary.dueForReplacement} due for replacement`
              : 'items owned'
          }
        />
        <StatTile
          label="Out now"
          value={summary?.outNow ?? '—'}
          note={summary?.overdue ? `${summary.overdue} past due` : 'all within date'}
          tone={summary?.overdue ? 'danger' : undefined}
        />
        <StatTile
          label="In repair"
          value={summary?.inRepair ?? '—'}
          note={summary?.inRepair ? 'away being fixed' : 'nothing at the shop'}
        />
        {access.canSeeFigures ? (
          <StatTile
            label="Book value"
            value={rupees(summary?.totalBookValue)}
            note={`${rupees(summary?.totalPurchaseValue)} bought`}
            dark
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface p-5">
            <p className="eyebrow">Book value</p>
            <p className="mt-2 text-sm text-secondary">
              What the kit cost and what it is worth are hidden. What you can see is where every item
              is and who has it.
            </p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tag, name, make or serial"
          aria-label="Search the register"
          className="h-9 w-full max-w-xs rounded-xl border border-border bg-white px-3 text-sm text-body outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
        />
        <div className="w-52">
          <Select
            value={category}
            onChange={setCategory}
            options={[{ value: '', label: 'Every category' }, ...CATEGORY_OPTIONS]}
            ariaLabel="Filter by category"
          />
        </div>
      </div>

      {/* Counts from the server, never from `assets` — opening In repair puts
          `status=IN_REPAIR` on the fetch, so counting the rows on screen made
          All report the repair count and Retired report zero. */}
      <Tabs
        tabs={TABS.map((t) => ({
          ...t,
          count:
            t.key === 'ALL'
              ? counts.all
              : t.key === 'OUT'
                ? counts.out
                : t.key === 'REPAIR'
                  ? counts.repair
                  : counts.retired,
        }))}
        active={tab}
        onChange={setTab}
      />

      {error && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger-tint px-3 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      {tab === 'OUT' ? (
        <OutNowBoard movements={outNow} loading={loading} onOpen={(id) => router.push(`/assets/${id}`)} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border">
                  <Th>Tag</Th>
                  <Th>Item</Th>
                  <Th>Status</Th>
                  <Th>Held by</Th>
                  <Th>Due back</Th>
                  <Th>Condition</Th>
                  {access.canSeeFigures && <Th right>Book value</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-secondary">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-5">
                      <EmptyState
                        icon={Package}
                        title={tab === 'RETIRED' ? 'Nothing retired yet' : 'Nothing on the register yet'}
                        hint={
                          tab === 'RETIRED'
                            ? 'Kit that is written off, sold or lost stays here so the history survives it.'
                            : 'Enter a laptop or a lens and it gets a tag, a book value and a place to record who has it.'
                        }
                        action={
                          access.canManage && tab !== 'RETIRED' ? (
                            <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                              Enter kit
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  rows.map((a) => (
                    <tr
                      key={a.id}
                      className="cursor-pointer transition-colors hover:bg-subtle"
                      onClick={() => router.push(`/assets/${a.id}`)}
                    >
                      <td className="font-mono text-xs text-secondary">{a.tag}</td>
                      <td className="">
                        <p className="text-sm font-semibold text-primary">{a.name}</p>
                        <p className="text-micro text-secondary">
                          {assetCategoryLabel(a.category)}
                          {a.make ? ` · ${a.make}` : ''}
                        </p>
                      </td>
                      <td className="">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={assetTone(a.status)}>{assetStatusLabel(a.status)}</Badge>
                          {a.fullyDepreciated && !['RETIRED', 'SOLD', 'LOST'].includes(a.status) && (
                            <Badge tone="neutral">Due for replacement</Badge>
                          )}
                        </div>
                      </td>
                      <td className="text-secondary">
                        {a.currentHolder?.name ?? '—'}
                        {a.currentHolder && !a.currentHolder.active && (
                          <span className="ml-1.5 text-micro text-danger">(left)</span>
                        )}
                      </td>
                      <td className={`${a.overdue ? 'text-danger' : 'text-secondary'}`}>
                        {a.dueAt ? dueLabel(a.dueAt) : '—'}
                      </td>
                      <td className="text-secondary">{a.condition.toLowerCase()}</td>
                      {access.canSeeFigures && (
                        <td className="text-right tabular-nums text-primary">
                          {rupees(a.bookValue)}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {importing && (
        <ImportAssetsModal
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            void load();
          }}
        />
      )}

      {creating && (
        <NewAssetModal
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`eyebrow px-4 py-3 first:px-5 ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

/**
 * Out now: one card per open booking, late ones first.
 *
 * A board rather than a table because these are things to ACT on, not rows to
 * compare — and because the one number that matters, how late it is, deserves
 * to be the loudest thing on the card.
 */
function OutNowBoard({
  movements,
  loading,
  onOpen,
}: {
  movements: AssetMovementRow[];
  loading: boolean;
  onOpen: (assetId: string) => void;
}) {
  const sorted = useMemo(
    () => [...movements].sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0)),
    [movements],
  );

  if (loading) {
    return <p className="px-5 py-12 text-center text-sm text-secondary">Loading…</p>;
  }

  if (sorted.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          icon={Package}
          title="Nothing is out"
          hint="Every bookable item is in the office. When gear goes out on a shoot it shows up here with the date it is due back."
        />
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((m) => (
        <button
          key={m.id}
          onClick={() => onOpen(m.asset.id)}
          className={`rounded-xl border p-4 text-left transition-colors hover:bg-subtle ${
            m.overdue ? 'border-danger/30 bg-danger-tint/50' : 'border-border bg-white'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-primary">{m.asset.name}</p>
              <p className="font-mono text-micro text-secondary">{m.asset.tag}</p>
            </div>
            {m.overdue && (
              <span className="eyebrow flex shrink-0 items-center gap-1 text-danger">
                <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
                {m.daysOverdue}d late
              </span>
            )}
          </div>
          <dl className="mt-3 space-y-1">
            <Line label="With">{m.user.name}</Line>
            <Line label="For">{m.purpose || m.project?.name || 'not recorded'}</Line>
            <Line label="Back">{shortDate(m.dueAt)}</Line>
          </dl>
        </button>
      ))}
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="eyebrow w-10 shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-xs text-body">{children}</dd>
    </div>
  );
}
