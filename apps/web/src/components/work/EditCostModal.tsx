'use client';

/**
 * Correcting a cost.
 *
 * There was no way to. A cost could be entered, confirmed and soft-deleted,
 * but a mistyped amount could only be deleted and re-entered — which loses who
 * entered it and when — so in practice the wrong figure stayed and skewed that
 * month's margin for good.
 *
 * Deliberately only what the entry form collects, and nothing that would move
 * the cost to a different month or a different piece of work. Re-filing a cost
 * somewhere else is deleting it and entering it there, which is what the
 * activity trail should show.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { GstAmountFields, grossFromBase, baseFromGross } from '@/components/work/GstAmountFields';
import { ErrorNote } from '@/components/ui/empty-state';

export type EditableCost = {
  id: string;
  category: string;
  vendor: string;
  /** Whose money it was. Named `paidBy` on the record, "Company" on screen. */
  paidBy?: string | null;
  amount: string | number | null;
  /** The rate the amount already includes, if one was recorded. */
  gstPercent?: number | null;
  incurredAt: string;
};

type Props = {
  cost: EditableCost;
  onSaved: () => void;
  onClose: () => void;
};

export function EditCostModal({ cost, onSaved, onClose }: Props) {
  const [category, setCategory] = useState(cost.category ?? '');
  const [vendor, setVendor] = useState(cost.vendor ?? '');
  /*
   * Whose money it was, which this form left out.
   *
   * Both entry forms collect it, the server has accepted it on PATCH since it
   * was added, and every list and the printed sheet show it — so the one place
   * a wrong one could be corrected was the only place that did not ask. A cost
   * filed against the wrong company had to be deleted and re-entered, which is
   * exactly what this form exists to avoid.
   */
  const [paidBy, setPaidBy] = useState(cost.paidBy ?? '');
  /*
    * Shown as it was entered — the bill's figure and its rate — not as the
    * total. Re-editing a ₹11,800 row as "11800 + 18%" would put ₹13,924 back
    * into the month, which is how a correction turns into a second mistake.
    */
   const [gstPercent, setGstPercent] = useState(cost.gstPercent != null ? String(cost.gstPercent) : '');
   const [amount, setAmount] = useState(baseFromGross(cost.amount, cost.gstPercent));
  const [incurredAt, setIncurredAt] = useState((cost.incurredAt ?? '').slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave =
    category.trim().length > 0 &&
    vendor.trim().length > 0 &&
    paidBy.trim().length > 0 &&
    Number(amount) > 0 &&
    Boolean(incurredAt) &&
    !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.costs.update(cost.id, {
        category: category.trim(),
        vendor: vendor.trim(),
        paidBy: paidBy.trim(),
        amount: grossFromBase(amount, gstPercent),
        gstPercent: gstPercent ? Number(gstPercent) : null,
        incurredAt,
      });
      toast.success('Cost updated');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that cost');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit cost"
      description="The old figure is kept on the record, so a later “why did this month move?” stays answerable."
    >
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="Paid towards" value={category} onChange={setCategory} required />
          <Field label="Paid to" value={vendor} onChange={setVendor} required />
          <Field label="Company" value={paidBy} onChange={setPaidBy} required placeholder="Whose money it was" />
          {/* The bill's figure and its tax, with the total said out loud —
              see GstAmountFields on why the TOTAL is what gets stored. */}
          <GstAmountFields
            amount={amount}
            onAmountChange={setAmount}
            gstPercent={gstPercent}
            onGstChange={setGstPercent}
          />
          <Field label="Date" value={incurredAt} onChange={setIncurredAt} type="date" required />
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
