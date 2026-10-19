'use client';

/**
 * The price of a proposal: Management's tab.
 *
 * Every figure on it comes from the server's calculator (proposalPricing.ts on
 * the API), asked again a moment after each change, so the totals here are the
 * totals the PDF will print. Nothing on this screen adds rupees up itself.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  api,
  ApiError,
  formatMoney,
  type ProposalDoc,
  type ProposalDocResponse,
  type ProposalFeeGroup,
  type ProposalLineDraft,
  type ProposalPrice,
  type ProposalPricedLine,
  type ServiceCatalogItem,
} from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const FIELD =
  'rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-body outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 disabled:bg-subtle disabled:text-secondary';
const INPUT = `w-full ${FIELD}`;

type Line = ProposalLineDraft & { key: string };

const blank = (billing: ProposalLineDraft['billing'] = 'MONTHLY'): Line => ({
  key: Math.random().toString(36).slice(2),
  name: '',
  billing,
  qty: 1,
  unit: billing === 'MONTHLY' ? 'month' : null,
  unitRate: 0,
  discountAmount: 0,
  discountTrade: null,
  isPassthrough: false,
});

const fromDoc = (doc: ProposalDoc): Line[] =>
  doc.lineItems.map((l) => ({
    key: l.id,
    catalogItemId: l.catalogItemId ?? null,
    name: l.name,
    description: l.description ?? null,
    billing: l.billing,
    qty: Number(l.qty),
    unit: l.unit ?? null,
    unitRate: Number(l.unitRate ?? 0),
    discountAmount: Number(l.discountAmount ?? 0),
    discountTrade: l.discountTrade ?? null,
    isPassthrough: Boolean(l.isPassthrough),
    priceSource: l.priceSource,
  }));

const toBody = (lines: Line[]): ProposalLineDraft[] =>
  lines
    .filter((l) => l.name.trim())
    .map((l) => ({
      catalogItemId: l.catalogItemId ?? null,
      name: l.name.trim(),
      description: l.description ?? null,
      billing: l.billing,
      qty: Number(l.qty) || 0,
      unit: l.unit ?? null,
      unitRate: Number(l.unitRate) || 0,
      discountAmount: Number(l.discountAmount) || 0,
      discountTrade: l.discountTrade ?? null,
      isPassthrough: Boolean(l.isPassthrough),
      priceSource: l.priceSource,
    }));

/** The priced line for each edited line, in the order they were sent. */
function pricedByIndex(lines: ProposalLineDraft[], price: ProposalPrice | null): (ProposalPricedLine | undefined)[] {
  if (!price) return [];
  const queues = {
    MONTHLY: [...price.monthly.lines],
    ONE_TIME: [...price.oneTime.lines],
    PASS: [...price.passthrough.lines],
  };
  return lines.map((l) => (l.isPassthrough ? queues.PASS : queues[l.billing]).shift());
}

export function PricingPanel({
  doc,
  price: savedPrice,
  problems,
  pricing,
  onChanged,
}: {
  doc: ProposalDoc;
  price?: ProposalPrice;
  problems: string[];
  pricing?: { clientStateKnown: boolean; clientStateName: string | null };
  onChanged: (res: ProposalDocResponse) => void;
}) {
  // Management prices a draft, or one sent to them for review.
  const editable = doc.status !== 'FINAL';
  const [lines, setLines] = useState<Line[]>(() => fromDoc(doc));
  const [dirty, setDirty] = useState(false);
  const [live, setLive] = useState<ProposalPrice | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [reason, setReason] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const body = useMemo(() => toBody(lines), [lines]);

  useEffect(() => {
    api.proposalDocs
      .catalog()
      .then((r) => setCatalog(r.items))
      .catch(() => setCatalog([]));
  }, []);

  // The totals, from the server, a moment after each change.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => {
      try {
        const r = await api.proposalDocs.price(doc.id, body);
        setLive(r.price);
        setPricingError(null);
      } catch (e) {
        setPricingError(e instanceof ApiError ? e.message : 'Could not work out the totals.');
      }
    }, 350);
    return () => clearTimeout(t);
  }, [body, doc.id, dirty]);

  // While editing, what the server says the edit comes to; otherwise what is saved.
  const shown = (dirty ? live : savedPrice) ?? savedPrice ?? null;
  // Unnamed lines are not sent, so they have no priced twin.
  const priced = pricedByIndex(body, shown);
  const named = lines.filter((l) => l.name.trim());
  const pricedFor = (l: Line) => {
    const at = named.findIndex((x) => x.key === l.key);
    return at >= 0 ? priced[at] : undefined;
  };

  const edit = (key: string, patch: Partial<Line>) => {
    setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const remove = (key: string) => {
    setLines((list) => list.filter((l) => l.key !== key));
    setDirty(true);
  };
  const add = (billing: ProposalLineDraft['billing']) => {
    setLines((list) => [...list, blank(billing)]);
    setDirty(true);
  };
  const addFromCatalog = (id: string) => {
    const item = catalog.find((c) => c.id === id);
    if (!item) return;
    setLines((list) => [
      ...list,
      {
        ...blank(item.billing),
        catalogItemId: item.id,
        name: item.name,
        description: item.description,
        unit: item.unit,
        unitRate: Number(item.standardRate ?? 0),
        priceSource: 'CATALOG',
      },
    ]);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.proposalDocs.setLines(doc.id, body);
      setDirty(false);
      setLines(fromDoc(res.document));
      onChanged(res);
      toast.success('Pricing saved');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the pricing.');
    } finally {
      setSaving(false);
    }
  };

  const recordOverride = async () => {
    setOverriding(true);
    try {
      const res = await api.proposalDocs.overrideFloor(doc.id, reason.trim());
      setReason('');
      onChanged(res);
      toast.success('Reason recorded');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not record the reason.');
    } finally {
      setOverriding(false);
    }
  };

  const finalise = async () => {
    setFinalising(true);
    try {
      const res = await api.proposalDocs.finalise(doc.id);
      onChanged(res);
      toast.success(`v${doc.n} is final`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not finalise.');
      // The list of what is in the way may have changed.
      api.proposalDocs.get(doc.id).then(onChanged).catch(() => undefined);
    } finally {
      setFinalising(false);
    }
  };

  const floor = shown?.floor;
  const services = catalog.filter((c) => c.active);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3">
        {!editable && (
          <p className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2.5 text-xs text-secondary">
            <Lock className="h-3.5 w-3.5" /> v{doc.n} is final. Its prices are frozen. Start a new version to change them.
          </p>
        )}

        {lines.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center">
            <p className="text-sm font-semibold text-primary">No services priced yet</p>
            <p className="mt-1 text-xs text-secondary">Add what the client is buying, monthly or one-time. Ad spend goes in as paid by the client.</p>
          </div>
        )}

        {lines.map((l) => {
          const p = pricedFor(l);
          const discounted = Number(l.discountAmount) > 0;
          return (
            <div key={l.key} className="rounded-2xl border border-border bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Service"
                  className={`${INPUT} min-w-[12rem] flex-1 font-semibold text-primary`}
                  placeholder="Service, e.g. Social media management"
                  value={l.name}
                  onChange={(e) => edit(l.key, { name: e.target.value, priceSource: l.catalogItemId ? 'USER' : l.priceSource })}
                  disabled={!editable}
                  maxLength={200}
                />
                <select
                  aria-label="Billing"
                  className={FIELD}
                  value={l.isPassthrough ? 'PASS' : l.billing}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'PASS') edit(l.key, { isPassthrough: true });
                    else edit(l.key, { isPassthrough: false, billing: v as Line['billing'] });
                  }}
                  disabled={!editable}
                >
                  <option value="MONTHLY">Monthly fee</option>
                  <option value="ONE_TIME">One-time fee</option>
                  <option value="PASS">Paid by client directly</option>
                </select>
                {editable && (
                  <button
                    type="button"
                    aria-label={`Remove ${l.name || 'this line'}`}
                    onClick={() => remove(l.key)}
                    className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-danger-tint hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="block">
                  <span className="text-micro text-secondary">Qty</span>
                  <input type="number" min={0} step="any" className={INPUT} value={l.qty} onChange={(e) => edit(l.key, { qty: Number(e.target.value) })} disabled={!editable} />
                </label>
                <label className="block">
                  <span className="text-micro text-secondary">Unit</span>
                  <input className={INPUT} placeholder="month, video…" value={l.unit ?? ''} onChange={(e) => edit(l.key, { unit: e.target.value || null })} disabled={!editable} maxLength={30} />
                </label>
                <label className="block">
                  <span className="text-micro text-secondary">Rate (₹)</span>
                  <input type="number" min={0} step="any" className={INPUT} value={l.unitRate} onChange={(e) => edit(l.key, { unitRate: Number(e.target.value), priceSource: 'USER' })} disabled={!editable} />
                </label>
                <div>
                  <span className="text-micro text-secondary">Amount</span>
                  <p className="py-1.5 text-right text-sm font-semibold tabular-nums text-primary">{p ? formatMoney(p.amount) : '—'}</p>
                </div>
              </div>

              {!l.isPassthrough && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <label className="block">
                    <span className="text-micro text-secondary">Discount (₹)</span>
                    <input type="number" min={0} step="any" className={INPUT} value={l.discountAmount ?? 0} onChange={(e) => edit(l.key, { discountAmount: Number(e.target.value) })} disabled={!editable} />
                  </label>
                  {discounted && (
                    <label className="block">
                      <span className="text-micro text-secondary">What the client gives in return</span>
                      <input
                        className={`${INPUT} ${!l.discountTrade?.trim() ? 'border-warning' : ''}`}
                        placeholder="e.g. 12-month term, case-study rights"
                        value={l.discountTrade ?? ''}
                        onChange={(e) => edit(l.key, { discountTrade: e.target.value || null })}
                        disabled={!editable}
                        maxLength={200}
                      />
                    </label>
                  )}
                </div>
              )}

              <label className="mt-2 block">
                <span className="text-micro text-secondary">Description (prints under the service)</span>
                <input className={INPUT} value={l.description ?? ''} onChange={(e) => edit(l.key, { description: e.target.value || null })} disabled={!editable} maxLength={2000} />
              </label>
              {l.priceSource === 'CATALOG' && <p className="mt-1.5 text-micro text-secondary">Rate from the service list.</p>}
            </div>
          );
        })}

        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" icon={Plus} onClick={() => add('MONTHLY')}>Monthly line</Button>
            <Button variant="ghost" icon={Plus} onClick={() => add('ONE_TIME')}>One-time line</Button>
            {services.length > 0 && (
              <select
                aria-label="Add from the service list"
                className={FIELD}
                value=""
                onChange={(e) => addFromCatalog(e.target.value)}
              >
                <option value="">Add from the service list…</option>
                {services.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.standardRate ? ` · ${formatMoney(c.standardRate)}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border border-border bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="eyebrow text-secondary">Totals</h3>
            {dirty && <Badge tone="warn">Not saved</Badge>}
          </div>
          {pricingError && <p className="mt-2 text-micro text-danger">{pricingError}</p>}
          <FeeBlock label="Monthly" per="/ month" group={shown?.monthly} supply={shown?.supplyType} />
          <FeeBlock label="One-time" per="" group={shown?.oneTime} supply={shown?.supplyType} />
          {shown && shown.passthrough.lines.length > 0 && (
            <div className="mt-3 border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-secondary">Paid by client directly</span>
                <span className="font-semibold tabular-nums text-primary">{formatMoney(shown.passthrough.total)}</span>
              </div>
              <p className="mt-0.5 text-micro text-secondary">Not in the fee, not taxed.</p>
            </div>
          )}
          {pricing && !pricing.clientStateKnown && (
            <p className="mt-3 text-micro text-warning-ink">
              The client&apos;s state is not set, so GST is shown as CGST + SGST. Set it on the client if they are outside the studio&apos;s state.
            </p>
          )}
          {editable && (
            <Button variant="primary" fullWidth className="mt-4" onClick={() => void save()} loading={saving} disabled={!dirty}>
              Save pricing
            </Button>
          )}
        </div>

        {floor?.applies && (
          <div className={`rounded-2xl border p-4 ${floor.passes ? 'border-border bg-white' : 'border-warning/40 bg-warning-tint'}`}>
            <div className="flex items-start gap-2">
              {floor.passes ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-warning-ink" />}
              <div className="text-sm">
                <p className="font-semibold text-primary">{floor.passes ? 'Above the floor' : 'Below the floor'}</p>
                <p className="text-xs text-secondary">
                  Floor for {floor.vertical ?? 'this client'}: {formatMoney(floor.floor)} a month. This quote: {formatMoney(floor.monthlyFee)}.
                </p>
              </div>
            </div>
            {!floor.passes && doc.floorOverride && (
              <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs text-body">
                Allowed by {doc.floorOverride.by ?? 'Management'}: “{doc.floorOverride.reason}”
              </p>
            )}
            {!floor.passes && !doc.floorOverride && editable && (
              <div className="mt-3 space-y-2">
                <textarea
                  aria-label="Why this fee is below the floor"
                  className={`${INPUT} min-h-[4.5rem] resize-y`}
                  placeholder="Why this client is quoted below the floor"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                />
                <Button size="sm" onClick={() => void recordOverride()} loading={overriding} disabled={dirty || reason.trim().length < 20}>
                  Record the reason
                </Button>
                {dirty && <p className="text-micro text-secondary">Save the pricing first. The reason is recorded against the saved fee.</p>}
              </div>
            )}
          </div>
        )}

        {editable && (
          <div className="rounded-2xl border border-border bg-white p-4">
            <h3 className="eyebrow text-secondary">Before it goes out</h3>
            {problems.length === 0 && !dirty ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-primary">
                <CheckCircle2 className="h-4 w-4 text-success" /> Ready to finalise.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-xs text-body">
                {dirty && <li>Save the pricing.</li>}
                {problems.map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <span aria-hidden className="text-warning-ink">•</span>
                    {p}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="primary" fullWidth className="mt-4" icon={Lock} onClick={() => void finalise()} loading={finalising} disabled={dirty || problems.length > 0}>
              Finalise v{doc.n}
            </Button>
            <p className="mt-2 text-micro text-secondary">Locks the text and the prices, and keeps the PDF exactly as it is.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function FeeBlock({
  label,
  per,
  group,
  supply,
}: {
  label: string;
  per: string;
  group?: ProposalFeeGroup;
  supply?: 'INTRA' | 'INTER';
}) {
  if (!group || group.lines.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border pt-3 text-sm first:border-t-0 first:pt-0">
      <div className="flex justify-between">
        <span className="font-semibold text-primary">{label} fee</span>
        <span className="font-semibold tabular-nums text-primary">{formatMoney(group.subtotal)}</span>
      </div>
      {group.discount > 0 && (
        <div className="flex justify-between text-xs text-secondary">
          <span>after discounts of</span>
          <span className="tabular-nums">{formatMoney(group.discount)}</span>
        </div>
      )}
      {supply === 'INTER' ? (
        <Row k={`IGST ${group.gstRatePercent}%`} v={group.igst} />
      ) : (
        <>
          <Row k={`CGST ${group.gstRatePercent / 2}%`} v={group.cgst} />
          <Row k={`SGST ${group.gstRatePercent / 2}%`} v={group.sgst} />
        </>
      )}
      <div className="mt-1 flex justify-between">
        <span className="text-secondary">Total {per}</span>
        <span className="font-semibold tabular-nums text-primary">{formatMoney(group.total)}</span>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: number }) => (
  <div className="flex justify-between text-xs text-secondary">
    <span>{k}</span>
    <span className="tabular-nums">{formatMoney(v)}</span>
  </div>
);
