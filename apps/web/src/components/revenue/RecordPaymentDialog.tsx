'use client';

import { useState } from 'react';
import { api, ApiError, formatMoney } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

const PAYMENT_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Bank Transfer (NEFT / RTGS / IMPS)' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Credit / Debit Card' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OTHER', label: 'Other' },
];

type InvoiceTarget = {
  id: string;
  number: string;
  total: string;
  balance: string;
  company: { id: string; name: string };
};

type Props = {
  invoice: InvoiceTarget | null;
  currency?: string;
  locale?: string;
  onClose: () => void;
  onRecorded: () => void;
};

export function RecordPaymentDialog({
  invoice,
  currency = 'INR',
  locale = 'en-IN',
  onClose,
  onRecorded,
}: Props) {
  const [amount, setAmount] = useState(invoice?.balance ?? '');
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!invoice) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.revenue.recordPayment({
        companyId: invoice.company.id,
        invoiceId: invoice.id,
        amount: Number(amount),
        currency,
        paidOn: new Date(paidOn).toISOString(),
        method,
        reference: reference || null,
        notes: notes || null,
      });
      onRecorded();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Record Payment for ${invoice.number}`}>
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-3 text-xs text-secondary">
            <p className="font-semibold text-primary">{invoice.company.name}</p>
            <p className="mt-0.5">
              Invoice total: <span className="font-medium text-primary">{formatMoney(invoice.total, currency, locale)}</span> · Outstanding balance:{' '}
              <span className="font-semibold text-danger">{formatMoney(invoice.balance, currency, locale)}</span>
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Amount Received"
              type="number"
              value={amount}
              onChange={setAmount}
              required
              placeholder={invoice.balance}
            />
            <Field
              label="Payment Date"
              type="date"
              value={paidOn}
              onChange={setPaidOn}
              required
            />
          </div>

          <FieldSelect
            label="Payment Method"
            value={method}
            onChange={setMethod}
            options={PAYMENT_METHODS}
          />

          <Field
            label="Reference / UTR / Transaction ID"
            value={reference}
            onChange={setReference}
            placeholder="e.g. UTR12345678 or Cheque #0045"
          />

          <Field
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Optional internal note..."
          />

          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!amount || Number(amount) <= 0}>
            Record Payment
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
