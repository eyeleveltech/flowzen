'use client';

/**
 * Creating a project — brief §11.3 step 1: "Project created from an accepted
 * quote. `quotedValue` required for paid work,
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
import { GstAmountFields } from '@/components/work/GstAmountFields';
import type { UnfulfilledDeal } from '@/components/clients/NewRetainerModal';

type Prefill = {
  companyId: string;
  companyName: string;
  quotedValue?: number;
  sourceProposalId?: string;
};

/**
 * Values to start the form with — what Zen filled in (Zen Plan 4). Applied as
 * the form opens, after its own defaults; the person still reads and saves it.
 */
export type ProjectInitial = {
  name?: string;
  gstPercent?: number;
  startDate?: string;
  endDate?: string;
  ownerId?: string;
  priority?: string;
  description?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  prefill?: Prefill;
  initial?: ProjectInitial;
  /**
   * The won deals this project could be coming from — see `NewRetainerModal`,
   * which asks the same question for the same reason: a project created from
   * the client's Work tab had no link back to the deal that sold it.
   */
  deals?: UnfulfilledDeal[];
  /**
   * Opened from the Sample work card, where the answer is not a question.
   *
   * The tick disappears rather than sitting there pre-ticked: the card the
   * person pressed already said what this is, and a control that only ever
   * has one value is furniture. It also stops somebody turning a sample into
   * paid work in a form headed "Sample work", which is a confusing place to
   * make that decision — the project's own Edit form is where that belongs.
   */
  forceSample?: boolean;
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


export function NewProjectModal({ open, onClose, onCreated, prefill, initial, deals = [], forceSample = false }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const team = useTeamMembers();
  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  // Starts at 0: a project can be created before its price is agreed.
  const [quotedValue, setQuotedValue] = useState('0');
  // Typing over the 0 gives "050000"; keep it "50000".
  const changeQuote = (v: string) => setQuotedValue(v.replace(/^0+(?=\d)/, ''));
  /*
   * The GST charged on the quote, kept BESIDE it.
   *
   * 18 to start with, because that is the rate on services and the rate every
   * proforma here already defaults to — a blank box would have been the wrong
   * answer for nearly every project. The quote itself stays the figure before
   * tax: GST charged to a client is collected for the government, and folding
   * it in would inflate this project's margin by the rate.
   */
  const [gstPercent, setGstPercent] = useState('18');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [billing, setBilling] = useState<Billing>('STANDARD');
  /*
   * Work given away to win somebody.
   *
   * The sample reel, the pilot design, the trial piece. It is real work with
   * real costs behind it and no invoice at the end, and there was no way to
   * record one: a project had to be worth something, and it refused a company
   * that was still a prospect — which is exactly who a sample is usually for.
   *
   * With this on, the two things that only exist to be charged for — the quote
   * and the billing split — go away rather than sitting there asking to be
   * filled in with nought.
   */
  // Fixed by the screen that opened this — the Sample work card, or not.
  const isSample = forceSample;
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
    setQuotedValue(prefill?.quotedValue != null ? String(prefill.quotedValue) : '0');
    setGstPercent('18');
    setSourceProposalId(prefill?.sourceProposalId ?? '');
    setStartDate('');
    setEndDate('');
    setOwnerId('');
    setPriority('MEDIUM');
    setDescription('');
    setBilling('STANDARD');
    setCustomRows([blankRow(), blankRow()]);
    // What Zen filled in, over the defaults.
    if (initial?.name) setName(initial.name);
    if (initial?.gstPercent != null) setGstPercent(String(initial.gstPercent));
    if (initial?.startDate) setStartDate(initial.startDate);
    if (initial?.endDate) setEndDate(initial.endDate);
    if (initial?.ownerId) setOwnerId(initial.ownerId);
    if (initial?.priority) setPriority(initial.priority);
    if (initial?.description) setDescription(initial.description);
    setError(null);
    if (!prefill) {
      void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
    }
  }, [open, prefill, initial]);

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

  /*
   * No price yet, no split.
   *
   * The form said "leave it blank if there is no price yet" and then sent a
   * 40/30/30 split of ₹0 anyway, which the server refused with "Number must be
   * greater than 0" — so a project without a price could not be created at
   * all. With no quote nothing is split; the milestones are added on the
   * project once the price is agreed.
   */
  const splits = !isSample && quoted > 0;

  /*
   * A sample asks for one thing: what to call it.
   *
   * Everything else a project needs exists to bill or to schedule it, and a
   * sample does neither. Dates fall back to today on the server, the owner
   * falls back to whoever is typing, and there is no price to give. A form
   * that demands four answers before it will record "we sent them a reel" is
   * a form people work around.
   *
   * The name stays because a row has to be findable, and five projects all
   * called the same thing are five rows nobody can tell apart.
   */
  /*
   * A price is not required, on any project.
   *
   * "Nought" and "not settled yet" are both real states for a piece of one-off
   * work, and demanding a positive number only got somebody to type 1 to get
   * past the form — after which the figure is wrong rather than absent.
   */
  const canSave =
    Boolean(companyId) &&
    Boolean(name.trim()) &&
    (isSample || (Boolean(startDate) && Boolean(endDate) && (!splits || customValid)));

  /*
   * Why "Create project" is greyed out, in words. It used to just sit there
   * disabled, and the only way to find the missing field was to look for it.
   */
  const missing = !companyId
    ? 'Choose the company.'
    : !name.trim()
      ? 'Give the project a name.'
      : !isSample && (!startDate || !endDate)
        ? 'Add a start date and an expected end.'
        : splits && !customValid
          ? 'The milestones have to add up to the quoted value.'
          : null;

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
    // The last part takes the rounding, so the three add up to the quote exactly.
    const advance = Math.round(quoted * 0.4);
    const phase = Math.round(quoted * 0.3);
    return [
      { label: 'Advance Payment', percent: 40, amount: advance },
      { label: 'Phase 1 Sign-off', percent: 30, amount: phase },
      { label: 'Final Delivery & Handover', percent: 30, amount: quoted - advance - phase },
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
        quotedValue: isSample ? 0 : quoted,
        gstPercent: isSample || !gstPercent ? null : Number(gstPercent),
        isSample,
        startDate,
        endDate,
        ownerId: ownerId || undefined,
        priority,
        description: description.trim() || undefined,
        // Nothing to bill (a sample) or nothing to split yet (no price): no milestones.
        milestones: splits ? milestonesForBilling() : undefined,
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
      title={forceSample ? 'New sample work' : 'New project'}
      description={
        forceSample
          ? 'Work given away — nothing quoted and nothing billed. What it costs is tracked, so you can see what winning this client took.'
          : prefill?.sourceProposalId
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

          {/*
            No "this is sample work" tick here.

            There was one, and it duplicated the Sample work card's own button,
            which opens this same form with the question already answered. Two
            ways to make a sample — one of them a checkbox inside the form for
            priced work — meant a sample could be started from the Projects
            card and then sit in a list headed "one-off work, whole contract".
            The card you press decides what you are making.
          */}

          {!isSample && (
            <GstAmountFields
              mode="revenue"
              label="Quoted value (₹)"
              amount={quotedValue}
              onAmountChange={changeQuote}
              gstPercent={gstPercent}
              onGstChange={setGstPercent}
              required={false}
              hint="Before GST. Leave it at 0 if there is no price yet."
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Start date"
              value={startDate}
              onChange={setStartDate}
              type="date"
              required={!isSample}
              hint={isSample ? 'Left blank, it is today.' : undefined}
            />
            <Field
              label="Expected end"
              value={endDate}
              onChange={setEndDate}
              type="date"
              required={!isSample}
              hint={isSample ? 'Optional — a sample rarely has one.' : undefined}
            />
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

          {splits && (
            <FieldSelect label="Billing" value={billing} onChange={(v) => setBilling(v as Billing)} options={BILLING_OPTIONS} />
          )}
          {!isSample && !splits && (
            <p className="rounded-xl border border-border bg-subtle/40 px-3 py-2.5 text-xs text-secondary">
              No price yet, so nothing is split for billing. Once the price is agreed, set the quoted value on the
              project and add its milestones there.
            </p>
          )}

          {splits && billing !== 'CUSTOM' && (
            <div className="rounded-xl border border-border bg-subtle/40 p-3 text-xs text-secondary space-y-1">
              {milestonesForBilling().map((m) => (
                <div key={m.label} className="flex justify-between">
                  <span>{m.label} · {m.percent}%</span>
                  <span className="font-medium text-body">{formatMoney(m.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {splits && billing === 'CUSTOM' && (
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
          {!error && missing && <p className="text-right text-xs text-secondary">{missing}</p>}
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
