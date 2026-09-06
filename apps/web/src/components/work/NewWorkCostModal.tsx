'use client';

/**
 * Recording a direct cost against either a Project or a Retainer's month
 * card — shared for the same reason as `NewWorkTaskModal`: identical form,
 * only which id it's filed under differs.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Target = { kind: 'PROJECT'; projectId: string } | { kind: 'MONTH_CARD'; monthCardId: string };

type Props = {
  open: boolean;
  target: Target;
  onClose: () => void;
  onCreated: () => void;
};

const COST_CATEGORIES = ['Ad spend', 'Freelancer', 'Photography and video', 'Printing', 'Hosting and domain', 'Stock and licences', 'Travel, client', 'Venue and events'];

export function NewWorkCostModal({ open, target, onClose, onCreated }: Props) {
  const [category, setCategory] = useState('');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredAt, setIncurredAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategory('');
      setVendor('');
      setAmount('');
      setIncurredAt(new Date().toISOString().slice(0, 10));
      setError(null);
    }
  }, [open]);

  const canSave = Boolean(category) && vendor.trim().length > 0 && Number(amount) > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.costs.create({
        type: 'DIRECT',
        projectId: target.kind === 'PROJECT' ? target.projectId : undefined,
        monthCardId: target.kind === 'MONTH_CARD' ? target.monthCardId : undefined,
        category,
        vendor: vendor.trim(),
        amount: Number(amount),
        incurredAt,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that cost');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a cost">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <FieldSelect
            label="Category"
            value={category}
            onChange={setCategory}
            required
            placeholder="Choose…"
            options={COST_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          <Field label="Vendor" value={vendor} onChange={setVendor} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₹)" value={amount} onChange={setAmount} type="number" required />
            <Field label="Date" value={incurredAt} onChange={setIncurredAt} type="date" required />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
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
