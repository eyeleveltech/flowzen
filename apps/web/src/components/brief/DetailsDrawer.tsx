"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { ErrorNote } from "@/components/ui/empty-state";
import { api, ApiError, formatMoney, type BriefMetric } from "@/lib/api-v2";
import { shortDay, weekLabel } from "./format";

const TITLE: Record<BriefMetric, string> = {
  cash: "Cash collected",
  invoiced: "Invoiced",
  deals: "Deals won",
  proposals: "Proposals sent",
  tasks: "Tasks done",
};
const EMPTY: Record<BriefMetric, string> = {
  cash: "No payments came in that week.",
  invoiced: "No invoices were raised that week.",
  deals: "No deals were won that week.",
  proposals: "No proposal versions went out that week.",
  tasks: "No tasks were finished that week.",
};

type Row = {
  id?: string;
  date?: string | null;
  clientName?: string;
  number?: string;
  amount?: number;
  value?: number;
  ownerName?: string;
  version?: number;
  link?: string | null;
  departmentId?: string | null;
  dept?: string;
  done?: number;
  onTime?: number;
};

/**
 * What is behind one number, for that number's week. Every row opens its
 * record — except tasks, which are by department only: no names, no list.
 */
export function DetailsDrawer({
  metric,
  week,
  currency,
  onClose,
}: {
  metric: BriefMetric | null;
  week: { from: string; to: string };
  currency: string;
  onClose: () => void;
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ["brief-details", metric, week.from],
    queryFn: () => api.brief.details(metric!, week.from),
    enabled: Boolean(metric),
  });
  const rows = (data?.rows ?? []) as Row[];
  const money = (n: number | undefined) => formatMoney(n ?? 0, currency);

  const line = (r: Row) => {
    switch (metric) {
      case "cash":
        return {
          main: `${r.clientName} · ${r.number}`,
          sub: r.date ? shortDay(r.date) : "",
          figure: money(r.amount),
        };
      case "invoiced":
        return {
          main: `${r.number} · ${r.clientName}`,
          sub: r.date ? shortDay(r.date) : "",
          figure: money(r.amount),
        };
      case "deals":
        return {
          main: r.clientName ?? "",
          sub: [r.ownerName, r.date ? `won ${shortDay(r.date)}` : null]
            .filter(Boolean)
            .join(" · "),
          figure: money(r.value),
        };
      case "proposals":
        return {
          main: `${r.clientName} · version ${r.version}`,
          sub: r.date ? `sent ${shortDay(r.date)}` : "",
          figure: money(r.value),
        };
      default:
        return { main: "", sub: "", figure: "" };
    }
  };

  return (
    <Drawer
      isOpen={Boolean(metric)}
      onClose={onClose}
      variant="slideover"
      title={metric ? TITLE[metric] : ""}
      description={`Week of ${weekLabel(week.from, week.to)}`}
    >
      <div className="px-5 py-4">
        {error ? (
          <ErrorNote>
            {error instanceof ApiError
              ? error.message
              : "Could not load what is behind this number."}
          </ErrorNote>
        ) : isPending ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-11 animate-pulse rounded-lg bg-subtle"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-secondary">
            {metric ? EMPTY[metric] : ""}
          </p>
        ) : metric === "tasks" ? (
          <div>
            <p className="mb-3 text-xs text-secondary">
              By department only — who did which task is not shown here.
            </p>
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li
                  key={r.departmentId ?? 'none'}
                  className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
                >
                  <span className="font-medium text-primary">{r.dept}</span>
                  <span className="tabular-nums text-secondary">
                    {r.done} done ·{" "}
                    {r.done ? Math.round(((r.onTime ?? 0) / r.done) * 100) : 0}%
                    on time
                  </span>
                </li>
              ))}
            </ul>
            {data?.total && (
              <p className="mt-3 text-xs text-secondary">
                {data.total.done} tasks in all,{" "}
                {data.total.done
                  ? Math.round((data.total.onTime / data.total.done) * 100)
                  : 0}
                % on time. A task shared by two departments counts in each
                above.
              </p>
            )}
          </div>
        ) : (
          <>
            <ul className="-mx-2">
              {rows.map((r) => {
                const l = line(r);
                const inner = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-primary">
                        {l.main}
                      </span>
                      {l.sub && (
                        <span className="block text-xs text-secondary">
                          {l.sub}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                      {l.figure}
                    </span>
                  </>
                );
                return (
                  <li key={r.id}>
                    {r.link ? (
                      <Link
                        href={r.link}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        {inner}
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-line"
                          aria-hidden="true"
                        />
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-2 py-2.5">
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {data?.more && (
              <p className="mt-2 text-xs text-secondary">
                Showing the first 100.
              </p>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
