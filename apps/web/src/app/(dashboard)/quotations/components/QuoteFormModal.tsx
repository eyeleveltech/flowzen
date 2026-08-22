'use client';

/**
 * Raising a quotation.
 *
 * Two things make this different from an ordinary line-items editor:
 *
 * ① Every figure shown is the SERVER's arithmetic. The running total comes back
 *    from /quotes/preview rather than being added up here, so what somebody reads
 *    while typing and what the document ends up billing cannot drift apart (§4.6).
 *
 * ② The document states what KIND of work it is. A total of 4,80,000 could be
 *    40,000 a month for a year or a one-off build, and the quotation cannot say
 *    which without the type and the frequency — while the deal's value follows
 *    this total, so an unstated type inflates the forecast twelvefold (§3.12).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  api,
  ApiError,
  formatMoney,
  type BillingFrequency,
  type BoardColumn,
  type ContractType,
  type OrgConfig,
} from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { ErrorNote, Note } from '@/components/ui/empty-state';

type Line = {
  description: string;
  quantity: string;
  rate: string;
  discountPercent: string;
  serviceId: string;
};

type Totals = { subtotal: string; cgst: string; sgst: string; igst: string; total: string };
type DealOption = { id: string; title: string; companyId: string; companyName: string; stage: string };

const emptyLine = (): Line => ({
  description: '',
  quantity: '1',
  rate: '',
  discountPercent: '0',
  serviceId: '',
});

const PAYMENT_TERMS = [
  { value: '', label: 'Not stated' },
  { value: 'ADVANCE_100', label: '100% in advance' },
  { value: 'SPLIT_50_50', label: '50% up front, 50% on delivery' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'MILESTONE', label: 'On milestones' },
];

const FREQUENCIES = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
  { value: 'ONE_TIME', label: 'Once' },
];

export function QuoteFormModal({
  open,
  dealId: fixedDealId,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Set when raising from a deal — then the deal is not a choice. */
  dealId?: string;
  onClose: () => void;
  onCreated: (quoteId: string) => void;
}) {
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [deals, setDeals] = useState<DealOption[]>([]);

  const [dealId, setDealId] = useState(fixedDealId ?? '');
  const [engagementType, setEngagementType] = useState<ContractType>('RETAINER');
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>('MONTHLY');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [taxRatePercent, setTaxRatePercent] = useState('18');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const [totals, setTotals] = useState<Totals | null>(null);
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void Promise.all([api.config.get(), api.deals.board()])
      .then(([cfg, board]) => {
        setConfig(cfg);
        // A quotation is raised against a deal that is still open. Quoting one
        // already won or lost has no meaning, so those are not offered.
        setDeals(
          board.columns
            .filter((column: BoardColumn) => column.kind === 'OPEN')
            .flatMap((column) =>
              column.deals.map((deal) => ({
                id: deal.id,
                title: deal.title ?? 'Untitled deal',
                companyId: deal.company.id,
                companyName: deal.company.name,
                stage: column.name,
              })),
            ),
        );
      })
      .catch(() => setError('Could not load deals and services'));
  }, [open]);

  const deal = useMemo(() => deals.find((d) => d.id === dealId) ?? null, [deals, dealId]);
  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const money = (v: string | null | undefined) => formatMoney(v, currency, locale);

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  /** Picking a service fills the description and rate, then lets both be edited. */
  const pickService = (index: number, serviceId: string) => {
    const service = config?.services.find((s) => s.id === serviceId);
    setLine(index, {
      serviceId,
      description: service?.name ?? lines[index].description,
      rate: service?.defaultRate ?? lines[index].rate,
    });
  };

  const priceable = useMemo(
    () => lines.filter((l) => l.description.trim() !== '' && l.rate !== ''),
    [lines],
  );

  const price = useCallback(async () => {
    if (priceable.length === 0) {
      setTotals(null);
      setPriceError(null);
      return;
    }
    setPricing(true);
    try {
      setTotals(
        await api.quotes.preview({
          lines: priceable,
          taxRatePercent: Number(taxRatePercent || 0),
          companyId: deal?.companyId,
        }),
      );
      setPriceError(null);
    } catch (e) {
      setTotals(null);
      setPriceError(e instanceof ApiError ? e : null);
    } finally {
      setPricing(false);
    }
  }, [priceable, taxRatePercent, deal?.companyId]);

  // Repriced as the form settles rather than on every keystroke.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void price(), 400);
    return () => clearTimeout(timer);
  }, [price, open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const quote = await api.quotes.create({
        dealId,
        engagementType,
        billingFrequency,
        paymentTerms: paymentTerms || null,
        taxRatePercent: Number(taxRatePercent || 0),
        validUntil: validUntil || null,
        lines: priceable.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          rate: l.rate,
          discountPercent: l.discountPercent,
          serviceId: l.serviceId || null,
        })),
      });
      onCreated(quote.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the quotation');
    } finally {
      setSaving(false);
    }
  };

  const serviceOptions = [
    { value: '', label: 'Free text…' },
    ...(config?.services.map((s) => ({ value: s.id, label: s.name })) ?? []),
  ];

  return (
    <Modal open={open} onClose={onClose} title="New quotation" size="xl">
      <form onSubmit={submit}>
        <ModalBody className="space-y-5">
          {/* ── Which deal ──────────────────────────────────────────────── */}
          <FieldSelect
            label="Deal"
            required
            value={dealId}
            onChange={setDealId}
            disabled={Boolean(fixedDealId)}
            placeholder="Choose a deal…"
            options={deals.map((d) => ({
              value: d.id,
              label: `${d.companyName} — ${d.title}`,
              sublabel: d.stage,
            }))}
          />
          {/*
            The deal is the quotation's only parent, and it is required. One
            parent removes the re-pointing dance the old shape needed (§2).
          */}
          <p className="-mt-3 text-xs text-secondary">
            A quotation belongs to a deal. Only open deals can be quoted.
          </p>

          {/* ── What kind of work ───────────────────────────────────────── */}
          <div>
            <span className="mb-2 block text-sm font-medium text-body">What is being offered?</span>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { value: 'RETAINER', label: 'Retainer', hint: 'Bills again every period' },
                  { value: 'PROJECT', label: 'Project', hint: 'A one-off piece of work' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setEngagementType(option.value);
                    setBillingFrequency(option.value === 'PROJECT' ? 'ONE_TIME' : 'MONTHLY');
                  }}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    engagementType === option.value
                      ? 'border-primary bg-subtle'
                      : 'border-border hover:bg-subtle'
                  }`}
                >
                  <span className="block text-sm font-semibold text-primary">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-secondary">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FieldSelect
              label="Bills"
              value={billingFrequency}
              onChange={(v) => setBillingFrequency(v as BillingFrequency)}
              options={FREQUENCIES}
            />
            <FieldSelect
              label="Payment terms"
              value={paymentTerms}
              onChange={setPaymentTerms}
              options={PAYMENT_TERMS}
            />
            <Field label="Valid until" type="date" value={validUntil} onChange={setValidUntil} />
          </div>

          {/* ── Lines ───────────────────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-body">Lines</span>
              <Button
                type="button"
                size="sm"
                icon={Plus}
                onClick={() => setLines((l) => [...l, emptyLine()])}
              >
                Add line
              </Button>
            </div>

            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="rounded-xl border border-border p-3">
                  <div className="flex gap-2">
                    <div className="w-44 shrink-0">
                      <Select
                        value={line.serviceId}
                        onChange={(v) => pickService(index, v)}
                        options={serviceOptions}
                        placeholder="Free text…"
                        ariaLabel="Service"
                        buttonClassName="px-2.5 py-2 text-xs"
                      />
                    </div>
                    <input
                      value={line.description}
                      onChange={(e) => setLine(index, { description: e.target.value })}
                      placeholder="What this line is for"
                      aria-label="Description"
                      className="min-w-0 flex-1 rounded-input border border-border px-3 py-2 text-sm text-body outline-none focus-visible:border-primary"
                    />
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        aria-label="Remove line"
                        onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                      />
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <SmallField label="Quantity">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => setLine(index, { quantity: e.target.value })}
                        className={smallInput}
                      />
                    </SmallField>
                    <SmallField label="Rate">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.rate}
                        onChange={(e) => setLine(index, { rate: e.target.value })}
                        className={smallInput}
                      />
                    </SmallField>
                    <SmallField label="Discount %">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        value={line.discountPercent}
                        onChange={(e) => setLine(index, { discountPercent: e.target.value })}
                        className={smallInput}
                      />
                    </SmallField>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── The totals, computed by the server ──────────────────────── */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-primary">Totals</span>
              <div className="flex items-center gap-2">
                {pricing && <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />}
                <label htmlFor="tax-rate" className="text-xs text-secondary">
                  Tax %
                </label>
                <input
                  id="tax-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={taxRatePercent}
                  onChange={(e) => setTaxRatePercent(e.target.value)}
                  className="w-16 rounded-lg border border-border px-2 py-1 text-xs tabular-nums outline-none focus-visible:border-primary"
                />
              </div>
            </div>

            {priceError ? (
              // A missing organisation state is a SETTING, not a failure — and
              // the tax split cannot be guessed, so it says which one (§3.11).
              <Note tone="warn">{priceError.message}</Note>
            ) : totals ? (
              <dl className="space-y-1 text-sm">
                <Row label="Subtotal" value={money(totals.subtotal)} />
                {Number(totals.igst) > 0 ? (
                  <Row label="IGST" value={money(totals.igst)} />
                ) : (
                  <>
                    <Row label="CGST" value={money(totals.cgst)} />
                    <Row label="SGST" value={money(totals.sgst)} />
                  </>
                )}
                <div className="flex justify-between border-t border-border pt-2 text-base font-semibold text-primary">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{money(totals.total)}</dd>
                </div>
                {/*
                  Which split applies is decided by the two states, not by a
                  dropdown someone can get wrong (§3.11).
                */}
                <p className="pt-1 text-[11px] text-secondary">
                  {Number(totals.igst) > 0
                    ? 'IGST — the client is in another state.'
                    : 'CGST and SGST — the client is in your state.'}
                </p>
              </dl>
            ) : (
              <p className="text-xs text-secondary">
                Fill in a description and a rate to see the figures.
              </p>
            )}
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>

        <ModalFooter>
          <p className="mr-auto text-xs text-secondary">
            Created as a draft. Sending it is a separate step.
          </p>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={dealId === '' || priceable.length === 0 || totals === null}
          >
            Create quotation
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

const smallInput =
  'w-full rounded-lg border border-border px-2 py-1.5 text-sm tabular-nums text-body outline-none focus-visible:border-primary';

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-secondary">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-secondary">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
