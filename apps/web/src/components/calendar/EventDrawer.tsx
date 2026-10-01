"use client";

/**
 * One meeting or shoot, opened — from the calendar, or from a link
 * (/calendar?event=…) in the bell or an email.
 *
 * Says who booked it, who is on it, who from the client is coming, and for a
 * shoot each item of gear as it stands right now with a way to check it out.
 * Reserving is a plan; taking the gear out is still the asset's own checkout,
 * on the day, by a person.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { TriangleAlert } from "lucide-react";
import {
  api,
  ApiError,
  formatDate,
  type CalendarEventDetail,
} from "@/lib/api-v2";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NotFoundPanel } from "@/components/ui/not-found-panel";
import { useConfirmStore } from "@/stores/confirm";

const KIND_WORD = {
  MEETING: "Meeting",
  SHOOT: "Shoot",
  OTHER: "Event",
} as const;

export function EventDrawer({
  eventId,
  onClose,
  onEdit,
  onChanged,
}: {
  eventId: string | null;
  onClose: () => void;
  onEdit: (event: CalendarEventDetail) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirmStore((st) => st.confirm);
  const [busy, setBusy] = useState(false);
  const { data, error, refetch } = useQuery({
    queryKey: ["calendar-event", eventId],
    queryFn: () => api.calendar.event(eventId!),
    enabled: Boolean(eventId),
    retry: false,
  });

  if (!eventId) return null;
  const ev = data?.event;

  const remove = async () => {
    if (!ev) return;
    const ok = await confirm({
      title: `Cancel ${ev.title}?`,
      message: ev.attendees.length
        ? "Everybody on it is emailed that it is cancelled, and any gear it reserved is let go."
        : "Any gear it reserved is let go.",
      confirmText: "Cancel it",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.calendar.deleteEvent(ev.id);
      toast.success("Cancelled");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not cancel it");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      isOpen
      onClose={onClose}
      variant="slideover"
      title={ev?.title ?? "Event"}
      description={
        ev
          ? `${KIND_WORD[ev.kind]} · Booked by ${ev.createdBy.name}`
          : undefined
      }
    >
      {error && !data ? (
        <NotFoundPanel
          thing="event"
          error={error}
          back={{ href: "/calendar", label: "Back to the calendar" }}
          onRetry={() => refetch()}
        />
      ) : !ev ? (
        <p className="px-6 py-8 text-center text-sm text-secondary">Loading…</p>
      ) : (
        // The slideover gives a bare panel: the body scrolls, the actions sit
        // on the bottom edge — the task drawer's measurements.
        <div className="flex h-full flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <Card padding="none" className="overflow-hidden">
              <dl className="divide-y divide-border text-sm">
                <Row label="When" value={ev.when} />
                {ev.location && <Row label="Where" value={ev.location} />}
                <Row
                  label="People"
                  value={
                    ev.attendees.length
                      ? ev.attendees.map((a) => a.name).join(", ")
                      : "Nobody on it yet"
                  }
                />
                {ev.contacts.length > 0 && (
                  <Row
                    label="With"
                    value={
                      <span className="flex flex-col items-end gap-0.5">
                        {ev.contacts.map((c) => (
                          <span key={c.id}>
                            {c.name}
                            {ev.company ? ` (${ev.company.name})` : ""}
                            {/* Their phone and email only for people with the client book. */}
                            {(c.phone || c.email) && (
                              <span className="block text-xs font-normal text-secondary">
                                {[c.phone, c.email].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                        ))}
                      </span>
                    }
                  />
                )}
                {ev.company && <Row label={ev.company.status === 'PROSPECT' ? 'Prospect' : 'Client'} value={ev.company.name} />}
                {(ev.project || ev.retainer) && (
                  <Row
                    label="For"
                    value={ev.project?.name ?? ev.retainer?.name}
                  />
                )}
                <Row label="Booked by" value={ev.createdBy.name} />
              </dl>
            </Card>

            {ev.gear.length > 0 && (
              <section>
                <p className="eyebrow mb-2">Gear reserved</p>
                <Card padding="none" className="overflow-hidden">
                  <ul className="divide-y divide-border text-sm">
                    {ev.gear.map((g) => (
                      <li
                        key={g.assetId}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/assets/${g.assetId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {g.tag} {g.name}
                          </Link>
                          <p className="text-xs text-secondary">
                            {g.statusLine}
                          </p>
                        </div>
                        {g.checkoutHref && !ev.isPast && (
                          <Link
                            href={g.checkoutHref}
                            className="shrink-0 text-xs font-semibold text-primary hover:underline"
                          >
                            Check out
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            )}

            {data.clashes.length > 0 && !ev.isPast && (
              <div
                role="status"
                className="rounded-card border border-warning/30 bg-warning-tint px-4 py-3"
              >
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-warning-ink">
                  <TriangleAlert
                    className="h-4 w-4"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  In the way
                </p>
                <ul className="space-y-1 text-xs text-warning-ink">
                  {data.clashes.map((c, i) => (
                    <li key={i}>
                      {c.kind === "person" ? (
                        c.message
                      ) : (
                        <>
                          <span className="font-semibold">{c.subject}</span> —{" "}
                          {c.message}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ev.notes && (
              <section>
                <p className="eyebrow mb-2">Notes</p>
                <p className="whitespace-pre-wrap text-sm text-body">
                  {ev.notes}
                </p>
              </section>
            )}

            {data.history.length > 0 && (
              <section>
                <p className="eyebrow mb-2">History</p>
                <ul className="space-y-1.5 text-xs text-secondary">
                  {data.history.map((h, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-body">{h.text}</span>
                      <span className="shrink-0">{formatDate(h.at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          {data.canEdit && (
            <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
              <Button
                variant="danger"
                onClick={() => void remove()}
                loading={busy}
              >
                Cancel it
              </Button>
              <Button variant="primary" onClick={() => onEdit(ev)}>
                Change
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-secondary">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-primary">{value}</dd>
    </div>
  );
}
