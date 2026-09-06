'use client';

/**
 * Recording a Tally-raised invoice against a company's retainer month or a
 * project — brief: "Tally stays the legal record... this only tracks the
 * commercial fact." The number here is typed in, never generated, because
 * it has to match what Tally already issued.
 *
 * Company-first, then "bill against": a retainer's most recent un-invoiced
 * month, or any live project. A month that already has an invoice is left
 * out — the backend only allows one per month anyway.
 */

import { useEffect, useState } from 'react';
import { api, ApiError, type Company } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Target = { label: string; workType: 'RETAINER' | 'PROJECT'; monthCardId?: string; projectId?: string };

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export function NewInvoiceModal({ onClose, onCreated }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetKey, setTargetKey] = useState('');

  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [raisedAt, setRaisedAt] = useState(new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
  }, []);

  useEffect(() => {
    setTargets([]);
    setTargetKey('');
    if (!companyId) return;
    setLoadingTargets(true);
    void api.companies
      .get(companyId)
      .then((res) => {
        const company = (res as { company?: any }).company ?? res;
        const list: Target[] = [];
        for (const r of company.retainers ?? []) {
          if (r.status !== 'ACTIVE') continue;
          const openMonth = (r.monthCards ?? []).find((m: any) => !m.invoice);
          if (openMonth) {
            list.push({ label: `Retainer — ${openMonth.month}`, workType: 'RETAINER', monthCardId: openMonth.id });
          }
        }
        for (const p of company.projects ?? []) {
          if (p.status !== 'LIVE') continue;
          list.push({ label: `Project — ${p.name}`, workType: 'PROJECT', projectId: p.id });
        }
        setTargets(list);
      })
      .catch(() => {})
      .finally(() => setLoadingTargets(false));
  }, [companyId]);

  const selectedTarget = targets.find((t) => (t.monthCardId ?? t.projectId) === targetKey);
  const canSave = Boolean(companyId) && Boolean(selectedTarget) && Boolean(number.trim()) && Number(amount) > 0 && Boolean(raisedAt);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !selectedTarget) return;
    setSaving(true);
    setError(null);
    try {
      await api.invoices.create({
        companyId,
        amount: Number(amount),
        raisedAt,
        dueAt: dueAt || undefined,
        customNumber: number.trim(),
        workType: selectedTarget.workType,
        monthCardId: selectedTarget.monthCardId,
        projectId: selectedTarget.projectId,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record this invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Record an invoice" description="Mirrors the tax invoice already raised in Tally — this doesn't issue anything.">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <FieldSelect
            label="Company"
            value={companyId}
            onChange={setCompanyId}
            required
            placeholder="Choose a company…"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />

          <FieldSelect
            label="Bill against"
            value={targetKey}
            onChange={setTargetKey}
            required
            disabled={!companyId || loadingTargets}
            placeholder={!companyId ? 'Choose a company first' : loadingTargets ? 'Loading…' : targets.length === 0 ? 'Nothing open to bill' : 'Choose…'}
            options={targets.map((t) => ({ value: (t.monthCardId ?? t.projectId)!, label: t.label }))}
          />

          <Field label="Tally invoice number" value={number} onChange={setNumber} required placeholder="e.g. INV-2026-0142" />
          <Field label="Amount (₹)" value={amount} onChange={setAmount} type="number" required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Raised on" value={raisedAt} onChange={setRaisedAt} type="date" required />
            <Field label="Due date" value={dueAt} onChange={setDueAt} type="date" hint="Defaults to 15 days from raised" />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Record invoice
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
