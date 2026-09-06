'use client';

/** Recording a payment against an invoice — shared between the Money screen and the Month Card page. */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

const PAYMENT_MODES = ['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'CASH'];

export function RecordPaymentModal({
  invoiceId,
  defaultAmount,
  onClose,
  onRecorded,
}: {
  invoiceId: string;
  defaultAmount: number;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount));
  const [mode, setMode] = useState('NEFT');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = Number(amount) > 0 && Boolean(mode);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.invoices.recordPayment(invoiceId, {
        amount: Number(amount),
        mode,
        reference: reference.trim() || undefined,
        receivedAt,
      });
      toast.success('Payment recorded');
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record this payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Record payment">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="Amount (₹)" value={amount} onChange={setAmount} type="number" required />
          <FieldSelect label="Mode" value={mode} onChange={setMode} required options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))} />
          <Field label="Reference" value={reference} onChange={setReference} placeholder="UTR / cheque no. (optional)" />
          <Field label="Received on" value={receivedAt} onChange={setReceivedAt} type="date" required />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Record payment
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
