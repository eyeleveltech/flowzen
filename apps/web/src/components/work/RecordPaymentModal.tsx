'use client';

/** Recording a payment against an invoice — shared between the Money screen and the Month Card page. */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { InvoiceGstFields, paymentGstStart, useInvoiceGst } from '@/components/work/InvoiceGstFields';

const PAYMENT_MODES = ['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'CASH'];

export function RecordPaymentModal({
  invoiceId,
  defaultAmount,
  invoiceTotal,
  invoiceGst,
  onClose,
  onRecorded,
}: {
  invoiceId: string;
  /** What is expected — usually the balance due, GST included. */
  defaultAmount: number;
  /** The invoice's total and the GST inside it: when it has GST, the payment starts split in the same ratio. */
  invoiceTotal?: number | string | null;
  invoiceGst?: number | string | null;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [start] = useState(() =>
    paymentGstStart(defaultAmount, { total: Number(invoiceTotal ?? 0), gst: Number(invoiceGst ?? 0) }),
  );
  const [amount, setAmount] = useState(String(start.base));
  const gst = useInvoiceGst(amount, { defaultOn: start.on, ratePercent: start.ratePercent, defaultGst: start.gst });
  const [mode, setMode] = useState('NEFT');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = Number(amount) > 0 && Boolean(mode) && gst.gstValid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.invoices.recordPayment(invoiceId, {
        amount: gst.on ? gst.total : Number(amount),
        ...(gst.gstAmount !== null ? { gstAmount: gst.gstAmount } : {}),
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
          <Field label={gst.on ? 'Amount before GST (₹)' : 'Amount (₹)'} value={amount} onChange={setAmount} type="number" required />
          <InvoiceGstFields gst={gst} disabled={saving} kind="payment" />
          <FieldSelect label="Mode" value={mode} onChange={setMode} required options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))} />
          <Field label="Reference" value={reference} onChange={setReference} placeholder="UTR / cheque no. (optional)" />
          <Field
            label="Date the client paid"
            value={receivedAt}
            onChange={setReceivedAt}
            type="date"
            required
            hint="The day the money reached you — change it if that was not today."
          />
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
