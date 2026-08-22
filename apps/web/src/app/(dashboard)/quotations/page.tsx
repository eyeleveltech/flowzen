'use client';

/**
 * Quotations.
 *
 * Flowzen produces the document. The client's ANSWER arrives outside Flowzen — by
 * email, on a call, or in a meeting — so it is recorded by hand. There is no
 * accept link and no client portal (master plan §7.3).
 *
 * That single fact shapes the screen. A quotation nobody answered is not a state
 * anyone types in, so silence is the one thing the system has to raise by itself
 * — hence the band at the top (§3.12).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, FileText, Plus, Send } from 'lucide-react';
import {
  api,
  atLeast,
  formatDate,
  formatMoney,
  type OrgConfig,
  type Role,
  type WinTerms,
} from '@/lib/api-v2';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorNote, Note } from '@/components/ui/empty-state';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton-loaders';
import { QuoteFormModal } from './components/QuoteFormModal';
import { RecordAnswerDialog } from './components/RecordAnswerDialog';
import { MarkSentDialog } from './components/MarkSentDialog';
import { WinDealDialog } from '../pipeline/components/WinDealDialog';

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

export type QuoteRow = {
  id: string;
  number: string;
  status: QuoteStatus;
  total: string;
  subtotal: string;
  engagementType: 'RETAINER' | 'PROJECT';
  billingFrequency: string;
  validUntil: string | null;
  sentAt: string | null;
  sentVia: string | null;
  acceptedAt: string | null;
  acceptedVia: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  createdAt: string;
  company: { id: string; name: string };
  deal: { id: string; title: string | null };
};

const STATUS: Record<QuoteStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SENT: { label: 'Sent', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'good' },
  DECLINED: { label: 'Declined', tone: 'bad' },
  // Expiry is a date passing, not a decision anybody made.
  EXPIRED: { label: 'Expired', tone: 'warn' },
};

const FILTERS: { value: '' | QuoteStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'DECLINED', label: 'Declined' },
];

/** What the document is actually offering, in words rather than two enums. */
const shape = (q: Pick<QuoteRow, 'engagementType' | 'billingFrequency'>): string => {
  if (q.engagementType === 'PROJECT') return 'Project';
  const every: Record<string, string> = {
    MONTHLY: 'a month',
    QUARTERLY: 'a quarter',
    YEARLY: 'a year',
    ONE_TIME: 'once',
  };
  return `Retainer · ${every[q.billingFrequency] ?? q.billingFrequency.toLowerCase()}`;
};

export default function QuotationsPage() {
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [waiting, setWaiting] = useState<QuoteRow[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [filter, setFilter] = useState<'' | QuoteStatus>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<QuoteRow | null>(null);
  /** Confirmation that a message actually left, and where it went. */
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [answering, setAnswering] = useState<QuoteRow | null>(null);
  const [winning, setWinning] = useState<{ quote: QuoteRow; defaults: Partial<WinTerms> } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const [list, awaiting, cfg] = await Promise.all([
        api.quotes.list() as Promise<unknown> as Promise<QuoteRow[]>,
        api.quotes.awaitingReply() as Promise<unknown> as Promise<QuoteRow[]>,
        api.config.get(),
      ]);
      setQuotes(Array.isArray(list) ? list : []);
      setWaiting(Array.isArray(awaiting) ? awaiting : []);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load quotations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const money = (v: string | null | undefined) => formatMoney(v, currency, locale);
  const date = (v: string | null | undefined) => formatDate(v, tz, locale);
  const canWrite = atLeast(config?.me.role as Role | undefined, 'SALES');

  const visible = useMemo(
    () => (filter ? quotes.filter((q) => q.status === filter) : quotes),
    [quotes, filter],
  );

  if (loading) return <TableSkeleton rows={6} />;

  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle={`${quotes.length} in total`}
        action={
          canWrite && (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New quotation
            </Button>
          )
        }
      />

      <div className="space-y-5">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
        {sentNotice && <Note onDismiss={() => setSentNotice(null)}>{sentNotice}</Note>}

        {/* ── Sent, and nobody has answered ───────────────────────────────────
            Accepted and declined both get recorded by a person. Silence gets
            recorded by nobody, which is exactly why it belongs here (§3.12). */}
        {waiting.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/40">
            <div className="mb-3 flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={1.75} />
              <div>
                <h2 className="text-sm font-semibold text-primary">Waiting on an answer</h2>
                <p className="mt-0.5 text-xs text-secondary">
                  Sent over a week ago with no reply recorded. Chase it, or record the answer if it
                  already came.
                </p>
              </div>
            </div>

            <ul className="space-y-1.5">
              {waiting.map((q) => (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white px-3 py-2"
                >
                  <span className="text-sm font-medium text-primary">{q.company.name}</span>
                  <span className="text-xs text-secondary">
                    {q.number} · {money(q.total)} · sent {date(q.sentAt)}
                  </span>
                  {canWrite && (
                    <Button size="sm" className="ml-auto" onClick={() => setAnswering(q)}>
                      Record the answer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const count = f.value === '' ? quotes.length : quotes.filter((q) => q.status === f.value).length;
            return (
              <Button
                key={f.value || 'all'}
                size="sm"
                variant={filter === f.value ? 'primary' : 'secondary'}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                <span className={filter === f.value ? 'text-white/60' : 'text-secondary'}>{count}</span>
              </Button>
            );
          })}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={quotes.length === 0 ? 'No quotations yet' : 'Nothing with that status'}
            hint={
              quotes.length === 0
                ? 'A quotation is raised against a deal, so start one from the pipeline or with the button above.'
                : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Number</TH>
                <TH>Client</TH>
                <TH>What it offers</TH>
                <TH numeric>Total</TH>
                <TH>Status</TH>
                <TH>Latest</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {visible.map((q) => (
                <TR key={q.id}>
                  <TD className="font-mono text-xs text-secondary">{q.number}</TD>
                  <TD>
                    <Link
                      href={`/clients/${q.company.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {q.company.name}
                    </Link>
                    <Link
                      href={`/pipeline/${q.deal.id}`}
                      className="block truncate text-xs text-secondary hover:underline"
                    >
                      {q.deal.title ?? 'Deal'}
                    </Link>
                  </TD>
                  <TD className="text-xs text-secondary">{shape(q)}</TD>
                  <TD numeric className="font-medium text-primary">
                    {money(q.total)}
                  </TD>
                  <TD>
                    <Badge tone={STATUS[q.status].tone}>{STATUS[q.status].label}</Badge>
                  </TD>
                  {/*
                    The date shown is when the THING happened — the client agreed
                    on Tuesday even if it was typed in on Friday (§3.12).
                  */}
                  <TD className="text-xs text-secondary">
                    {q.status === 'ACCEPTED'
                      ? `Accepted ${date(q.acceptedAt)}`
                      : q.status === 'DECLINED'
                        ? `Declined ${date(q.declinedAt)}`
                        : q.sentAt
                          ? `Sent ${date(q.sentAt)}`
                          : `Drafted ${date(q.createdAt)}`}
                  </TD>
                  <TD>
                    {canWrite && (q.status === 'DRAFT' || q.status === 'SENT') && (
                      <div className="flex justify-end gap-1.5">
                        {q.status === 'DRAFT' && (
                          <Button size="sm" icon={Send} onClick={() => setSending(q)}>
                            Mark sent
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setAnswering(q)}>
                          Record answer
                        </Button>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        <Note>
          Flowzen produces the document; the answer comes back outside it, so somebody records it.
          There is no accept link and no client portal.
        </Note>
      </div>

      <QuoteFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
      />

      <MarkSentDialog
        quote={sending}
        mailConfigured={config?.mailConfigured ?? false}
        onClose={() => setSending(null)}
        onSent={(message) => {
          setSending(null);
          setSentNotice(message ?? null);
          void load();
        }}
      />

      <RecordAnswerDialog
        quote={answering}
        onClose={() => setAnswering(null)}
        onRecorded={(win) => {
          const quote = answering;
          setAnswering(null);
          void load();
          // Accepting OFFERS the win, pre-filled from this quotation. It does
          // not perform it — winning needs a start date this person may not
          // have, and the terms are what start the billing (§3.12).
          if (win && quote) setWinning({ quote, defaults: win });
        }}
      />

      {winning && (
        <WinDealDialog
          dealId={winning.quote.deal.id}
          dealTitle={winning.quote.deal.title ?? 'Deal'}
          companyName={winning.quote.company.name}
          defaults={winning.defaults}
          onClose={() => setWinning(null)}
          onWon={() => {
            setWinning(null);
            void load();
          }}
        />
      )}
    </>
  );
}
