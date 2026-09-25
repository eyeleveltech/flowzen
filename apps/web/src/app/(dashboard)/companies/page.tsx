"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { ShowMore } from "@/components/ui/show-more";
import { ErrorNote } from "@/components/ui/empty-state";
import { plural } from "@/lib/utils";
import { api, formatMoney } from "@/lib/api-v2";
import { useAuthStore } from "@/stores";
import { NewClientModal } from "@/components/clients/NewClientModal";
import { ImportClientsModal } from "@/components/clients/ImportClientsModal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePageHeader } from "@/hooks/usePageHeader";
import { StatTile, StatRow } from "@/components/ui/stat-tile";
import { Tabs, type TabDef } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { verticalLabel } from "@/lib/vertical";

type CompanyFilter = "ALL" | "CLIENT" | "PROSPECT" | "PAST";

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
  CLIENT: "Client",
  PROSPECT: "Prospect",
  PAST: "Past",
};

/*
 * Through the shared Badge rather than three hand-written pill classes: the
 * same three states are drawn on the client record, the outreach list and the
 * pipeline, and they had all agreed only by accident.
 */
const STATUS_TONE: Record<string, Tone> = {
  CLIENT: "good",
  PROSPECT: "warn",
  PAST: "neutral",
};

export default function CompaniesPage() {
  const { user } = useAuthStore();
  const [filter, setFilter] = useState<CompanyFilter>("ALL");
  /** A failed load, said out loud instead of only in the console. */
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
  const queryClient = useQueryClient();
  const [pages, setPages] = useState(1);

  // A new tab starts again at the first page.
  useEffect(() => {
    setPages(1);
  }, [filter]);

  /**
   * The list, its tab counts and the summary strip — one cached query.
   *
   * This was a `useCallback` writing into six pieces of `useState` from a
   * `useEffect`, so every arrival on this screen refetched from scratch and
   * rendered through an empty state first. The query key carries the tab and
   * how many pages have been pulled in, so going back to a tab you already
   * opened is served from cache while it revalidates.
   *
   * `keepPreviousData` is what stops "Load more" blanking the list: the rows
   * already on screen stay put while the longer page is fetched.
   */
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ["companies", filter, pages],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const rows: CompanyItem[] = [];
      let last: any = null;
      for (let p = 1; p <= pages; p++) {
        const params: Record<string, string> = { page: String(p) };
        if (filter !== "ALL") params.status = filter;
        const res = await api.companies.list(params);
        // The list endpoint returns { success, companies, meta, summary, counts }
        // rather than a bare array, so this does not auto-unwrap.
        last = res as any;
        rows.push(...(last.companies ?? (Array.isArray(last) ? last : [])));
      }
      return {
        companies: rows,
        total: last?.meta?.total ?? rows.length,
        // Both of these come from the server precisely BECAUSE the rows above
        // are filtered. Deriving them from the rows is the bug this page had:
        // open a tab and every other tab reported itself empty, the tiles
        // collapsed, and the outreach figure was a hardcoded 380 against 7.
        summary: last?.summary as Summary | undefined,
        counts: last?.counts as Counts | undefined,
      };
    },
  });

  const companies = data?.companies ?? [];
  const total = data?.total ?? 0;
  const summary: Summary = data?.summary ?? {
    clients: 0,
    prospects: 0,
    past: 0,
    total: 0,
    outreachCount: 0,
    contractedMonthly: null,
    retainerCount: 0,
  };
  const counts: Counts = data?.counts ?? {
    ALL: 0,
    CLIENT: 0,
    PROSPECT: 0,
    PAST: 0,
  };
  const loadError =
    error instanceof Error
      ? error.message
      : error
        ? "Could not load the client list"
        : null;
  const loading = isPending;
  // Only the "Load more" button spins; the first load has its own empty state.
  const loadingMore = isFetching && !isPending;

  /** What the create/import flows call once they have changed something. */
  const load = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["companies"] });
  }, [queryClient]);

  // Deep link from Quick Create. This used to sit inside the loader, so it
  // re-ran on every refetch rather than once on arrival.
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("create") === "true"
    ) {
      setCreateOpen(true);
      router.replace("/companies");
    }
  }, [router]);

  // The server already applied the tab. Filtering again here was harmless,
  // but it is the tell: this page believed `companies` was the whole list,
  // and every count it derived from that belief inherited it.
  //
  // There is also no search box on this screen — `search` was declared,
  // passed to the API and never settable by anything, so it is gone. The
  // endpoint still takes the parameter and the tab counts still narrow with
  // it, for the day a box appears.
  const filtered = companies;

  usePageHeader("Companies", plural(summary.total, "record"));

  return (
    <div className="page-shell">
      {loadError && (
        <div className="mb-6">
          {/*
            A failed load used to reach console.error and stop, so the screen
            rendered its empty state and "the server is down" looked exactly
            like "you have nothing yet".
          */}
          <ErrorNote
            onDismiss={() =>
              queryClient.resetQueries({
                queryKey: ["companies", filter, pages],
              })
            }
          >
            {loadError}
          </ErrorNote>
        </div>
      )}

      {/*
        Import, and only import.

        Creating a company here was taken away on purpose — a company starts as
        an outreach lead and is promoted — and Export went with it. The importer
        went too, in the same pass, which left a screen with no way to bring a
        client list in at all and a modal nothing could open. It is how the
        eighteen real companies got here in the first place.
      */}
      <div className="mb-6 flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-3.5 w-3.5" strokeWidth={2} />
          Import
        </Button>
      </div>

      <StatRow className="mb-8">
        <StatTile
          label="Clients"
          value={summary.clients}
          note="live engagements"
        />
        <StatTile
          label="Prospects"
          value={summary.prospects}
          note="real conversations"
        />
        <StatTile
          label="In the Outreach List"
          value={summary.outreachCount}
          note="kept out of this list"
        />
        <StatTile
          label="Contracted Monthly"
          value={
            summary.contractedMonthly === null
              ? "Hidden"
              : formatMoney(summary.contractedMonthly)
          }
          note={
            summary.contractedMonthly === null
              ? `${plural(summary.retainerCount, "retainer")} running`
              : `across ${plural(summary.retainerCount, "retainer")}`
          }
          dark
        />
      </StatRow>

      <Tabs
        tabs={
          [
            { key: "ALL", label: "All", count: counts.ALL },
            { key: "CLIENT", label: STATUS_LABEL.CLIENT, count: counts.CLIENT },
            {
              key: "PROSPECT",
              label: STATUS_LABEL.PROSPECT,
              count: counts.PROSPECT,
            },
            { key: "PAST", label: STATUS_LABEL.PAST, count: counts.PAST },
          ] as TabDef<CompanyFilter>[]
        }
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
                <th className="eyebrow text-left">Industry</th>
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
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-sm text-secondary"
                  >
                    Loading...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-16 text-center text-sm text-secondary"
                  >
                    No companies found.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
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
                    <td className="text-secondary">
                      {verticalLabel(c.vertical)}
                    </td>
                    <td className="">
                      <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </Badge>
                    </td>
                    <td className="text-secondary">{c.owner?.name ?? "—"}</td>
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
                      <span
                        className="block truncate"
                        title={c.attentionSentence ?? undefined}
                      >
                        {c.attentionSentence ?? (
                          <span className="text-muted">Nothing to flag</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && (
          <ShowMore
            shown={filtered.length}
            total={total}
            loading={loadingMore}
            noun="record"
            onMore={() => setPages((p) => p + 1)}
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

      {/*
        Still mounted, with no button on this page to open it.

        Creation is reached from where a company actually begins — the
        pipeline's "New lead", and Quick Create — both of which arrive here as
        `?create=true`. Unmounting this would leave those two pointing at
        nothing, and the pipeline's own note is the reason they point here at
        all: a pipeline starts with a lead, and a lead IS a company.
      */}
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
