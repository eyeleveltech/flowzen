'use client';

/**
 * Recording any cost from the Money screen — the general form, as opposed
 * to `NewWorkCostModal`'s quick add from inside a project or month card
 * (always a direct client cost, target already known).
 *
 * "Is this for a client?" is the first and most important question — brief:
 * "the first question is the whole point. It is the field your current
 * ledger does not have." Direct costs need a client to bill against;
 * Company and Capital costs don't.
 */

import { useEffect, useState } from 'react';
import { api, ApiError, type Company } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type CostType = 'DIRECT' | 'COMPANY' | 'CAPITAL';
type Target = { label: string; workType: 'RETAINER' | 'PROJECT'; monthCardId?: string; projectId?: string };

const CLIENT_CATEGORIES = ['Ad spend', 'Freelancer', 'Photography and video', 'Printing', 'Hosting and domain', 'Stock and licences', 'Travel, client', 'Venue and events'];
const COMPANY_CATEGORIES = ['Salaries', 'Office rent', 'Internet and utilities', 'Software', 'Pantry and tea', 'Travel, not client', 'Professional fees', 'Marketing, our own'];

const PAID_BY_OPTIONS = [
  { value: 'COMPANY', label: 'Company' },
  { value: 'AKMAL', label: 'Akmal' },
  { value: 'JAMEEL_N_J_MACSON', label: 'Jameel, N J Macson' },
];
const TREATMENT_OPTIONS = [
  { value: 'COMPANY_EXPENSE', label: 'Company expense' },
  { value: 'AKMAL_LOAN', label: 'Akmal loan' },
  { value: 'N_J_MACSON_LOAN', label: 'N J Macson loan' },
];

export function NewCostModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<CostType>('DIRECT');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetKey, setTargetKey] = useState('');

  const [category, setCategory] = useState('');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredAt, setIncurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [paidBy, setPaidBy] = useState('COMPANY');
  const [treatment, setTreatment] = useState('COMPANY_EXPENSE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (type !== 'DIRECT') return;
    void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
  }, [type]);

  useEffect(() => {
    setTargets([]);
    setTargetKey('');
    if (type !== 'DIRECT' || !companyId) return;
    setLoadingTargets(true);
    void api.companies
      .get(companyId)
      .then((res) => {
        const company = (res as { company?: any }).company ?? res;
        const list: Target[] = [];
        for (const r of company.retainers ?? []) {
          if (r.status !== 'ACTIVE') continue;
          const currentMonth = (r.monthCards ?? [])[0];
          if (currentMonth) list.push({ label: `Retainer — ${currentMonth.month}`, workType: 'RETAINER', monthCardId: currentMonth.id });
        }
        for (const p of company.projects ?? []) {
          if (p.status !== 'LIVE') continue;
          list.push({ label: `Project — ${p.name}`, workType: 'PROJECT', projectId: p.id });
        }
        setTargets(list);
      })
      .catch(() => {})
      .finally(() => setLoadingTargets(false));
  }, [companyId, type]);

  const selectedTarget = targets.find((t) => (t.monthCardId ?? t.projectId) === targetKey);
  const canSave =
    Boolean(category.trim()) &&
    Boolean(vendor.trim()) &&
    Number(amount) > 0 &&
    Boolean(incurredAt) &&
    (type !== 'DIRECT' || Boolean(selectedTarget));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.costs.create({
        type,
        category: category.trim(),
        vendor: vendor.trim(),
        amount: Number(amount),
        incurredAt,
        paidBy,
        treatment,
        workType: type === 'DIRECT' ? selectedTarget?.workType : undefined,
        monthCardId: type === 'DIRECT' ? selectedTarget?.monthCardId : undefined,
        projectId: type === 'DIRECT' ? selectedTarget?.projectId : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that cost');
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = type === 'DIRECT' ? CLIENT_CATEGORIES : type === 'COMPANY' ? COMPANY_CATEGORIES : null;

  return (
    <Modal open onClose={onClose} title="Record a cost">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <FieldSelect
            label="Is this for a client?"
            value={type}
            onChange={(v) => setType(v as CostType)}
            required
            options={[
              { value: 'DIRECT', label: 'Yes — against a client or project' },
              { value: 'COMPANY', label: 'No — a company cost' },
              { value: 'CAPITAL', label: 'Capital or loan' },
            ]}
          />

          {type === 'DIRECT' && (
            <>
              <FieldSelect
                label="Company"
                value={companyId}
                onChange={setCompanyId}
                required
                placeholder="Choose a company…"
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
              />
              <FieldSelect
                label="Against"
                value={targetKey}
                onChange={setTargetKey}
                required
                disabled={!companyId || loadingTargets}
                placeholder={!companyId ? 'Choose a company first' : loadingTargets ? 'Loading…' : targets.length === 0 ? 'Nothing live to bill' : 'Choose…'}
                options={targets.map((t) => ({ value: (t.monthCardId ?? t.projectId)!, label: t.label }))}
              />
            </>
          )}

          {categoryOptions ? (
            <FieldSelect
              label="Category"
              value={category}
              onChange={setCategory}
              required
              placeholder="Choose…"
              options={categoryOptions.map((c) => ({ value: c, label: c }))}
            />
          ) : (
            <Field label="Category" value={category} onChange={setCategory} required placeholder="e.g. Equipment" />
          )}

          <Field label="Vendor" value={vendor} onChange={setVendor} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₹)" value={amount} onChange={setAmount} type="number" required />
            <Field label="Date" value={incurredAt} onChange={setIncurredAt} type="date" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect label="Paid by" value={paidBy} onChange={setPaidBy} required options={PAID_BY_OPTIONS} />
            <FieldSelect label="Treatment" value={treatment} onChange={setTreatment} required options={TREATMENT_OPTIONS} />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Record cost
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
