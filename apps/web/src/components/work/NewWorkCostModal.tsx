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

/**
 * Whose money it was.
 *
 * The Money screen's form has always asked; this one never did, so a cost paid
 * out of somebody's own pocket on a shoot was recorded as the company's and the
 * loan back to them was invisible. Same three answers as the other form, from
 * the same enum, because two lists of the same thing drift.
 */
const PAID_BY_OPTIONS = [
  { value: 'COMPANY', label: 'Company' },
  { value: 'AKMAL', label: 'Akmal' },
  { value: 'JAMEEL_N_J_MACSON', label: 'Jameel, N J Macson' },
];

const COST_CATEGORIES = ['Ad spend', 'Freelancer', 'Photography and video', 'Printing', 'Hosting and domain', 'Stock and licences', 'Travel, client', 'Venue and events'];

/**
 * The escape hatch on a fixed list.
 *
 * Eight categories cover most of what an agency spends on a job and not all of
 * it — a bond for a location, a courier, a permit. With no way out of the list
 * the cost went in under whichever heading looked closest, so the category
 * stopped meaning anything, or it did not go in at all and the job's profit was
 * wrong by the amount nobody recorded.
 *
 * Choosing Other asks what it was and stores THOSE words as the category, not
 * "Other" — so a second location bond next month can be grouped with the first
 * rather than joining a pile that has to be read line by line.
 */
export const OTHER_CATEGORY = 'Other';

export function NewWorkCostModal({ open, target, onClose, onCreated }: Props) {
  const [category, setCategory] = useState('');
  const [otherCategory, setOtherCategory] = useState('');
  const [vendor, setVendor] = useState('');
  const [paidBy, setPaidBy] = useState('COMPANY');
  const [amount, setAmount] = useState('');
  const [incurredAt, setIncurredAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategory('');
      setOtherCategory('');
      setVendor('');
      setPaidBy('COMPANY');
      setAmount('');
      setIncurredAt(new Date().toISOString().slice(0, 10));
      setError(null);
    }
  }, [open]);

  /** What actually gets stored — the typed words when the list ran out. */
  const storedCategory = category === OTHER_CATEGORY ? otherCategory.trim() : category;

  const canSave = Boolean(storedCategory) && vendor.trim().length > 0 && Number(amount) > 0;

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
        category: storedCategory,
        vendor: vendor.trim(),
        paidBy,
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
            label="Paid towards"
            value={category}
            onChange={setCategory}
            required
            placeholder="Choose…"
            options={[...COST_CATEGORIES, OTHER_CATEGORY].map((c) => ({ value: c, label: c }))}
          />
          {category === OTHER_CATEGORY && (
            <Field
              label="What kind of cost?"
              value={otherCategory}
              onChange={setOtherCategory}
              required
              placeholder="e.g. Location bond"
              hint="Stored as the category itself, so the next one like it groups with this."
            />
          )}
          <Field
            label="Paid to"
            value={vendor}
            onChange={setVendor}
            required
            placeholder="Who the money went to"
          />
          <FieldSelect label="Paid by" value={paidBy} onChange={setPaidBy} required options={PAID_BY_OPTIONS} />
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
