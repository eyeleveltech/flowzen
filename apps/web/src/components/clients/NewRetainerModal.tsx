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
import { api, ApiError, type Company, type TaskTemplate } from '@/lib/api-v2';
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
  const [team, setTeam] = useState<{ id: string; name: string; dept: string }[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [monthlyValue, setMonthlyValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCompanyId(prefill?.companyId ?? '');
    setMonthlyValue(prefill?.monthlyValue != null ? String(prefill.monthlyValue) : '');
    setStartDate(new Date().toISOString().slice(0, 10));
    setTermMonths('');
    setOwnerId('');
    setTemplateId('');
    setError(null);
    if (!prefill) {
      void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
    }
    void api.team.members().then((res) => setTeam(res.members)).catch(() => {});
    void api.taskTemplates.list().then((res) => res.success && setTemplates(res.templates)).catch(() => {});
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
        templateId: templateId || undefined,
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
      description={prefill ? 'Value carries over from the won version — adjust anything before saving.' : undefined}
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
          <div>
            <FieldSelect
              label="Monthly task template"
              value={templateId}
              onChange={setTemplateId}
              placeholder="No recurring tasks"
              options={templates.map((t) => ({ value: t.id, label: `${t.name} (${t.items.length} task${t.items.length === 1 ? '' : 's'})` }))}
            />
            <p className="mt-1 text-xs text-secondary">Spawns these tasks on the month card automatically, every month.</p>
          </div>
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
