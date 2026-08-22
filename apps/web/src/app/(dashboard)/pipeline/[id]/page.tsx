'use client';

/**
 * One deal.
 *
 * The screen the board's cards point at. Three rules from the plan are visible in
 * how it behaves:
 *
 * ① Stages can be moved freely, EXCEPT to Won. Winning needs terms — the type of
 *    work, the amount, the start date — so it goes through the dialog, and the
 *    server refuses a stage move that would win (master plan §1.3 ①).
 * ② The timeline records when things HAPPENED, not when they were typed (§3.9).
 * ③ A lost deal needs a reason. It is the only thing that makes "why do we lose?"
 *    answerable a year later (§3.4).
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Ban,
  Clock,
  FileText,
  Pause,
  Play,
  Plus,
  Trophy,
} from 'lucide-react';
import {
  api,
  ApiError,
  atLeast,
  formatDate,
  formatMoney,
  type OrgConfig,
  type Role,
  type Stage,
} from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { EmptyState, ErrorNote, Note } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { WinDealDialog } from '../components/WinDealDialog';
import { QuoteFormModal } from '../../quotations/components/QuoteFormModal';
import { CustomFieldsPanel } from './components/CustomFieldsPanel';
import { StageMoveModal } from './components/StageMoveModal';
import { LogActivityDialog } from '@/components/activities/LogActivityDialog';
import { ActivityFeed } from '@/components/activities/ActivityFeed';

type Deal = {
  id: string;
  title: string | null;
  value: string | null;
  expectedCloseDate: string | null;
  priority: string;
  isOnHold: boolean;
  holdReason: string | null;
  blockedOn: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostNote: string | null;
  createdAt: string;
  company: { id: string; name: string; status: string };
  stage: Stage;
  owner: { id: string; name: string } | null;
  source: { id: string; name: string } | null;
  lostReason: { id: string; name: string } | null;
  engagement: { id: string; type: string; amount: string; billingFrequency: string } | null;
  quotes: {
    id: string;
    number: string;
    status: string;
    total: string;
    sentAt: string | null;
    acceptedAt: string | null;
  }[];
  tasks: { id: string; title: string; status: string; dueDate: string | null }[];
  stageHistory: {
    id: string;
    enteredAt: string;
    fromStage: { name: string } | null;
    toStage: { name: string };
  }[];
  activities: { id: string; type: string; message: string; body: string | null; occurredAt: string }[];
  fieldValues: { fieldId: string; key: string; label: string; type: string; value: any }[];
};

export default function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [deal, setDeal] = useState<Deal | null>(null);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [winning, setWinning] = useState(false);
  const [losing, setLosing] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [logging, setLogging] = useState(false);
  const [parking, setParking] = useState(false);
  const [movingToStage, setMovingToStage] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, cfg] = await Promise.all([
        api.deals.get(id) as Promise<unknown> as Promise<Deal>,
        api.config.get(),
      ]);
      setDeal(d);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this deal');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageSkeleton />;

  if (!deal) {
    return (
      <EmptyState
        title="That deal does not exist"
        hint={error ?? undefined}
        action={
          <Link href="/pipeline">
            <Button>Back to the pipeline</Button>
          </Link>
        }
      />
    );
  }

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const money = (v: string | null | undefined) => formatMoney(v, currency, locale);
  const date = (v: string | null | undefined) => formatDate(v, tz, locale);
  const canWrite = atLeast(config?.me.role as Role | undefined, 'SALES');

  const closed = deal.stage.kind !== 'OPEN';
  const accepted = deal.quotes.find((q) => q.status === 'ACCEPTED');

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link
        href="/pipeline"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Pipeline
      </Link>

      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">
              {deal.title ?? 'Untitled deal'}
            </h1>
            <Badge tone={closed ? (deal.stage.kind === 'WON' ? 'good' : 'bad') : 'neutral'}>
              {deal.stage.name}
            </Badge>
          </div>
          <Link
            href={`/clients/${deal.company.id}`}
            className="mt-1 inline-block text-sm text-secondary hover:underline"
          >
            {deal.company.name}
          </Link>
        </div>

        {canWrite && !closed && (
          <div className="flex flex-wrap gap-2">
            <Button icon={FileText} onClick={() => setQuoting(true)}>
              Quote
            </Button>
            {deal.isOnHold ? (
              <Button icon={Play} disabled={busy} onClick={() => act(() => api.deals.unhold(deal.id))}>
                Resume
              </Button>
            ) : (
              <Button icon={Pause} disabled={busy} onClick={() => setParking(true)}>
                Park
              </Button>
            )}
            <Button variant="danger" icon={Ban} onClick={() => setLosing(true)}>
              Lost
            </Button>
            <Button variant="primary" icon={Trophy} onClick={() => setWinning(true)}>
              Win
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-5">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        {deal.isOnHold && (
          <Note tone="warn">
            Parked{deal.holdReason ? ` — ${deal.holdReason}` : ''}. It keeps its place in{' '}
            {deal.stage.name}.{' '}
            {/* Parked keeps its column. A deal pushed to a "waiting" stage loses
                where it actually was, and never comes back accurately (§3.4). */}
          </Note>
        )}

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {movingToStage && (
        <StageMoveModal
          dealId={deal.id}
          stage={movingToStage}
          currentFieldValues={deal.fieldValues}
          onConfirm={() => {
            setMovingToStage(null);
            void load();
          }}
          onCancel={() => setMovingToStage(null)}
        />
      )}

      {/* ── Stage ───────────────────────────────────────────────── */}
            <Card padding="none">
              <CardHeader>
                <CardTitle>Stage</CardTitle>
              </CardHeader>
              <CardBody>
                {closed ? (
                  <>
                    <p className="text-sm text-primary">
                      {deal.stage.kind === 'WON' ? 'Won' : 'Lost'} on {date(deal.wonAt ?? deal.lostAt)}
                    </p>
                    {deal.lostReason && (
                      <p className="mt-1 text-sm text-secondary">
                        {deal.lostReason.name}
                        {deal.lostNote ? ` — ${deal.lostNote}` : ''}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {config?.stages
                        .filter((s) => s.kind === 'OPEN')
                        .map((s) => (
                          <Button
                            key={s.id}
                            size="sm"
                            variant={s.id === deal.stage.id ? 'primary' : 'secondary'}
                            disabled={!canWrite || busy || s.id === deal.stage.id}
                            onClick={() => setMovingToStage(s)}
                          >
                            {s.name}
                          </Button>
                        ))}
                    </div>
                    {/*
                      Won is deliberately not in that row. Winning creates what
                      bills the client, so it asks for terms first — a drag that
                      quietly starts billing is the bug this rewrite exists for.
                    */}
                    <p className="mt-3 text-xs text-secondary">
                      Won is not a stage you drag to — it needs the terms, so it has its own button.
                      {deal.stage.requiresForecast &&
                        ' From here on a deal needs a value and an expected close date.'}
                    </p>
                  </>
                )}
              </CardBody>
            </Card>

            <CustomFieldsPanel 
              dealId={deal.id} 
              fieldValues={deal.fieldValues} 
              config={config!} 
              canEdit={canWrite} 
              onChanged={() => void load()} 
            />

            {/* ── Quotations ──────────────────────────────────────────── */}
            <Card padding="none">
              <CardHeader>
                <CardTitle>Quotations</CardTitle>
                {canWrite && !closed && (
                  <Button size="sm" icon={Plus} onClick={() => setQuoting(true)}>
                    New
                  </Button>
                )}
              </CardHeader>
              <CardBody>
                {deal.quotes.length === 0 ? (
                  <p className="text-sm text-secondary">None yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {deal.quotes.map((q) => (
                      <li key={q.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0">
                        <Link href="/quotations" className="font-mono text-xs text-primary hover:underline">
                          {q.number}
                        </Link>
                        <span className="text-sm tabular-nums text-primary">{money(q.total)}</span>
                        <span className="ml-auto text-xs text-secondary">
                          {q.status === 'ACCEPTED'
                            ? `accepted ${date(q.acceptedAt)}`
                            : q.sentAt
                              ? `sent ${date(q.sentAt)}`
                              : q.status.toLowerCase()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {accepted && !closed && (
                  <Note tone="info">
                    {accepted.number} is accepted. Winning the deal is what starts the billing.
                  </Note>
                )}
              </CardBody>
            </Card>

            {/* ── What happened ───────────────────────────────────────── */}
            <Card padding="none">
              <CardHeader>
                <CardTitle>What happened</CardTitle>
                {canWrite && (
                  <Button size="sm" icon={Plus} onClick={() => setLogging(true)}>
                    Log something
                  </Button>
                )}
              </CardHeader>
              <CardBody>
                <ActivityFeed
                  items={[
                    ...deal.activities.map((a) => ({
                      key: `a-${a.id}`,
                      at: a.occurredAt,
                      text: a.message,
                      body: a.body,
                    })),
                    ...deal.stageHistory.map((h) => ({
                      key: `h-${h.id}`,
                      at: h.enteredAt,
                      text: h.fromStage
                        ? `Moved from ${h.fromStage.name} to ${h.toStage.name}`
                        : `Started in ${h.toStage.name}`,
                      body: null,
                    })),
                  ]}
                />
              </CardBody>
            </Card>
          </div>

          {/* ── The facts ─────────────────────────────────────────────── */}
          <aside className="space-y-5">
            <Card padding="none">
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="space-y-2">
                  <Detail label="Value" value={money(deal.value)} />
                  <Detail label="Expected close" value={date(deal.expectedCloseDate)} />
                  <Detail label="Owner" value={deal.owner?.name ?? 'Nobody'} />
                  <Detail label="Source" value={deal.source?.name ?? '—'} />
                  <Detail label="Priority" value={deal.priority.toLowerCase()} />
                  <Detail label="Created" value={date(deal.createdAt)} />
                  {deal.blockedOn && <Detail label="Waiting on" value={deal.blockedOn} />}
                </dl>
              </CardBody>
            </Card>

            {deal.engagement && (
              <Card className="border-green-200 bg-green-50/40">
                <h2 className="text-sm font-semibold text-primary">What this became</h2>
                <p className="mt-2 text-sm text-primary">
                  {deal.engagement.type === 'RETAINER' ? 'Retainer' : 'Project'} ·{' '}
                  {money(deal.engagement.amount)}
                </p>
                <p className="mt-0.5 text-xs text-secondary">
                  Bills {deal.engagement.billingFrequency.toLowerCase().replace('_', ' ')}.
                </p>
                <Link
                  href="/revenue"
                  className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                >
                  See it in Revenue
                </Link>
              </Card>
            )}

            {deal.tasks.length > 0 && (
              <Card padding="none">
                <CardHeader>
                  <CardTitle>Tasks</CardTitle>
                </CardHeader>
                <CardBody>
                  <ul className="space-y-2">
                    {deal.tasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 text-sm">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-secondary" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1 truncate text-body">{t.title}</span>
                        <span className="shrink-0 text-xs text-secondary">{date(t.dueDate)}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}
          </aside>
        </div>
      </div>

      {winning && (
        <WinDealDialog
          dealId={deal.id}
          dealTitle={deal.title ?? 'Deal'}
          companyName={deal.company.name}
          // Pre-filled from the accepted quotation when there is one, so nobody
          // retypes a figure that is already agreed (§3.12).
          defaults={
            accepted ? { amount: accepted.total } : deal.value ? { amount: deal.value } : undefined
          }
          onClose={() => setWinning(false)}
          onWon={() => {
            setWinning(false);
            void load();
          }}
        />
      )}

      <LoseDialog
        open={losing}
        dealId={deal.id}
        reasons={config?.lostReasons ?? []}
        onClose={() => setLosing(false)}
        onLost={() => {
          setLosing(false);
          void load();
        }}
      />

      <ParkDialog
        open={parking}
        onClose={() => setParking(false)}
        onPark={(reason) => {
          setParking(false);
          void act(() => api.deals.hold(deal.id, reason));
        }}
      />

      <QuoteFormModal
        open={quoting}
        dealId={deal.id}
        onClose={() => setQuoting(false)}
        onCreated={() => {
          setQuoting(false);
          void load();
        }}
      />

      <LogActivityDialog
        open={logging}
        dealId={deal.id}
        companyId={deal.company.id}
        onClose={() => setLogging(false)}
        onLogged={() => {
          setLogging(false);
          void load();
        }}
      />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-xs text-secondary">{label}</dt>
      <dd className="text-right text-sm text-body">{value}</dd>
    </div>
  );
}

/**
 * Losing a deal.
 *
 * The reason is required, from a fixed list rather than free text — a year of
 * unique sentences cannot be counted, and "why do we lose?" is the question the
 * field exists to answer (§3.4).
 */
function LoseDialog({
  open,
  dealId,
  reasons,
  onClose,
  onLost,
}: {
  open: boolean;
  dealId: string;
  reasons: { id: string; name: string }[];
  onClose: () => void;
  onLost: () => void;
}) {
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReasonId('');
      setNote('');
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.deals.lose(dealId, reasonId, note || undefined);
      onLost();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not close it');
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Mark this lost">
      <form onSubmit={submit}>
        <ModalBody>
          <FieldSelect
            label="Why?"
            required
            value={reasonId}
            onChange={setReasonId}
            placeholder="Choose a reason…"
            options={reasons.map((r) => ({ value: r.id, label: r.name }))}
          />
          <p className="-mt-3 text-xs text-secondary">
            A fixed list, so a year of these can actually be counted.
          </p>

          <Field label="Anything else" value={note} onChange={setNote} textarea rows={3} />

          {error && <ErrorNote>{error}</ErrorNote>}

          <Note>Nothing is deleted. The deal stays, with its history, and can be reopened.</Note>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!reasonId}>
            Mark lost
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Parking keeps the deal's column — it is a flag, not a stage (§3.4). */
function ParkDialog({
  open,
  onClose,
  onPark,
}: {
  open: boolean;
  onClose: () => void;
  onPark: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Park this deal">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onPark(reason);
        }}
      >
        <ModalBody>
          <Field
            label="What is it waiting on?"
            value={reason}
            onChange={setReason}
            required
            placeholder="Their budget cycle, a decision from the founder…"
            hint="It keeps its place on the board — parked is a flag, not a stage."
          />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!reason}>
            Park it
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
