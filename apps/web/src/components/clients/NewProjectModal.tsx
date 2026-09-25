'use client';

/**
 * Creating a project — brief §11.3 step 1: "Project created from an accepted
 * quote. `quotedValue` required, `estimatedCost` optional but strongly
 * encouraged."
 *
 * Opened bare (from Live Work's Projects tab) it asks for a company like any
 * other form. Opened via `prefill` (from a won proposal's "Create project"
 * button on the Company record) the company and quoted value carry through
 * from the version that won — not re-typed — and `sourceProposalId` rides
 * along silently so the project stays linked back to the deal that
 * justified it.
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, api, formatMoney, type Company } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { personOptions } from '@/lib/people';
import type { UnfulfilledDeal } from '@/components/clients/NewRetainerModal';

type Prefill = {
  companyId: string;
  companyName: string;
  quotedValue?: number;
  sourceProposalId?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  prefill?: Prefill;
  /**
   * The won deals this project could be coming from — see `NewRetainerModal`,
   * which asks the same question for the same reason: a project created from
   * the client's Work tab had no link back to the deal that sold it.
   */
  deals?: UnfulfilledDeal[];
};

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

type Billing = 'STANDARD' | 'SINGLE' | 'CUSTOM';

const BILLING_OPTIONS = [
  { value: 'STANDARD', label: 'Standard (40% advance / 30% design sign-off / 30% launch)' },
  { value: 'SINGLE', label: 'Single invoice on delivery' },
  { value: 'CUSTOM', label: 'Custom milestones' },
];

/**
 * A custom milestone, as the form holds it.
 *
 * Both figures, because both get typed. "40% of the quote" is how a proposal
 * is written and "₹17,500 on delivery" is how a client agrees it, and asking
 * for only the percentage made the second one arithmetic somebody did on a
 * phone before typing the answer — which is where the rounding argument starts.
 *
 * Whichever is typed fills in the other. The AMOUNT is the one that is stored
 * exactly; `Milestone.percent` is a whole number in the database, so ₹17,500 of
 * ₹60,000 is 29% and the money is still ₹17,500.
 */
type CustomRow = { label: string; percent: string; amount: string };
const blankRow = (): CustomRow => ({ label: '', percent: '', amount: '' });


export function NewProjectModal({ open, onClose, onCreated, prefill, deals = [] }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const team = useTeamMembers();
  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  const [quotedValue, setQuotedValue] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [billing, setBilling] = useState<Billing>('STANDARD');
  const [customRows, setCustomRows] = useState<CustomRow[]>([blankRow(), blankRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceProposalId, setSourceProposalId] = useState('');

  /* Only where there is a won deal with no project built from it yet. */
  const asksWhichDeal = !prefill?.sourceProposalId && deals.length > 0;

  useEffect(() => {
    if (!open) return;
    setCompanyId(prefill?.companyId ?? '');
    setName('');
    setQuotedValue(prefill?.quotedValue != null ? String(prefill.quotedValue) : '');
    setSourceProposalId(prefill?.sourceProposalId ?? '');
    setEstimatedCost('');
    setStartDate('');
    setEndDate('');
    setOwnerId('');
    setPriority('MEDIUM');
    setDescription('');
    setBilling('STANDARD');
    setCustomRows([blankRow(), blankRow()]);
    setError(null);
    if (!prefill) {
      void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
    }
  }, [open, prefill]);

  const quoted = Number(quotedValue) || 0;
  const customPercentTotal = customRows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const customAmountTotal = customRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const customFilled = customRows.filter((r) => r.label.trim() && Number(r.amount) > 0);

  /*
   * One typed, the other worked out. Rounded to the rupee for the percent,
   * because the column it lands in is an integer.
   */
  const fromPercent = (percent: string): Partial<CustomRow> =>
    quoted > 0 && Number(percent) > 0
      ? { percent, amount: String(Math.round((quoted * Number(percent)) / 100)) }
      : { percent };

  const fromAmount = (amount: string): Partial<CustomRow> =>
    quoted > 0 && Number(amount) > 0
      ? { amount, percent: String(Math.round((Number(amount) / quoted) * 100)) }
      : { amount };

  /*
   * The quote is the total, so the split has to add up to it — checked in
   * rupees rather than percent, because that is what gets invoiced. One rupee
   * per row of slack, which is all rounding can cost.
   */
  const amountsMatch = quoted > 0 && Math.abs(customAmountTotal - quoted) <= customRows.length;
  // Below 1% of the quote a milestone rounds to zero percent, which the server
  // refuses. Said here rather than sent and bounced.
  const anyTooSmall = customFilled.some((r) => Number(r.percent) < 1);
  /*
   * Checked in rupees, not percent.
   *
   * Percentages summing to 100 is the same statement when every row was typed
   * as a percentage, and a weaker one the moment somebody types amounts: three
   * amounts can read 33/33/33 and still be a thousand rupees short of the
   * quote. What gets invoiced is the money.
   */
  const customValid =
    billing !== 'CUSTOM' || (customFilled.length > 0 && amountsMatch && !anyTooSmall);

  const canSave =
    Boolean(companyId) && Boolean(name.trim()) && quoted > 0 && Boolean(startDate) && Boolean(endDate) && customValid;

  const addRow = () => setCustomRows((prev) => [...prev, blankRow()]);
  const removeRow = (idx: number) => setCustomRows((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<CustomRow>) =>
    setCustomRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const milestonesForBilling = (): { label: string; percent: number; amount: number }[] => {
    if (billing === 'SINGLE') {
      return [{ label: 'Full payment on delivery', percent: 100, amount: quoted }];
    }
    if (billing === 'CUSTOM') {
      return customFilled.map((r) => {
        // The amount as typed or derived; the percent as the label for it.
        return { label: r.label.trim(), percent: Number(r.percent), amount: Number(r.amount) };
      });
    }
    return [
      { label: 'Advance Payment', percent: 40, amount: Math.round(quoted * 0.4) },
      { label: 'Phase 1 Sign-off', percent: 30, amount: Math.round(quoted * 0.3) },
      { label: 'Final Delivery & Handover', percent: 30, amount: Math.round(quoted * 0.3) },
    ];
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.projects.create({
        companyId,
        name: name.trim(),
        quotedValue: quoted,
        estimatedCost: estimatedCost ? Number(estimatedCost) : undefined,
        startDate,
        endDate,
        ownerId: ownerId || undefined,
        priority,
        description: description.trim() || undefined,
        milestones: milestonesForBilling(),
        sourceProposalId: prefill?.sourceProposalId ?? sourceProposalId ?? undefined,
      });
      const created = (res as { project?: { id: string } }).project;
      if (created?.id) onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description={
        prefill?.sourceProposalId
          ? 'Value carries over from the won version — adjust anything before saving.'
          : 'One-off work with its own price and end date.'
      }
    >
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          {prefill ? (
            <div>
              <span className="block text-sm font-medium text-body mb-1.5">Company</span>
              <div className="w-full rounded-xl border border-border bg-subtle/40 px-4 py-2.5 text-sm text-primary font-medium">
                {prefill.companyName}
              </div>
            </div>
          ) : (
            <FieldSelect
              label="Company"
              value={companyId}
              onChange={setCompanyId}
              required
              placeholder="Choose a company…"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          {asksWhichDeal && (
            <FieldSelect
              label="From which won deal?"
              value={sourceProposalId}
              onChange={(v) => {
                setSourceProposalId(v);
                const deal = deals.find((d) => d.id === v);
                if (deal) setQuotedValue(String(deal.value));
              }}
              options={[
                { value: '', label: 'Not from a proposal' },
                ...deals.map((d) => ({ value: d.id, label: d.label })),
              ]}
              hint="Linking it carries the quote over and ties the work back to the deal that sold it."
            />
          )}
          <Field label="Project name" value={name} onChange={setName} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quoted value (₹)" value={quotedValue} onChange={setQuotedValue} type="number" required />
            <Field
              label="Your cost estimate (₹)"
              value={estimatedCost}
              onChange={setEstimatedCost}
              type="number"
              hint="Optional — without it you still get cost tracking, just no quoted-against-estimated comparison."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" value={startDate} onChange={setStartDate} type="date" required />
            <Field label="Expected end" value={endDate} onChange={setEndDate} type="date" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect
              label="Owner"
              value={ownerId}
              onChange={setOwnerId}
              placeholder="Defaults to you"
              options={personOptions(team)}
            />
            <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </div>
          <Field label="Description" value={description} onChange={setDescription} textarea rows={3} />

          <FieldSelect label="Billing" value={billing} onChange={(v) => setBilling(v as Billing)} options={BILLING_OPTIONS} />

          {billing !== 'CUSTOM' && quoted > 0 && (
            <div className="rounded-xl border border-border bg-subtle/40 p-3 text-xs text-secondary space-y-1">
              {milestonesForBilling().map((m) => (
                <div key={m.label} className="flex justify-between">
                  <span>{m.label} · {m.percent}%</span>
                  <span className="font-medium text-body">{formatMoney(m.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {billing === 'CUSTOM' && (
            <div className="space-y-2">
              {customRows.map((row, idx) => {
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-xl border border-border bg-white px-3 py-2 text-sm text-body outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                      value={row.label}
                      onChange={(e) => updateRow(idx, { label: e.target.value })}
                      placeholder="Milestone label"
                      aria-label={`Milestone ${idx + 1} label`}
                    />
                    <input
                      className="w-20 rounded-xl border border-border bg-white px-3 py-2 text-sm text-body outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                      type="number"
                      value={row.percent}
                      onChange={(e) => updateRow(idx, fromPercent(e.target.value))}
                      placeholder="%"
                      aria-label={`Milestone ${idx + 1} percent of the quote`}
                    />
                    <input
                      className="w-28 rounded-xl border border-border bg-white px-3 py-2 text-sm text-body outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                      type="number"
                      value={row.amount}
                      onChange={(e) => updateRow(idx, fromAmount(e.target.value))}
                      placeholder="₹"
                      aria-label={`Milestone ${idx + 1} amount`}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="shrink-0 rounded-lg p-1.5 text-secondary hover:bg-subtle hover:text-danger"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Add milestone
              </button>
              <p className={`text-xs ${amountsMatch ? 'text-secondary' : 'text-danger font-medium'}`}>
                {quoted > 0 ? (
                  <>
                    {formatMoney(customAmountTotal)} of {formatMoney(quoted)} allocated · {customPercentTotal}%
                    {!amountsMatch && ' — the milestones must add up to the quoted value'}
                  </>
                ) : (
                  'Enter the quoted value first — the split is worked out against it'
                )}
                {anyTooSmall && ' · every milestone needs at least 1% of the quote'}
              </p>
            </div>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Create project
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
