'use client';

/**
 * Revenue.
 *
 * One screen replacing six — contracts, subscriptions, invoice drafts, invoices,
 * receivables and renewals were all views onto the same two things: what a client
 * has agreed to pay, and what has actually happened about it (master plan §3.6).
 *
 * Admin and above. Money is the one real dividing line in an agency; everything
 * else is more useful shared than guarded (§3.10).
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CreditCard, Download, Plus, Send } from 'lucide-react';
import { api, ApiError, formatDate, formatMoney, type OrgConfig } from '@/lib/api-v2';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { RecordPaymentDialog } from '@/components/revenue/RecordPaymentDialog';

type Summary = {
  mrr: string;
  billed: string;
  collected: string;
  outstanding: string;
  overdue: string;
};

type DueEngagement = {
  id: string;
  type: string;
  amount: string;
  billingFrequency: string;
  nextBillingDate: string | null;
  company: { id: string; name: string };
};

type Invoice = {
  id: string;
  number: string;
  status: string;
  total: string;
  paid: string;
  balance: string;
  issueDate: string;
  dueDate: string;
  isOverdue: boolean;
  company: { id: string; name: string };
};

export default function RevenuePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [due, setDue] = useState<DueEngagement[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [attention, setAttention] = useState<{ expiring: unknown[]; dueForReview: unknown[] }>({
    expiring: [],
    dueForReview: [],
  });
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, d, i, a, cfg] = await Promise.all([
        api.revenue.summary() as Promise<unknown> as Promise<Summary>,
        api.revenue.dueForBilling() as Promise<unknown> as Promise<DueEngagement[]>,
        api.revenue.invoices() as Promise<unknown> as Promise<Invoice[]>,
        api.revenue.attention(),
        api.config.get(),
      ]);
      setSummary(s);
      setDue(Array.isArray(d) ? d : []);
      setInvoices(Array.isArray(i) ? i : []);
      setAttention(a);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load revenue');
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

  const raise = async (engagementId: string) => {
    setBusy(engagementId);
    try {
      await api.revenue.raiseInvoice(engagementId);
      await load();
    } catch (e) {
      // A missing organisation state is not a server error — it is a setting,
      // and the message says which one (§3.11).
      setError(e instanceof ApiError ? e.message : 'Could not raise the invoice');
    } finally {
      setBusy(null);
    }
  };

  const send = async (invoiceId: string) => {
    setBusy(invoiceId);
    try {
      await api.revenue.sendInvoice(invoiceId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader title="Revenue" subtitle="What was agreed, what was billed, what arrived" />

      <div className="space-y-5">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        {/* ── The numbers ─────────────────────────────────────────────────── */}
        {summary && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure label="Monthly revenue" value={money(summary.mrr)} hint="What the agreements say" />
            <Figure label="Billed" value={money(summary.billed)} hint="This month, issued" />
            <Figure label="Collected" value={money(summary.collected)} hint="This month, arrived" />
            <Figure
              label="Overdue"
              value={money(summary.overdue)}
              hint={`${money(summary.outstanding)} outstanding`}
              tone={Number(summary.overdue) > 0 ? 'bad' : 'plain'}
            />
          </section>
        )}

        {/* ── Due to bill ─────────────────────────────────────────────────── */}
        <Card padding="none">
          <CardHeader>
            <CardTitle>Due to bill</CardTitle>
            {due.length > 0 && <Badge tone="warn">{due.length}</Badge>}
          </CardHeader>
          <CardBody>
            {/*
              Flowzen surfaces that an invoice is due; a person raises it. The
              billing date only advances when one is actually created, so a month
              nobody billed stays here rather than sliding into the past (§3.8).
            */}
            <p className="mb-3 text-xs text-secondary">
              These stay here until an invoice is raised — a month nobody bills does not disappear.
            </p>

            {due.length === 0 ? (
              <p className="text-sm text-secondary">Nothing due right now.</p>
            ) : (
              <ul className="divide-y divide-border">
                {due.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 py-3 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/clients/${e.company.id}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {e.company.name}
                      </Link>
                      <p className="text-xs text-secondary">
                        {money(e.amount)} · {e.billingFrequency.toLowerCase()} · due{' '}
                        {date(e.nextBillingDate)}
                      </p>
                    </div>
                    <Button size="sm" icon={Plus} loading={busy === e.id} onClick={() => raise(e.id)}>
                      Raise invoice
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* ── Prices due for review ───────────────────────────────────────── */}
        {(attention.dueForReview.length > 0 || attention.expiring.length > 0) && (
          <Card className="border-amber-200 bg-amber-50/40">
            <h2 className="text-sm font-semibold text-primary">Worth a conversation</h2>
            <p className="mb-3 mt-0.5 text-xs text-secondary">
              Rolling work never expires — the risk is a price that never moved while the work grew.
            </p>
            <div className="flex flex-wrap gap-2">
              {attention.dueForReview.length > 0 && (
                <Badge tone="warn">
                  {attention.dueForReview.length} price
                  {attention.dueForReview.length === 1 ? '' : 's'} due for review
                </Badge>
              )}
              {attention.expiring.length > 0 && (
                <Badge tone="warn">
                  {attention.expiring.length} fixed term
                  {attention.expiring.length === 1 ? '' : 's'} ending soon
                </Badge>
              )}
            </div>
            <p className="mt-3 text-xs text-secondary">
              Renewals happen on the client&apos;s own page — it is a conversation about one
              relationship.
            </p>
          </Card>
        )}

        {/* ── Invoices ────────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-primary">Invoices</h2>
          {invoices.length === 0 ? (
            <Note>None yet. Raising one from the list above is what creates it.</Note>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Number</TH>
                  <TH>Client</TH>
                  <TH numeric>Total</TH>
                  <TH numeric>Balance</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {invoices.map((inv) => (
                  <TR key={inv.id}>
                    <TD className="font-mono text-xs text-secondary">{inv.number}</TD>
                    <TD className="text-primary">{inv.company.name}</TD>
                    <TD numeric className="font-medium text-primary">
                      {money(inv.total)}
                    </TD>
                    <TD numeric className="text-secondary">
                      {money(inv.balance)}
                    </TD>
                    <TD
                      className={
                        inv.isOverdue ? 'text-xs font-medium text-danger' : 'text-xs text-secondary'
                      }
                    >
                      {date(inv.dueDate)}
                    </TD>
                    <TD>
                      <Badge
                        tone={
                          inv.isOverdue
                            ? 'bad'
                            : inv.status === 'PAID'
                              ? 'good'
                              : inv.status === 'DRAFT'
                                ? 'neutral'
                                : 'info'
                        }
                      >
                        {inv.isOverdue ? 'overdue' : inv.status.toLowerCase().replace('_', ' ')}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1.5">
                        {inv.status !== 'DRAFT' && (
                          <a
                            href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/revenue/invoices/${inv.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-white px-2 text-xs font-medium text-secondary hover:text-primary transition-colors"
                            title="Download GST Invoice PDF"
                          >
                            <Download className="h-3.5 w-3.5" /> PDF
                          </a>
                        )}
                        {inv.status === 'DRAFT' && (
                          <Button
                            size="sm"
                            icon={Send}
                            loading={busy === inv.id}
                            onClick={() => send(inv.id)}
                          >
                            Send
                          </Button>
                        )}
                        {inv.status !== 'DRAFT' && inv.status !== 'PAID' && inv.status !== 'VOID' && Number(inv.balance) > 0 && (
                          <Button
                            size="sm"
                            icon={CreditCard}
                            onClick={() => setPayingInvoice(inv)}
                          >
                            Record payment
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      </div>

      <RecordPaymentDialog
        invoice={payingInvoice}
        currency={currency}
        locale={locale}
        onClose={() => setPayingInvoice(null)}
        onRecorded={() => {
          setPayingInvoice(null);
          void load();
        }}
      />
    </>
  );
}

function Figure({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'plain' | 'bad';
}) {
  return (
    <Card padding="sm">
      <p className="text-xs text-secondary">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${tone === 'bad' ? 'text-danger' : 'text-primary'}`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-secondary">{hint}</p>}
    </Card>
  );
}
