'use client';

/**
 * Entering a retainer month's tax invoice.
 *
 * Mirrors the invoice already raised in Tally — this issues nothing. Two ways
 * in: straight onto the month (billed after it, no proforma), or from the
 * month's proforma once the client has paid it, which links the two so the
 * proforma shows its invoice and the month shows both.
 *
 * Lived inside the retainer page; moved here when the Money screen's billing
 * board needed the same form.
 */

import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  companyId: string;
  monthCardId: string;
  /** "October 2026", for the title. */
  monthLabel?: string;
  defaultAmount: number;
  /** The proforma this invoice settles, when there is one. */
  proforma?: { id: string; number: string } | null;
  onClose: () => void;
  onCreated: () => void;
};

export function EnterInvoiceModal({ companyId, monthCardId, monthLabel, defaultAmount, proforma, onClose, onCreated }: Props) {
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '');
  const [raisedAt, setRaisedAt] = useState(new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = Boolean(number.trim()) && Number(amount) > 0 && Boolean(raisedAt);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.invoices.create({
        companyId,
        monthCardId,
        ...(proforma ? { proformaId: proforma.id } : {}),
        workType: 'RETAINER',
        amount: Number(amount),
        raisedAt,
        dueAt: dueAt || undefined,
        customNumber: number.trim(),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not enter this invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={proforma ? `Invoice for ${proforma.number}` : 'Enter invoice'}
      description={
        proforma
          ? `The tax invoice raised in Tally for this proforma${monthLabel ? ` — ${monthLabel}` : ''}. It is linked to both.`
          : `Mirrors the tax invoice already raised in Tally${monthLabel ? ` for ${monthLabel}` : ''} — this doesn't issue anything.`
      }
    >
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="Invoice number (from Tally)" value={number} onChange={setNumber} required placeholder="e.g. INV-2026-0142" />
          <Field label="Amount (₹)" value={amount} onChange={setAmount} type="number" required hint="As on the Tally invoice." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Raised on" value={raisedAt} onChange={setRaisedAt} type="date" required />
            <Field label="Due date" value={dueAt} onChange={setDueAt} type="date" hint="Defaults to 15 days from raised" />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Enter invoice
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
