'use client';

/**
 * Billing one retainer month: Proforma → Invoice → Paid.
 *
 * Two pieces, used on two screens:
 *
 *   · `BillingNext` — the button for whatever the month is waiting for, and
 *     the forms behind it. The Money board puts one on every row.
 *   · `RetainerBillingStrip` — the three steps drawn out, with `BillingNext`
 *     beside them. The retainer page shows one for the month it is on.
 *
 * Same forms, same rule for the next step (lib/retainerBilling.ts), so a month
 * reads the same wherever it is looked at.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Download, FileText, Mail, ReceiptText, Wallet, XCircle } from 'lucide-react';
import { api, ApiError, formatMoney, type BillingStep, type RetainerBillingRow } from '@/lib/api-v2';
import { useConfirmStore } from '@/stores/confirm';
import { Button } from '@/components/ui/button';
import { RowMenu } from '@/components/ui/row-menu';
import { NewProformaModal } from '@/components/clients/NewProformaModal';
import { SendDocumentModal } from '@/components/documents/SendDocumentModal';
import { RecordPaymentModal } from '@/components/work/RecordPaymentModal';
import { EnterInvoiceModal } from '@/components/work/EnterInvoiceModal';
import { BILLING_LABEL, billableFrom, isLiveProforma, monthLabel } from '@/lib/retainerBilling';

/** What billing a month needs to know — a board row, or one built from the retainer page. */
export type BillingSubject = Pick<
  RetainerBillingRow,
  'monthCardId' | 'month' | 'companyId' | 'companyName' | 'billing' | 'fee' | 'gstPercent' | 'proforma' | 'invoice' | 'step'
>;

const money = (v: number) => formatMoney(v, 'INR', 'en-IN');

// ── The next step ────────────────────────────────────────────────────────────

export function BillingNext({
  subject,
  onChanged,
  size = 'sm',
}: {
  subject: BillingSubject;
  onChanged: () => void;
  size?: 'sm' | 'md';
}) {
  const confirm = useConfirmStore((st) => st.confirm);
  const [open, setOpen] = useState<null | 'proforma' | 'invoice' | 'payment' | 'email'>(null);
  const { proforma, invoice, step } = subject;
  const label = monthLabel(subject.month);
  const live = isLiveProforma(proforma);

  const cancelProforma = async () => {
    if (!proforma) return;
    const ok = await confirm({
      title: `Cancel proforma ${proforma.number}?`,
      message: `${subject.companyName} — ${label}. The month goes back to needing a proforma, and a new one can be raised.`,
      confirmText: 'Cancel proforma',
      cancelText: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.proformas.updateStatus(proforma.id, 'CANCELLED');
      toast.success(`${proforma.number} cancelled`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not cancel that proforma');
    }
  };

  const done = () => {
    setOpen(null);
    onChanged();
  };

  return (
    <div className="flex items-center justify-end gap-1.5">
      {step === 'PROFORMA' && (
        <>
          <Button size={size} variant="primary" icon={FileText} onClick={() => setOpen('proforma')}>
            Raise proforma
          </Button>
          {/* Straight to the tax invoice, for a client who is not sent a proforma. */}
          <Button size={size} variant="ghost" onClick={() => setOpen('invoice')}>
            Enter invoice
          </Button>
        </>
      )}
      {step === 'INVOICE' && (
        <Button size={size} variant="primary" icon={ReceiptText} onClick={() => setOpen('invoice')}>
          Enter invoice
        </Button>
      )}
      {step === 'PAYMENT' && (
        <Button size={size} variant="primary" icon={Wallet} onClick={() => setOpen('payment')}>
          Record payment
        </Button>
      )}
      {step === 'DONE' && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
          <Check className="h-3.5 w-3.5" /> Paid
        </span>
      )}
      {step === 'NOT_YET' && <span className="text-xs text-secondary">Billable from {billableFrom(subject.month)}</span>}

      {/* The proforma's own actions, whichever step the month is on. */}
      {proforma && (
        <RowMenu
          label={`Proforma ${proforma.number}`}
          actions={[
            {
              label: 'Download proforma',
              icon: Download,
              onSelect: () => window.open(api.proformas.pdfUrl(proforma.id), '_blank'),
            },
            { label: 'Email proforma', icon: Mail, visible: live, onSelect: () => setOpen('email') },
            {
              label: 'Cancel proforma',
              icon: XCircle,
              tone: 'danger',
              // Once the invoice exists the proforma is settled history.
              visible: live && !invoice,
              onSelect: () => void cancelProforma(),
            },
          ]}
        />
      )}

      {open === 'proforma' && (
        <NewProformaModal
          companyId={subject.companyId}
          companyName={subject.companyName}
          source={{ type: 'MONTH_CARD', monthCardId: subject.monthCardId, monthLabel: label }}
          defaultAmount={subject.fee}
          defaultDescription={`Retainer fee — ${label}`}
          defaultGstPercent={subject.gstPercent}
          onCancel={() => setOpen(null)}
          onConfirm={done}
        />
      )}
      {open === 'invoice' && (
        <EnterInvoiceModal
          companyId={subject.companyId}
          monthCardId={subject.monthCardId}
          monthLabel={label}
          defaultAmount={live && proforma ? proforma.amount : subject.fee}
          proforma={live && proforma ? { id: proforma.id, number: proforma.number } : null}
          onClose={() => setOpen(null)}
          onCreated={() => {
            toast.success('Invoice entered');
            done();
          }}
        />
      )}
      {open === 'payment' && invoice && (
        <RecordPaymentModal
          invoiceId={invoice.id}
          defaultAmount={Math.max(0, invoice.amount - invoice.paid)}
          onClose={() => setOpen(null)}
          onRecorded={done}
        />
      )}
      {open === 'email' && proforma && (
        <SendDocumentModal kind="PROFORMA" id={proforma.id} onClose={() => setOpen(null)} onSent={done} />
      )}
    </div>
  );
}

// ── The three steps, drawn out ───────────────────────────────────────────────

type StepState = 'done' | 'current' | 'waiting' | 'skipped';

function Step({ n, title, state, detail }: { n: number; title: string; state: StepState; detail: string }) {
  const dot =
    state === 'done'
      ? 'bg-success text-white'
      : state === 'current'
        ? 'bg-primary text-white'
        : 'border border-border bg-white text-secondary';
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${dot}`}>
        {state === 'done' ? <Check className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${state === 'waiting' || state === 'skipped' ? 'text-secondary' : 'text-primary'}`}>
          {title}
        </p>
        <p className="truncate text-xs text-secondary">{detail}</p>
      </div>
    </div>
  );
}

const PF_STATUS: Record<string, string> = { UNPAID: 'waiting for payment', PAID: 'paid', EXPIRED: 'expired', CANCELLED: 'cancelled' };

export function RetainerBillingStrip({ subject, onChanged }: { subject: BillingSubject; onChanged: () => void }) {
  const { proforma, invoice, step } = subject;
  const live = isLiveProforma(proforma);
  const order: BillingStep[] = ['PROFORMA', 'INVOICE', 'PAYMENT', 'DONE'];
  const at = step === 'NOT_YET' ? -1 : order.indexOf(step);
  const stateOf = (i: number): StepState => (at === -1 ? 'waiting' : i < at ? 'done' : i === at ? 'current' : 'waiting');

  const proformaState: StepState = live ? 'done' : invoice ? 'skipped' : stateOf(0);
  const proformaDetail = live
    ? `${proforma!.number} · ${money(proforma!.total)} · ${PF_STATUS[proforma!.status]}`
    : invoice
      ? 'Invoiced without one'
      : proforma
        ? `${proforma.number} ${PF_STATUS[proforma.status]} — raise a new one`
        : step === 'NOT_YET'
          ? `Billable from ${billableFrom(subject.month)}`
          : 'Not raised yet';

  const invoiceDetail = invoice
    ? `${invoice.number} · due ${new Date(invoice.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
    : live
      ? 'Once the proforma is paid'
      : 'Not yet';

  const paidDetail = !invoice
    ? 'Not yet'
    : invoice.status === 'PAID'
      ? `${money(invoice.amount)} received`
      : invoice.paid > 0
        ? `${money(invoice.paid)} of ${money(invoice.amount)}`
        : `${money(invoice.amount)} to come`;

  const gst =
    subject.gstPercent == null
      ? 'GST rate not set'
      : subject.gstPercent === 0
        ? 'no GST'
        : `+ ${subject.gstPercent}% GST = ${money(subject.fee * (1 + subject.gstPercent / 100))}`;

  return (
    <section
      aria-label={`Billing for ${monthLabel(subject.month)}`}
      className="mb-5 rounded-xl border border-border bg-white px-4 py-3.5"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="eyebrow">Billing · {monthLabel(subject.month)}</p>
        <p className="text-xs text-secondary">
          {BILLING_LABEL[subject.billing]} · {money(subject.fee)}
          {gst.startsWith('+') ? ' ' : ' · '}
          {gst}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          <Step n={1} title="Proforma" state={proformaState} detail={proformaDetail} />
          <Step n={2} title="Invoice" state={invoice ? 'done' : stateOf(1)} detail={invoiceDetail} />
          <Step n={3} title="Paid" state={step === 'DONE' ? 'done' : stateOf(2)} detail={paidDetail} />
        </div>
        <BillingNext subject={subject} onChanged={onChanged} />
      </div>
    </section>
  );
}
