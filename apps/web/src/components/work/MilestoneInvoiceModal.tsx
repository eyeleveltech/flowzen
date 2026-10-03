'use client';

/**
 * Writing down the invoice that settles a milestone, and the money against it.
 *
 * The buttons these replace were claims. "Mark invoiced" and "Mark paid" each
 * moved a milestone one rung up the ladder and recorded nothing — no number,
 * no amount, no date, nobody — so eleven milestones in this database sit past
 * Pending with no document at all and nothing can be reconciled against Tally.
 *
 * Tally is the book of record here; Flowzen does not raise invoices, it records
 * them. So this asks for what the person already has in front of them — the
 * Tally number — and writes a real Invoice row. The milestone's status then
 * follows from that row rather than from the click, which is what §3 asks for
 * and what the proforma step has always done.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError, formatMoney } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { InvoiceGstFields, paymentGstStart, useInvoiceGst } from '@/components/work/InvoiceGstFields';

const MODES = [
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
];

const today = () => new Date().toISOString().slice(0, 10);

export type MilestoneForBilling = {
  id: string;
  label: string;
  amount: string | number | null;
  status: string;
  /** The invoice already recorded against it, when there is one. */
  invoice?: { id: string; number: string; amount: string | number | null; gstAmount?: string | number | null } | null;
};

/**
 * Two steps, one component, because they are the same conversation: which
 * document, and then what was received against it.
 */
export function MilestoneInvoiceModal({
  mode,
  projectId,
  companyId,
  milestone,
  onClose,
  onDone,
}: {
  /** `INVOICE` records the Tally invoice; `PAYMENT` records money against it. */
  mode: 'INVOICE' | 'PAYMENT';
  projectId: string;
  companyId: string;
  milestone: MilestoneForBilling;
  onClose: () => void;
  onDone: () => void;
}) {
  const due = Number(milestone.amount ?? 0);
  const invoicing = mode === 'INVOICE';

  // A payment against an invoice that carries GST starts as the invoice's
  // total, split in its own ratio.
  const [payStart] = useState(() => {
    const total = Number(milestone.invoice?.amount ?? 0);
    return invoicing ? null : paymentGstStart(total, { total, gst: Number(milestone.invoice?.gstAmount ?? 0) });
  });
  const startAmount = payStart?.on ? payStart.base : due;

  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState(startAmount > 0 ? String(startAmount) : '');
  const gst = useInvoiceGst(
    amount,
    payStart?.on ? { defaultOn: true, ratePercent: payStart.ratePercent, defaultGst: payStart.gst } : {},
  );
  const [raisedAt, setRaisedAt] = useState(today());
  const [dueAt, setDueAt] = useState('');
  const [payMode, setPayMode] = useState('NEFT');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave =
    Number(amount) > 0 &&
    (invoicing ? number.trim().length > 0 && Boolean(raisedAt) : Boolean(raisedAt)) &&
    gst.gstValid &&
    !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      if (invoicing) {
        await api.invoices.create({
          companyId,
          projectId,
          milestoneId: milestone.id,
          amount: gst.on ? gst.total : Number(amount),
          ...(gst.gstAmount !== null ? { gstAmount: gst.gstAmount } : {}),
          // The number Tally gave it. Without one the server would allocate
          // its own, and then two books would disagree about what this is
          // called.
          customNumber: number.trim(),
          raisedAt,
          ...(dueAt ? { dueAt } : {}),
        });
        toast.success(`Invoice ${number.trim()} recorded`);
      } else {
        if (!milestone.invoice) throw new Error('There is no invoice against this milestone yet.');
        await api.invoices.recordPayment(milestone.invoice.id, {
          amount: gst.on ? gst.total : Number(amount),
          ...(gst.gstAmount !== null ? { gstAmount: gst.gstAmount } : {}),
          receivedAt: raisedAt,
          mode: payMode,
          reference: reference.trim() || null,
        });
        toast.success('Payment recorded');
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not record that ${invoicing ? 'invoice' : 'payment'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={invoicing ? 'Record the invoice' : 'Record the payment'}
      description={`${milestone.label} — ${formatMoney(due)}`}
      size="md"
    >
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Note>
            {invoicing
              ? 'Enter the invoice as it was raised in Tally. The milestone moves to Invoiced because this exists — it is not set by hand.'
              : `Against invoice ${milestone.invoice?.number ?? '—'}. The milestone moves to Paid once the invoice is fully settled.`}
          </Note>

          {invoicing && (
            <Field
              label="Invoice number"
              value={number}
              onChange={setNumber}
              required
              disabled={busy}
              placeholder="As it appears in Tally"
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={gst.on ? 'Amount before GST (₹)' : invoicing ? 'Amount (₹)' : 'Amount received (₹)'}
              value={amount}
              onChange={setAmount}
              type="number"
              required
              disabled={busy}
              hint={invoicing ? undefined : 'A part payment is fine — the milestone waits until the invoice is settled.'}
            />
            <Field
              label={invoicing ? 'Invoice date' : 'Date the client paid'}
              value={raisedAt}
              onChange={setRaisedAt}
              type="date"
              required
              disabled={busy}
              hint={invoicing ? undefined : 'The day the money reached you — change it if that was not today.'}
            />
          </div>

          <InvoiceGstFields gst={gst} disabled={busy} kind={invoicing ? 'invoice' : 'payment'} />

          {invoicing ? (
            <Field
              label="Due date"
              value={dueAt}
              onChange={setDueAt}
              type="date"
              disabled={busy}
              hint="Left blank, it is 15 days from the invoice date."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldSelect label="How it came in" value={payMode} onChange={setPayMode} options={MODES} disabled={busy} />
              <Field
                label="Reference"
                value={reference}
                onChange={setReference}
                disabled={busy}
                placeholder="UTR, cheque no."
              />
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            {invoicing ? 'Record invoice' : 'Record payment'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
