'use client';

/**
 * Creating a retainer — brief §11.2 step 1: "Retainer created from the won
 * proposal. Value carries across. Owner, start date and term are confirmed.
 * A null term is flagged as a contract risk."
 *
 * Same prefill pattern as `NewProjectModal`: opened from a won proposal, the
 * company and monthly value carry over and stay editable; opened bare (no
 * proposal on record) it asks for a company like any other form. Saving
 * also creates the current month's MonthCard — that's the server's job, not
 * this form's.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError, type Company } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { GstAmountFields } from '@/components/work/GstAmountFields';
import { BILLING_OPTIONS } from '@/lib/retainerBilling';
import type { RetainerBilling } from '@/lib/api-v2';
import { ErrorNote } from '@/components/ui/empty-state';
import { personOptions } from '@/lib/people';

type Prefill = {
  companyId: string;
  companyName: string;
  monthlyValue?: number;
  sourceProposalId?: string;
};

/** A won deal this company has not turned into work yet. */
export type UnfulfilledDeal = {
  id: string;
  /** What it says on the card — "v2 · ₹60,000 · Monthly retainer". */
  label: string;
  /** The won version's figure, carried into the form when it is chosen. */
  value: number;
};

/**
 * Values to start the form with — what Zen filled in (Zen Plan 4). Applied as
 * the form opens, after its own defaults; the person still reads and saves it.
 */
export type RetainerInitial = {
  gstPercent?: number;
  billing?: RetainerBilling;
  startDate?: string;
  termMonths?: number;
  firstProjectName?: string;
  ownerId?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  prefill?: Prefill;
  initial?: RetainerInitial;
  /**
   * The won deals this retainer could be coming from.
   *
   * Passed by the caller that knows them — the client's own page. Without this
   * the form asks nothing, which is how a retainer created from the Work tab
   * ended up with no link back to the deal that sold it: the proposal kept
   * offering "Create retainer from this" as though nothing had happened, and
   * nothing could compare what was quoted with what is running.
   */
  deals?: UnfulfilledDeal[];
};

export function NewRetainerModal({ open, onClose, onCreated, prefill, initial, deals = [] }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const team = useTeamMembers();
  const [companyId, setCompanyId] = useState('');
  const [monthlyValue, setMonthlyValue] = useState('');
  /** The GST on the monthly fee, beside it, never in it — see NewProjectModal. */
  const [gstPercent, setGstPercent] = useState('18');
  const [billing, setBilling] = useState<RetainerBilling>('IN_ADVANCE');
  const [startDate, setStartDate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [firstProjectName, setFirstProjectName] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [sourceProposalId, setSourceProposalId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The won proposal's other monthly services, offered as more projects on the retainer. */
  const [extras, setExtras] = useState<{ name: string; on: boolean }[]>([]);
  /** The proposal these figures came from, when it was written in Flowzen. */
  const [handedFrom, setHandedFrom] = useState<string | null>(null);

  /*
   * Only asked when there is something to ask about: a deal was won for this
   * client and no retainer has been built from it. Opened from the proposal
   * itself the answer is already known, so the question does not appear.
   */
  const asksWhichDeal = !prefill?.sourceProposalId && deals.length > 0;

  useEffect(() => {
    if (!open) return;
    setCompanyId(prefill?.companyId ?? '');
    setMonthlyValue(prefill?.monthlyValue != null ? String(prefill.monthlyValue) : '');
    setGstPercent('18');
    setBilling('IN_ADVANCE');
    setStartDate(new Date().toISOString().slice(0, 10));
    setTermMonths('');
    setFirstProjectName('');
    setOwnerId('');
    setSourceProposalId(prefill?.sourceProposalId ?? '');
    setExtras([]);
    setHandedFrom(null);
    // What Zen filled in, over the defaults.
    if (initial?.gstPercent != null) setGstPercent(String(initial.gstPercent));
    if (initial?.billing) setBilling(initial.billing);
    if (initial?.startDate) setStartDate(initial.startDate);
    if (initial?.termMonths != null) setTermMonths(String(initial.termMonths));
    if (initial?.firstProjectName) setFirstProjectName(initial.firstProjectName);
    if (initial?.ownerId) setOwnerId(initial.ownerId);
    setError(null);
    if (!prefill) {
      void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
    }
  }, [open, prefill, initial]);

  /*
   * A won deal's own proposal, when it was written in Flowzen (AI Proposal
   * Builder, phase 3): its monthly fee and GST, and each monthly service as a
   * project on the retainer. Filled in, never saved — the person reads it and
   * presses Create, and can change or untick anything first.
   */
  const dealId = prefill?.sourceProposalId || sourceProposalId;
  useEffect(() => {
    if (!open || !dealId) return;
    let live = true;
    api.proposalDocs
      .handoff(dealId)
      .then((h) => {
        if (!live || !h.retainer) return;
        if (h.retainer.monthlyValue != null) setMonthlyValue(String(h.retainer.monthlyValue));
        setGstPercent(String(h.retainer.gstPercent));
        const [first, ...rest] = h.retainer.projects;
        if (first) setFirstProjectName((current) => current || first);
        setExtras(rest.map((name) => ({ name, on: true })));
        setHandedFrom(h.fromDocument?.ref ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, dealId]);

  const canSave = Boolean(companyId) && Number(monthlyValue) > 0 && Boolean(startDate);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.retainers.create({
        companyId,
        monthlyValue: Number(monthlyValue),
        gstPercent: gstPercent ? Number(gstPercent) : null,
        billing,
        startDate,
        termMonths: termMonths ? Number(termMonths) : undefined,
        ownerId: ownerId || undefined,
        firstProjectName: firstProjectName.trim() || undefined,
        sourceProposalId: prefill?.sourceProposalId ?? sourceProposalId ?? undefined,
      });
      const created = (res as { retainer?: { id: string } }).retainer;
      if (created?.id) {
        // The won proposal's other services, as projects on the new retainer.
        const missed: string[] = [];
        for (const extra of extras.filter((x) => x.on && x.name.trim())) {
          try {
            await api.retainers.createProject(created.id, { name: extra.name.trim() });
          } catch {
            missed.push(extra.name);
          }
        }
        if (missed.length) toast.error(`Retainer created. Add ${missed.join(', ')} on the retainer: they could not be added here.`);
        onCreated(created.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the retainer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New retainer"
      /*
       * Only a proposal can carry a value over.
       *
       * This keyed off `prefill` alone, which used to mean "opened from a won
       * proposal" because that was the only way in. It is not any more -- the
       * client's Work tab opens this with the company filled and nothing else
       * -- so the line promised a figure that had been carried over from a
       * won version that does not exist, above a blank Monthly value.
       */
      description={
        prefill?.sourceProposalId
          ? 'Value carries over from the won version — adjust anything before saving.'
          : 'What they pay each month, and what the work is called.'
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
                // The value it was sold at, rather than a figure retyped from
                // memory. Still editable — what was agreed can differ from what
                // was quoted, and the retainer is the thing being agreed now.
                const deal = deals.find((d) => d.id === v);
                if (deal) setMonthlyValue(String(deal.value));
              }}
              options={[
                { value: '', label: 'Not from a proposal' },
                ...deals.map((d) => ({ value: d.id, label: d.label })),
              ]}
              hint="Linking it carries the figure over and ties the work back to the deal that sold it."
            />
          )}
          <GstAmountFields
            mode="revenue"
            label="Monthly value (₹)"
            amount={monthlyValue}
            onAmountChange={setMonthlyValue}
            gstPercent={gstPercent}
            onGstChange={setGstPercent}
            required
            hint="Before GST — what each month earns."
          />
          <FieldSelect
            label="Bills"
            value={billing}
            onChange={(v) => setBilling(v as RetainerBilling)}
            options={BILLING_OPTIONS}
            hint="In advance: the proforma goes out on the 1st, before the work. After: once the month is over."
          />
          {/* Optional, and the first thing you see on the retainer afterwards.
              Left blank it falls back to "Monthly Retainer Work" -- a name
              nobody chose, which is what this field exists to avoid. */}
          {handedFrom && (
            <p className="rounded-xl bg-subtle px-3 py-2 text-xs text-secondary">
              Filled in from proposal {handedFrom}. Change anything before you create it.
            </p>
          )}
          <Field
            label="What work is this for?"
            value={firstProjectName}
            onChange={setFirstProjectName}
            placeholder="e.g. Social media management"
            hint="Optional. You can add more streams of work, and rename this, at any time."
          />
          {extras.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium text-body">Also add these as projects on the retainer</legend>
              {extras.map((x, i) => (
                <label key={x.name} className="flex items-center gap-2 text-sm text-body">
                  <input
                    type="checkbox"
                    checked={x.on}
                    onChange={(e) => setExtras((list) => list.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))}
                  />
                  {x.name}
                </label>
              ))}
            </fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" value={startDate} onChange={setStartDate} type="date" required />
            <Field
              label="Term (months)"
              value={termMonths}
              onChange={setTermMonths}
              type="number"
              hint="Leave blank for no fixed term — flagged as a contract risk."
            />
          </div>
          <FieldSelect
            label="Owner"
            value={ownerId}
            onChange={setOwnerId}
            placeholder="Defaults to you"
            options={personOptions(team)}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Create retainer
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
