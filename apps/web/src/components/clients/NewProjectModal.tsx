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
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { PRIORITY_CONFIG } from '@/lib/priority';
import { personOptions } from '@/lib/people';

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
};

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

type Billing = 'STANDARD' | 'SINGLE' | 'CUSTOM';

const BILLING_OPTIONS = [
  { value: 'STANDARD', label: 'Standard (40% advance / 30% design sign-off / 30% launch)' },
  { value: 'SINGLE', label: 'Single invoice on delivery' },
  { value: 'CUSTOM', label: 'Custom milestones' },
];

type CustomRow = { label: string; percent: string };
const blankRow = (): CustomRow => ({ label: '', percent: '' });


export function NewProjectModal({ open, onClose, onCreated, prefill }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [team, setTeam] = useState<{ id: string; name: string; dept: string }[]>([]);
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

  useEffect(() => {
    if (!open) return;
    setCompanyId(prefill?.companyId ?? '');
    setName('');
    setQuotedValue(prefill?.quotedValue != null ? String(prefill.quotedValue) : '');
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
    void api.team.members().then((res) => setTeam(res.members)).catch(() => {});
  }, [open, prefill]);

  const quoted = Number(quotedValue) || 0;
  const customPercentTotal = customRows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const customFilled = customRows.filter((r) => r.label.trim() && Number(r.percent) > 0);
  const customValid = billing !== 'CUSTOM' || (customFilled.length > 0 && customPercentTotal === 100);

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
        const percent = Number(r.percent);
        return { label: r.label.trim(), percent, amount: Math.round((quoted * percent) / 100) };
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
        sourceProposalId: prefill?.sourceProposalId,
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
                const percent = Number(row.percent) || 0;
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
                      onChange={(e) => updateRow(idx, { percent: e.target.value })}
                      placeholder="%"
                      aria-label={`Milestone ${idx + 1} percent of the quote`}
                    />
                    <span className="w-24 shrink-0 text-xs text-secondary text-right">
                      {percent > 0 && quoted > 0 ? formatMoney(Math.round((quoted * percent) / 100)) : ''}
                    </span>
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
              <p className={`text-xs ${customPercentTotal === 100 ? 'text-secondary' : 'text-danger font-medium'}`}>
                {customPercentTotal}% of 100% allocated
                {customPercentTotal !== 100 ? ' — must add up to 100%' : ''}
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
