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

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  prefill?: Prefill;
};

export function NewRetainerModal({ open, onClose, onCreated, prefill }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const team = useTeamMembers();
  const [companyId, setCompanyId] = useState('');
  const [monthlyValue, setMonthlyValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCompanyId(prefill?.companyId ?? '');
    setMonthlyValue(prefill?.monthlyValue != null ? String(prefill.monthlyValue) : '');
    setStartDate(new Date().toISOString().slice(0, 10));
    setTermMonths('');
    setOwnerId('');
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
        sourceProposalId: prefill?.sourceProposalId,
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
          : 'What they pay each month. Name the work itself once the retainer exists.'
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
          <Field label="Monthly value (₹)" value={monthlyValue} onChange={setMonthlyValue} type="number" required />
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
