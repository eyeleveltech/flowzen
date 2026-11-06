'use client';

/**
 * Money → Subscriptions (Subscriptions plan). Management only — the Money
 * page shows the tab to nobody else, and every route behind it refuses them.
 *
 * Drop a platform invoice; Flowzen reads it; a review card shows the file
 * beside the fields it found, with the ones it was unsure of highlighted;
 * nothing is saved until Save. Saving makes the platform (the first time),
 * the invoice, and a linked Software cost — so what the studio pays Adobe or
 * Canva is in profit and cash like any other bill.
 *
 * Figures come from the server, worked out over every invoice. A rupee
 * figure that was estimated from the USD rate says so wherever it shows.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { ExternalLink, FileUp, Pencil, Trash2, X } from 'lucide-react';
import {
  api,
  ApiError,
  formatMoney,
  type SubscriptionInvoiceBody,
  type SubscriptionInvoiceRow,
  type SubscriptionPlatformSummary,
  type SubscriptionReadFields,
  type SubscriptionReadResult,
} from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, FieldSelect } from '@/components/ui/field';
import { Note, ErrorNote } from '@/components/ui/empty-state';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Drawer } from '@/components/ui/drawer';
import { StatRow, StatTile } from '@/components/ui/stat-tile';
import { Table, THead, TH, SortableTH, TBody, TR, TD, type SortDir } from '@/components/ui/table';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { TableSkeleton } from '@/components/ui/skeleton-loaders';
import { useConfirmStore } from '@/stores/confirm';
import { cn, plural } from '@/lib/utils';

const KEY = ['subscriptions'] as const;
const platformKey = (id: string) => [...KEY, 'platform', id] as const;

const CYCLE_LABEL: Record<string, string> = { MONTHLY: 'Monthly', YEARLY: 'Yearly', UNKNOWN: '—' };

const dayText = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

/** "$54.99" in the invoice's own money. */
const own = (currency: string, n: number) => formatMoney(n, currency);

/** "₹4,620 (estimated)" — the rupee figure, honest about where it came from. */
function Rupees({ inr, estimated, className }: { inr: number | null; estimated: boolean; className?: string }) {
  if (inr === null) return <span className={cn('text-secondary', className)}>₹ unknown</span>;
  return (
    <span className={className}>
      {formatMoney(inr)}
      {estimated && <span className="ml-1 text-micro font-normal text-secondary">(estimated)</span>}
    </span>
  );
}

// ── The form, shared by the review card and the edit dialog ──────────────────

type FormValues = {
  platformId: string;
  platformName: string;
  invoiceNumber: string;
  invoiceDate: string;
  periodStart: string;
  periodEnd: string;
  planName: string;
  currency: string;
  subtotal: string;
  taxAmount: string;
  taxType: string;
  total: string;
  inrCharged: string;
  vendorGstin: string;
};

const NEW_PLATFORM = '__new__';

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

const fromRead = (r: SubscriptionReadResult): FormValues => ({
  platformId: r.platformMatch?.id ?? NEW_PLATFORM,
  platformName: r.platformMatch ? '' : (r.fields.vendor ?? ''),
  invoiceNumber: s(r.fields.invoiceNumber),
  invoiceDate: s(r.fields.invoiceDate),
  periodStart: s(r.fields.periodStart),
  periodEnd: s(r.fields.periodEnd),
  planName: s(r.fields.planName),
  currency: (r.fields.currency ?? '').toUpperCase(),
  subtotal: s(r.fields.subtotal),
  taxAmount: s(r.fields.taxAmount),
  taxType: s(r.fields.taxType),
  total: s(r.fields.total),
  inrCharged: '',
  vendorGstin: s(r.fields.vendorGstin),
});

const fromRow = (row: SubscriptionInvoiceRow, platformId: string): FormValues => ({
  platformId,
  platformName: '',
  invoiceNumber: row.invoiceNumber,
  invoiceDate: row.invoiceDate,
  periodStart: row.periodStart ?? '',
  periodEnd: row.periodEnd ?? '',
  planName: row.planName ?? '',
  currency: row.currency,
  subtotal: s(row.subtotal),
  taxAmount: s(row.taxAmount),
  taxType: row.taxType ?? '',
  total: s(row.total),
  inrCharged: s(row.inrCharged),
  vendorGstin: row.vendorGstin ?? '',
});

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

const toBody = (f: FormValues): SubscriptionInvoiceBody => ({
  ...(f.platformId === NEW_PLATFORM ? { platformName: f.platformName.trim() } : { platformId: f.platformId }),
  invoiceNumber: f.invoiceNumber.trim(),
  invoiceDate: f.invoiceDate,
  periodStart: f.periodStart || null,
  periodEnd: f.periodEnd || null,
  planName: f.planName.trim() || null,
  currency: f.currency.trim().toUpperCase(),
  subtotal: num(f.subtotal),
  taxAmount: num(f.taxAmount),
  taxType: f.taxType.trim() || null,
  total: Number(f.total),
  inrCharged: num(f.inrCharged),
  vendorGstin: f.vendorGstin.trim() || null,
});

function InvoiceForm({
  values,
  onChange,
  platforms,
  uncertain = [],
  usdInrRate,
}: {
  values: FormValues;
  onChange: (next: FormValues) => void;
  platforms: { id: string; name: string }[];
  /** Field names the reader was unsure of — shown with a mark to check. */
  uncertain?: string[];
  usdInrRate: number | null;
}) {
  const set = (k: keyof FormValues) => (v: string) => onChange({ ...values, [k]: v });
  const unsure = (k: string) => (uncertain.includes(k) ? 'Check this — the reader was not sure.' : undefined);
  const ring = (k: string) => (uncertain.includes(k) ? 'rounded-xl ring-2 ring-warning/50' : undefined);
  const estimate =
    values.currency.toUpperCase() === 'USD' && !values.inrCharged.trim() && values.total.trim()
      ? usdInrRate
        ? `About ${formatMoney(Number(values.total) * usdInrRate)} at the Settings rate — estimated until the INR charged is entered.`
        : 'No USD→INR rate in Settings → Money, so the INR charged is needed to save.'
      : values.currency.toUpperCase() !== 'INR' && values.currency.toUpperCase() !== 'USD' && !values.inrCharged.trim()
        ? `Enter the INR charged: there is no rate to estimate ${values.currency.toUpperCase() || 'this'} from.`
        : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldSelect
          label="Platform"
          value={values.platformId}
          onChange={set('platformId')}
          options={[{ value: NEW_PLATFORM, label: 'New platform…' }, ...platforms.map((p) => ({ value: p.id, label: p.name }))]}
          className={ring('vendor')}
        />
        {values.platformId === NEW_PLATFORM ? (
          <Field label="Platform name" value={values.platformName} onChange={set('platformName')} placeholder="Adobe, Canva, Google Workspace…" required hint={unsure('vendor')} className={ring('vendor')} />
        ) : (
          <Field label="Plan or product" value={values.planName} onChange={set('planName')} placeholder="Creative Cloud All Apps" hint={unsure('planName')} className={ring('planName')} />
        )}
      </div>
      {values.platformId === NEW_PLATFORM && (
        <Field label="Plan or product" value={values.planName} onChange={set('planName')} placeholder="Creative Cloud All Apps" hint={unsure('planName')} className={ring('planName')} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice number" value={values.invoiceNumber} onChange={set('invoiceNumber')} required hint={unsure('invoiceNumber')} className={ring('invoiceNumber')} />
        <Field label="Invoice date" value={values.invoiceDate} onChange={set('invoiceDate')} type="date" required hint={unsure('invoiceDate')} className={ring('invoiceDate')} />
        <Field label="Billing period from" value={values.periodStart} onChange={set('periodStart')} type="date" hint={unsure('periodStart')} className={ring('periodStart')} />
        <Field label="Billing period to" value={values.periodEnd} onChange={set('periodEnd')} type="date" hint={unsure('periodEnd') ?? 'The next renewal is the day after this.'} className={ring('periodEnd')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Currency" value={values.currency} onChange={set('currency')} placeholder="USD" required hint={unsure('currency')} className={ring('currency')} />
        <Field label="Subtotal" value={values.subtotal} onChange={set('subtotal')} type="number" min="0" hint={unsure('subtotal')} className={ring('subtotal')} />
        <Field label="Total (with tax)" value={values.total} onChange={set('total')} type="number" min="0" required hint={unsure('total')} className={ring('total')} />
        <Field label="Tax amount" value={values.taxAmount} onChange={set('taxAmount')} type="number" min="0" hint={unsure('taxAmount')} className={ring('taxAmount')} />
        <Field label="Tax type" value={values.taxType} onChange={set('taxType')} placeholder="GST, IGST, VAT" hint={unsure('taxType')} className={ring('taxType')} />
        <Field label="Vendor GSTIN" value={values.vendorGstin} onChange={set('vendorGstin')} placeholder="Indian vendors only" hint={unsure('vendorGstin')} className={ring('vendorGstin')} />
      </div>
      <Field
        label="INR charged (from the bank or card statement)"
        value={values.inrCharged}
        onChange={set('inrCharged')}
        type="number"
        min="0"
        placeholder="Fill in now or later"
        hint={estimate ?? 'What actually left the account, in rupees. The linked cost uses this.'}
      />
    </div>
  );
}

// ── The drop zone and the review cards ───────────────────────────────────────

type Card = { localId: number; name: string; status: 'reading' | 'ready' | 'failed'; error?: string; read?: SubscriptionReadResult };

const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors',
        over ? 'border-primary bg-primary/[0.04]' : 'border-line hover:border-primary/50 hover:bg-subtle',
      )}
    >
      <FileUp className="h-6 w-6 text-secondary" />
      <p className="text-sm font-medium text-primary">Drop platform invoices here, or click to choose</p>
      <p className="text-xs text-secondary">PDF, PNG or JPG, up to 10 MB each. Several at once is fine — each gets its own card to check.</p>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

function ReviewCard({ card, onDone, onDiscard }: { card: Card; onDone: () => void; onDiscard: () => void }) {
  const read = card.read;
  const [values, setValues] = useState<FormValues | null>(read ? fromRead(read) : null);
  const [stopRecurring, setStopRecurring] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (read && !values) setValues(fromRead(read));
  }, [read, values]);

  const save = async () => {
    if (!read || !values) return;
    setSaving(true);
    setError(null);
    try {
      const out = await api.subscriptions.save({
        ...toBody(values),
        fileId: read.file.id,
        extracted: read.aiUsed ? (read.fields as SubscriptionReadFields) : null,
        ...(read.recurringCost && stopRecurring ? { stopRecurringCostId: read.recurringCost.id } : {}),
      });
      toast.success(`${out.invoice.platformName}: invoice saved${out.invoice.estimated ? ' (INR estimated)' : ''}`);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-primary">{card.name}</p>
          <p className="text-xs text-secondary">
            {card.status === 'reading' && 'Reading the invoice…'}
            {card.status === 'failed' && 'Could not be uploaded'}
            {card.status === 'ready' && (read?.aiUsed ? 'Read by the AI — check every field before saving.' : 'Fill in the fields, then save.')}
          </p>
        </div>
        <button type="button" onClick={onDiscard} className="rounded-lg p-1.5 text-secondary hover:bg-subtle hover:text-primary" aria-label="Discard this invoice">
          <X className="h-4 w-4" />
        </button>
      </div>

      {card.status === 'reading' && <div className="px-5 py-6 text-sm text-secondary">Uploading and reading… this takes a few seconds.</div>}
      {card.status === 'failed' && (
        <div className="px-5 py-4">
          <ErrorNote>{card.error}</ErrorNote>
        </div>
      )}

      {card.status === 'ready' && read && values && (
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-2">
            <iframe src={api.subscriptions.fileHref(read.file.id)} title={card.name} className="h-72 w-full rounded-xl border border-line bg-subtle lg:h-[32rem]" />
            <a href={api.subscriptions.fileHref(read.file.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-secondary underline-offset-2 hover:text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Open the file in a new tab
            </a>
          </div>
          <div className="space-y-4">
            {!read.aiUsed && read.reason && <Note tone="info">{read.reason}</Note>}
            {read.uncertain.length > 0 && <Note tone="warn">The reader was not sure of {read.uncertain.length === 1 ? 'one field' : `${read.uncertain.length} fields`} — they are marked. Check them against the file.</Note>}
            {read.duplicate && <Note tone="warn">{read.duplicate.message}. Saving this again will be refused unless the number is different.</Note>}
            {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

            <InvoiceForm values={values} onChange={setValues} platforms={read.platforms} uncertain={read.uncertain} usdInrRate={read.usdInrRate} />

            {read.recurringCost && (
              <label className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning-tint px-3 py-2.5 text-xs text-warning-ink">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line" checked={stopRecurring} onChange={(e) => setStopRecurring(e.target.checked)} />
                <span>
                  Stop the old recurring cost for <span className="font-medium">{read.recurringCost.vendor}</span> ({formatMoney(read.recurringCost.amount)} a month, {read.recurringCost.category}) so it isn&rsquo;t
                  counted twice? Its past months stay as they are.
                </span>
              </label>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onDiscard}>
                Discard
              </Button>
              <Button type="button" variant="primary" loading={saving} onClick={() => void save()} disabled={!values.invoiceNumber.trim() || !values.invoiceDate || !values.total}>
                Save invoice
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── The platforms ────────────────────────────────────────────────────────────

type SortKey = 'name' | 'plan' | 'cycle' | 'last' | 'monthly' | 'renewal' | 'year' | 'count';

const sortValue = (p: SubscriptionPlatformSummary, key: SortKey): string | number => {
  switch (key) {
    case 'name':
      return p.name.toLowerCase();
    case 'plan':
      return (p.plan ?? '').toLowerCase();
    case 'cycle':
      return p.cycle;
    case 'last':
      return p.lastInvoice?.inr ?? -1;
    case 'monthly':
      return p.monthlyInr ?? -1;
    case 'renewal':
      return p.nextRenewal ?? '9999';
    case 'year':
      return p.spentThisYear;
    case 'count':
      return p.invoiceCount;
  }
};

function PlatformsTable({ rows, onOpen }: { rows: SubscriptionPlatformSummary[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'monthly', dir: 'desc' });
  const onSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const x = sortValue(a, sort.key);
        const y = sortValue(b, sort.key);
        const c = x < y ? -1 : x > y ? 1 : 0;
        return sort.dir === 'asc' ? c : -c;
      }),
    [rows, sort],
  );

  if (rows.length === 0) return <p className="px-1 py-4 text-sm text-secondary">No platforms yet. The first invoice you save creates one.</p>;

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <THead>
            <tr>
              <SortableTH label="Platform" column="name" sort={sort} onSort={onSort} />
              <SortableTH label="Plan" column="plan" sort={sort} onSort={onSort} />
              <SortableTH label="Billing" column="cycle" sort={sort} onSort={onSort} />
              <SortableTH label="Last invoice" column="last" sort={sort} onSort={onSort} align="right" />
              <SortableTH label="Per month" column="monthly" sort={sort} onSort={onSort} align="right" />
              <SortableTH label="Next renewal" column="renewal" sort={sort} onSort={onSort} />
              <SortableTH label="This year" column="year" sort={sort} onSort={onSort} align="right" />
              <SortableTH label="Invoices" column="count" sort={sort} onSort={onSort} align="right" />
            </tr>
          </THead>
          <TBody>
            {sorted.map((p) => (
              <TR key={p.id} onClick={() => onOpen(p.id)}>
                <TD>
                  <span className="font-medium text-primary">{p.name}</span>
                  {p.status === 'CANCELLED' && (
                    <Badge tone="neutral" className="ml-2">
                      Cancelled
                    </Badge>
                  )}
                </TD>
                <TD className="text-secondary">{p.plan ?? '—'}</TD>
                <TD className="text-secondary">{CYCLE_LABEL[p.cycle]}</TD>
                <TD numeric>
                  {p.lastInvoice ? (
                    <>
                      <span className="text-primary">{own(p.lastInvoice.currency, p.lastInvoice.total)}</span>
                      {p.lastInvoice.currency !== 'INR' && (
                        <span className="block text-micro text-secondary">
                          <Rupees inr={p.lastInvoice.inr} estimated={p.lastInvoice.estimated} />
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </TD>
                <TD numeric>
                  <Rupees inr={p.monthlyInr} estimated={p.monthlyEstimated} className="font-medium text-primary" />
                </TD>
                <TD className="text-secondary">{p.status === 'CANCELLED' ? '—' : dayText(p.nextRenewal)}</TD>
                <TD numeric>
                  <Rupees inr={p.spentThisYear} estimated={p.yearEstimated} />
                </TD>
                <TD numeric className="text-secondary">
                  {p.invoiceCount}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {sorted.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onOpen(p.id)} className="w-full rounded-xl border border-line bg-white px-4 py-3 text-left hover:bg-subtle">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-primary">{p.name}</span>
                <Rupees inr={p.monthlyInr} estimated={p.monthlyEstimated} className="text-sm font-semibold text-primary" />
              </div>
              <p className="mt-0.5 text-xs text-secondary">
                {p.plan ?? 'No plan named'} · {CYCLE_LABEL[p.cycle]}
                {p.status === 'CANCELLED' ? ' · Cancelled' : p.nextRenewal ? ` · renews ${dayText(p.nextRenewal)}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-secondary">
                This year <Rupees inr={p.spentThisYear} estimated={p.yearEstimated} /> · {plural(p.invoiceCount, 'invoice')}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function PlatformDrawer({ id, platforms, onClose }: { id: string; platforms: { id: string; name: string }[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((st) => st.confirm);
  const { data, isPending, error } = useQuery({ queryKey: platformKey(id), queryFn: () => api.subscriptions.platform(id) });
  const [editing, setEditing] = useState<SubscriptionInvoiceRow | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: KEY }), queryClient.invalidateQueries({ queryKey: ['costs'] }), queryClient.invalidateQueries({ queryKey: ['money'] })]);

  const setStatus = async (status: 'ACTIVE' | 'CANCELLED') => {
    setBusy(true);
    try {
      await api.subscriptions.updatePlatform(id, { status });
      await refresh();
      toast.success(status === 'CANCELLED' ? 'Marked cancelled — no more reminders' : 'Active again');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change that');
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    if (notes === null) return;
    setBusy(true);
    try {
      await api.subscriptions.updatePlatform(id, { notes });
      await refresh();
      setNotes(null);
      toast.success('Notes saved');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the notes');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: SubscriptionInvoiceRow) => {
    const ok = await confirm({
      title: `Delete invoice ${row.invoiceNumber}?`,
      message: 'Its linked cost goes with it, so it stops counting in profit and cash. The file is removed too.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.subscriptions.deleteInvoice(row.id);
      await refresh();
      toast.success('Invoice deleted');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete it');
    }
  };

  return (
    <Drawer isOpen onClose={onClose} title={data?.platform.name ?? 'Platform'} variant="slideover" className="max-w-3xl">
      {isPending ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : error || !data ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load this platform.'}</ErrorNote>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge tone={data.platform.status === 'ACTIVE' ? 'good' : 'neutral'}>{data.platform.status === 'ACTIVE' ? 'Active' : 'Cancelled'}</Badge>
              <span className="text-xs text-secondary">{plural(data.invoices.length, 'invoice')}</span>
            </div>
            {data.platform.status === 'ACTIVE' ? (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void setStatus('CANCELLED')}>
                Mark cancelled
              </Button>
            ) : (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void setStatus('ACTIVE')}>
                Mark active
              </Button>
            )}
          </div>

          <div>
            <p className="eyebrow mb-2">Invoices</p>
            {data.invoices.length === 0 ? (
              <p className="text-sm text-secondary">No invoices left on this platform.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {data.invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-primary">
                        <span className="font-medium">{dayText(inv.invoiceDate)}</span> · {inv.invoiceNumber}
                        {inv.planName && <span className="text-secondary"> · {inv.planName}</span>}
                      </p>
                      <p className="text-xs text-secondary">
                        {inv.periodStart && inv.periodEnd ? `${dayText(inv.periodStart)} → ${dayText(inv.periodEnd)}` : 'No billing period printed'}
                        {inv.taxAmount !== null && inv.taxType ? ` · ${inv.taxType} ${own(inv.currency, inv.taxAmount)}` : ''}
                        {inv.vendorGstin ? ` · GSTIN ${inv.vendorGstin}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-primary">{own(inv.currency, inv.total)}</p>
                      {inv.currency !== 'INR' && (
                        <p className="text-micro text-secondary">
                          <Rupees inr={inv.inr} estimated={inv.estimated} />
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <a href={inv.fileUrl.startsWith('/api/') ? api.subscriptions.fileHref(inv.fileId) : inv.fileUrl} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-secondary hover:bg-subtle hover:text-primary" title="Open the file">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button type="button" onClick={() => setEditing(inv)} className="rounded-lg p-1.5 text-secondary hover:bg-subtle hover:text-primary" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => void remove(inv)} className="rounded-lg p-1.5 text-secondary hover:bg-danger-tint hover:text-danger" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.priceHistory.length > 1 && (
            <div>
              <p className="eyebrow mb-2">Price history</p>
              <div className="flex flex-wrap gap-1.5">
                {data.priceHistory.map((h, i) => {
                  const prev = data.priceHistory[i - 1];
                  const up = prev && prev.currency === h.currency && h.total > prev.total;
                  const down = prev && prev.currency === h.currency && h.total < prev.total;
                  return (
                    <span key={`${h.date}-${i}`} className={cn('rounded-md border px-2 py-1 text-micro', up ? 'border-warning/40 bg-warning-tint text-warning-ink' : down ? 'border-success/40 bg-success-tint text-success' : 'border-line bg-subtle text-body-soft')}>
                      {dayText(h.date)} · {own(h.currency, h.total)}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p className="eyebrow mb-2">Notes</p>
            <Field label="Notes" value={notes ?? data.platform.notes ?? ''} onChange={setNotes} textarea rows={3} placeholder="Who uses it, which card pays it, anything worth remembering." className="[&_label]:sr-only" />
            {notes !== null && notes !== (data.platform.notes ?? '') && (
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="primary" loading={busy} onClick={() => void saveNotes()}>
                  Save notes
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && data && (
        <EditInvoiceModal row={editing} platformId={data.platform.id} platforms={platforms} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
      )}
    </Drawer>
  );
}

function EditInvoiceModal({
  row,
  platformId,
  platforms,
  onClose,
  onSaved,
}: {
  row: SubscriptionInvoiceRow;
  platformId: string;
  platforms: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<FormValues>(fromRow(row, platformId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: view } = useQuery({ queryKey: KEY, queryFn: () => api.subscriptions.view() });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const out = await api.subscriptions.updateInvoice(row.id, toBody(values));
      toast.success(`Invoice updated${out.invoice.estimated ? ' (INR estimated)' : ''}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit invoice ${row.invoiceNumber}`} size="lg">
      <form onSubmit={submit}>
        <ModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <InvoiceForm values={values} onChange={setValues} platforms={platforms} usdInrRate={view?.rate.usdInrRate ?? null} />
          <p className="text-xs text-secondary">The linked Software cost follows: its amount, date and vendor change with the invoice.</p>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

export function SubscriptionsTab() {
  const queryClient = useQueryClient();
  const search = useSearchParams();
  const { data, isPending, error } = useQuery({ queryKey: KEY, queryFn: () => api.subscriptions.view() });
  const [cards, setCards] = useState<Card[]>([]);
  const nextId = useRef(1);
  // A bell's link lands on its platform: /subscriptions?platform=<id>.
  const [open, setOpen] = useState<string | null>(() => search.get('platform'));

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const localId = nextId.current++;
      setCards((c) => [...c, { localId, name: file.name, status: 'reading' }]);
      api.subscriptions
        .read(file)
        .then((read) => setCards((c) => c.map((k) => (k.localId === localId ? { ...k, status: 'ready', read } : k))))
        .catch((e) => setCards((c) => c.map((k) => (k.localId === localId ? { ...k, status: 'failed', error: e instanceof ApiError ? e.message : 'Could not upload the file' } : k))));
    }
  };

  const saved = (localId: number) => {
    setCards((c) => c.filter((k) => k.localId !== localId));
    void queryClient.invalidateQueries({ queryKey: KEY });
    void queryClient.invalidateQueries({ queryKey: ['costs'] });
    void queryClient.invalidateQueries({ queryKey: ['money'] });
  };

  const platforms = useMemo(() => (data?.platforms ?? []).map((p) => ({ id: p.id, name: p.name })), [data]);

  if (isPending) return <TableSkeleton />;
  if (error || !data) return <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load subscriptions.'}</ErrorNote>;

  const t = data.totals;
  const est = (flag: boolean) => (flag ? ' (estimated)' : '');

  return (
    <div className="space-y-6">
      <StatRow>
        <StatTile label="Spent this month" value={formatMoney(t.spentThisMonth)} note={`platform invoices dated this month${est(t.monthEstimated)}`} dense />
        <StatTile label="Spent this year" value={formatMoney(t.spentThisYear)} note={`since the financial year began${est(t.yearEstimated)}${t.unknownThisYear ? ` · ${plural(t.unknownThisYear, 'invoice')} in a currency with no rate left out` : ''}`} dense />
        <StatTile label="Monthly run-rate" value={formatMoney(t.runRate)} note={`${plural(t.activePlatforms, 'active platform')}; yearly plans ÷ 12${est(t.runRateEstimated)}`} dark dense />
        <StatTile
          label="Renewing in 30 days"
          value={data.renewingSoon.length}
          note={data.renewingSoon.length ? data.renewingSoon.slice(0, 3).map((r) => `${r.name} ${dayText(r.nextRenewal)}`).join(' · ') : 'nothing due'}
          tone={data.renewingSoon.length ? 'warning' : 'default'}
          dense
        />
      </StatRow>

      {!data.rate.set && (
        <Note tone="info">
          No USD→INR rate is set (Settings → Money), so dollar invoices cannot be estimated: each needs its INR charged before it can be saved.
        </Note>
      )}

      <DropZone onFiles={addFiles} />

      {cards.length > 0 && (
        <div className="space-y-4">
          {cards.map((card) => (
            <ReviewCard key={card.localId} card={card} onDone={() => saved(card.localId)} onDiscard={() => setCards((c) => c.filter((k) => k.localId !== card.localId))} />
          ))}
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-primary">Platforms</p>
          <ExportCsvButton href={api.subscriptions.exportUrl()} />
        </div>
        <PlatformsTable rows={data.platforms} onOpen={setOpen} />
      </div>

      {open && <PlatformDrawer id={open} platforms={platforms} onClose={() => setOpen(null)} />}
    </div>
  );
}
