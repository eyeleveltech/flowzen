'use client';

/**
 * Correcting an invoice that was entered: the Tally number, the amount and its
 * GST, the dates.
 *
 * The total can't go below what has already been received (change or remove
 * the payment instead), and an invoice with a printed document takes its
 * amount from the document's lines — that is changed with Edit document, so
 * here it is shown and not offered.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError, formatMoney } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { InvoiceGstFields, paymentGstStart, useInvoiceGst } from '@/components/work/InvoiceGstFields';
import { PaidInvoiceLock, reasonGiven, useIsAdmin } from '@/components/work/PaidInvoiceLock';

type Loaded = {
  id: string;
  number: string;
  amount: number;
  gstAmount: number | null;
  raisedAt: string;
  dueAt: string;
  hasDocument: boolean;
  totalPaid: number;
  status: string;
};

export function EditInvoiceModal({
  invoiceId,
  onClose,
  onSaved,
}: {
  invoiceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [invoice, setInvoice] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.invoices
      .get(invoiceId)
      .then((d) =>
        setInvoice({
          id: d.id,
          number: d.number,
          amount: Number(d.amount ?? 0),
          gstAmount: d.gstAmount == null ? null : Number(d.gstAmount),
          raisedAt: String(d.raisedAt).slice(0, 10),
          dueAt: String(d.dueAt).slice(0, 10),
          hasDocument: Boolean(d.hasDocument),
          totalPaid: Number(d.totalPaid ?? 0),
          status: String(d.status),
        }),
      )
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not open this invoice'));
  }, [invoiceId]);

  return (
    <Modal open onClose={onClose} title={invoice ? `Edit invoice ${invoice.number}` : 'Edit invoice'}>
      {invoice ? (
        <EditForm invoice={invoice} onClose={onClose} onSaved={onSaved} />
      ) : (
        <ModalBody>{loadError ? <ErrorNote>{loadError}</ErrorNote> : <p className="text-sm text-secondary">Opening…</p>}</ModalBody>
      )}
    </Modal>
  );
}

/** Mounted once the invoice is loaded, so the form starts from its real values. */
function EditForm({ invoice, onClose, onSaved }: { invoice: Loaded; onClose: () => void; onSaved: () => void }) {
  const [start] = useState(() => paymentGstStart(invoice.amount, { total: invoice.amount, gst: invoice.gstAmount }));
  const [number, setNumber] = useState(invoice.number);
  const [amount, setAmount] = useState(String(start.base));
  const gst = useInvoiceGst(amount, { defaultOn: start.on, ratePercent: start.ratePercent, defaultGst: start.gst });
  const [raisedAt, setRaisedAt] = useState(invoice.raisedAt);
  const [dueAt, setDueAt] = useState(invoice.dueAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = useIsAdmin();
  const paid = invoice.status === 'PAID';
  const [reason, setReason] = useState('');

  const total = gst.on ? gst.total : Number(amount);
  const belowReceived = !invoice.hasDocument && invoice.totalPaid > 0 && total < invoice.totalPaid;
  const canSave =
    Boolean(number.trim()) &&
    Number(amount) > 0 &&
    gst.gstValid &&
    Boolean(raisedAt) &&
    Boolean(dueAt) &&
    !belowReceived &&
    (!paid || (admin && reasonGiven(reason)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.invoices.update(invoice.id, {
        number: number.trim(),
        raisedAt,
        dueAt,
        ...(paid ? { reason: reason.trim() } : {}),
        // A printed document owns its amount; only the details move here.
        ...(invoice.hasDocument ? {} : { amount: total, gstAmount: gst.gstAmount }),
      });
      toast.success(`Invoice ${number.trim()} updated`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <ModalBody className="space-y-4">
        {paid && <PaidInvoiceLock admin={admin} reason={reason} onReason={setReason} disabled={saving} />}
        <Field label="Invoice number (from Tally)" value={number} onChange={setNumber} required disabled={saving || (paid && !admin)} />

        {invoice.hasDocument ? (
          <Note>
            {formatMoney(invoice.amount)}
            {invoice.gstAmount ? ` incl. GST ${formatMoney(invoice.gstAmount)}` : ''} — this invoice has a printed
            document, so its amount comes from the document&apos;s lines. Change it with Edit document.
          </Note>
        ) : (
          <>
            <Field
              label={gst.on ? 'Amount before GST (₹)' : 'Amount (₹)'}
              value={amount}
              onChange={setAmount}
              type="number"
              required
              disabled={saving}
            />
            <InvoiceGstFields gst={gst} disabled={saving} />
            {invoice.totalPaid > 0 && (
              <p className={`text-xs ${belowReceived ? 'font-medium text-danger' : 'text-secondary'}`}>
                {formatMoney(invoice.totalPaid)} has been received against it, so the total can&apos;t go below that.
                {belowReceived ? ' Change or remove a payment first.' : ''}
              </p>
            )}
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Raised on" value={raisedAt} onChange={setRaisedAt} type="date" required disabled={saving} />
          <Field label="Due date" value={dueAt} onChange={setDueAt} type="date" required disabled={saving} />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
          Save invoice
        </Button>
      </ModalFooter>
    </form>
  );
}
