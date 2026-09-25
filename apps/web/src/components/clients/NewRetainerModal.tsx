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
import { api, ApiError, type Company } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
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

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  prefill?: Prefill;
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

export function NewRetainerModal({ open, onClose, onCreated, prefill, deals = [] }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const team = useTeamMembers();
  const [companyId, setCompanyId] = useState('');
  const [monthlyValue, setMonthlyValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [firstProjectName, setFirstProjectName] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [sourceProposalId, setSourceProposalId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setStartDate(new Date().toISOString().slice(0, 10));
    setTermMonths('');
    setFirstProjectName('');
    setOwnerId('');
    setSourceProposalId(prefill?.sourceProposalId ?? '');
    setError(null);
    if (!prefill) {
      void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
    }
  }, [open, prefill]);

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
        startDate,
        termMonths: termMonths ? Number(termMonths) : undefined,
        ownerId: ownerId || undefined,
        firstProjectName: firstProjectName.trim() || undefined,
        sourceProposalId: prefill?.sourceProposalId ?? sourceProposalId ?? undefined,
      });
      const created = (res as { retainer?: { id: string } }).retainer;
      if (created?.id) onCreated(created.id);
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
          <Field label="Monthly value (₹)" value={monthlyValue} onChange={setMonthlyValue} type="number" required />
          {/* Optional, and the first thing you see on the retainer afterwards.
              Left blank it falls back to "Monthly Retainer Work" -- a name
              nobody chose, which is what this field exists to avoid. */}
          <Field
            label="What work is this for?"
            value={firstProjectName}
            onChange={setFirstProjectName}
            placeholder="e.g. Social media management"
            hint="Optional. You can add more streams of work, and rename this, at any time."
          />
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
