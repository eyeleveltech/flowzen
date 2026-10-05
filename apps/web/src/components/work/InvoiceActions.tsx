'use client';

/**
 * An invoice's corrections, and the way back a stage — one menu, on the Money
 * screen's invoice list and on the retainer billing board.
 *
 *   · Edit invoice — the number, the amount and its GST, the dates.
 *   · Payments — each one received, to correct or remove. Removing the one
 *     that settled it makes the invoice owed again (Paid → Record payment).
 *   · Cancel invoice — it should not be here at all. Kept as Cancelled; the
 *     month, proforma or milestone it was entered against goes back a step
 *     (Record payment → Enter invoice). Offered only while nothing has been
 *     received against it: remove the payments first.
 */

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ListChecks, Pencil, XCircle } from 'lucide-react';
import { api, ApiError, formatMoney } from '@/lib/api-v2';
import { RowMenu } from '@/components/ui/row-menu';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/empty-state';
import { useConfirmStore } from '@/stores/confirm';
import { formatDate } from '@/lib/utils';
import { EditInvoiceModal } from '@/components/work/EditInvoiceModal';
import { RecordPaymentModal } from '@/components/work/RecordPaymentModal';
import { useMayEditInvoice } from '@/components/work/PaidInvoiceLock';

export function InvoiceActions({
  invoice,
  hasPayments,
  onChanged,
}: {
  invoice: { id: string; number: string; status: string };
  /** Whether anything has been received against it. */
  hasPayments: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirmStore((st) => st.confirm);
  const [open, setOpen] = useState<null | 'edit' | 'payments'>(null);
  const live = invoice.status !== 'CANCELLED';
  // A paid invoice is locked; only an admin, with a reason, may change it.
  const mayEdit = useMayEditInvoice(invoice.status);

  const cancelInvoice = async () => {
    const ok = await confirm({
      title: `Cancel invoice ${invoice.number}?`,
      message:
        'It stays on the record as Cancelled. The retainer month, proforma or milestone it was entered against goes back a step, so the right invoice can be entered.',
      confirmText: 'Cancel invoice',
      cancelText: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.invoices.cancel(invoice.id);
      toast.success(`${invoice.number} cancelled`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not cancel that invoice');
    }
  };

  if (!live) return null;

  return (
    <>
      <RowMenu
        label={`Invoice ${invoice.number}`}
        actions={[
          { label: 'Edit invoice', icon: Pencil, visible: mayEdit, onSelect: () => setOpen('edit') },
          { label: 'Payments', icon: ListChecks, visible: hasPayments, onSelect: () => setOpen('payments') },
          { label: 'Cancel invoice', icon: XCircle, tone: 'danger', visible: !hasPayments, onSelect: () => void cancelInvoice() },
        ]}
      />
      {open === 'edit' && (
        <EditInvoiceModal
          invoiceId={invoice.id}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            onChanged();
          }}
        />
      )}
      {open === 'payments' && (
        <InvoicePaymentsModal invoiceId={invoice.id} number={invoice.number} onClose={() => setOpen(null)} onChanged={onChanged} />
      )}
    </>
  );
}

type PaymentRow = {
  id: string;
  amount: number;
  gstAmount: number | null;
  receivedAt: string;
  mode: string;
  reference: string | null;
};

/** Every payment against one invoice, each to correct or remove. */
function InvoicePaymentsModal({
  invoiceId,
  number,
  onClose,
  onChanged,
}: {
  invoiceId: string;
  number: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirmStore((st) => st.confirm);
  const [data, setData] = useState<{ amount: number; totalPaid: number; status: string; payments: PaymentRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.invoices.get(invoiceId);
      setData({
        amount: Number(d.amount ?? 0),
        totalPaid: Number(d.totalPaid ?? 0),
        status: d.status,
        payments: (d.payments ?? []).map((p: Record<string, unknown>) => ({
          id: String(p.id),
          amount: Number(p.amount ?? 0),
          gstAmount: p.gstAmount == null ? null : Number(p.gstAmount),
          receivedAt: String(p.receivedAt),
          mode: String(p.mode),
          reference: (p.reference as string | null) ?? null,
        })),
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the payments');
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (p: PaymentRow) => {
    const settling = data && data.status === 'PAID';
    const ok = await confirm({
      title: `Remove the ${formatMoney(p.amount)} payment?`,
      message: settling
        ? `Received ${formatDate(p.receivedAt)} by ${p.mode}. Invoice ${number} will be owed again, and anything it settled goes back to unpaid.`
        : `Received ${formatDate(p.receivedAt)} by ${p.mode}. It comes off invoice ${number}'s balance.`,
      confirmText: 'Remove payment',
      cancelText: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(p.id);
    try {
      await api.invoices.removePayment(invoiceId, p.id);
      toast.success('Payment removed');
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove that payment');
    } finally {
      setBusy(null);
    }
  };

  if (editing) {
    return (
      <RecordPaymentModal
        invoiceId={invoiceId}
        defaultAmount={editing.amount}
        payment={editing}
        onClose={() => setEditing(null)}
        onRecorded={() => {
          setEditing(null);
          void load();
          onChanged();
        }}
      />
    );
  }

  const balance = data ? Math.max(0, data.amount - data.totalPaid) : 0;

  return (
    <Modal open onClose={onClose} title={`Payments — ${number}`} description="Correct a payment, or remove one recorded by mistake.">
      <ModalBody className="space-y-4">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
        {!data ? (
          <p className="text-sm text-secondary">Opening…</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-secondary">
                Invoice <span className="font-semibold tabular-nums text-primary">{formatMoney(data.amount)}</span>
              </span>
              <span className="text-secondary">
                Received <span className="font-semibold tabular-nums text-primary">{formatMoney(data.totalPaid)}</span>
              </span>
              <span className="text-secondary">
                {balance > 0 ? 'Still owed ' : 'Settled'}
                {balance > 0 && <span className="font-semibold tabular-nums text-primary">{formatMoney(balance)}</span>}
              </span>
            </div>
            {data.payments.length === 0 ? (
              <p className="text-sm text-secondary">Nothing has been received against this invoice.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold tabular-nums text-primary">
                        {formatMoney(p.amount)}
                        {p.gstAmount ? (
                          <span className="ml-1.5 text-xs font-normal text-secondary">incl. GST {formatMoney(p.gstAmount)}</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-secondary">
                        {formatDate(p.receivedAt)} · {p.mode}
                        {p.reference ? ` · ${p.reference}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" onClick={() => setEditing(p)} disabled={busy !== null}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => void remove(p)} loading={busy === p.id}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
